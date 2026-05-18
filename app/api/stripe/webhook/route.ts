import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '../../_auth';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) return NextResponse.json({ error: 'No signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  // Look up Supabase user by stripe_customer_id.
  // Falls back to customer email lookup so manually-created subscriptions work too.
  async function getUidByCustomer(customerId: string): Promise<string | null> {
    const { data } = await supabaseAdmin
      .from('user_settings')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .single();

    if (data?.user_id) return data.user_id;

    // Fallback: fetch email from Stripe, find matching Supabase user
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) return null;
      const email = (customer as Stripe.Customer).email;
      if (!email) return null;

      const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      const user = users.find(u => u.email === email);
      if (!user) return null;

      // Cache the link for future webhook events
      await supabaseAdmin.from('user_settings').upsert({
        user_id: user.id,
        stripe_customer_id: customerId,
      }, { onConflict: 'user_id' });

      return user.id;
    } catch {
      return null;
    }
  }

  async function setTier(userId: string, tier: 'free' | 'pro', status: string) {
    await supabaseAdmin.from('user_settings').upsert({
      user_id: userId,
      subscription_tier: tier,
      subscription_status: status,
      ...(tier === 'free' ? { generations_used: 0 } : {}),
    }, { onConflict: 'user_id' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        if (!userId || !customerId) break;
        await supabaseAdmin.from('user_settings').upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          subscription_tier: 'pro',
          subscription_status: 'active',
        }, { onConflict: 'user_id' });

        // Reward the referrer with 30 days free Pro
        try {
          const { data: newSub } = await supabaseAdmin
            .from('user_settings')
            .select('referred_by')
            .eq('user_id', userId)
            .single();
          if (newSub?.referred_by) {
            const { data: referrer } = await supabaseAdmin
              .from('user_settings')
              .select('user_id, pro_bonus_expires_at, subscription_tier')
              .eq('referral_code', newSub.referred_by)
              .single();
            if (referrer) {
              const now = new Date();
              const base = referrer.pro_bonus_expires_at && new Date(referrer.pro_bonus_expires_at) > now
                ? new Date(referrer.pro_bonus_expires_at)
                : now;
              base.setDate(base.getDate() + 7);
              await supabaseAdmin.from('user_settings').upsert({
                user_id: referrer.user_id,
                pro_bonus_expires_at: base.toISOString(),
                referral_count: ((await supabaseAdmin.from('user_settings').select('referral_count').eq('user_id', referrer.user_id).single()).data?.referral_count ?? 0) + 1,
              }, { onConflict: 'user_id' });
            }
          }
        } catch {}
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const userId = await getUidByCustomer(customerId);
        if (!userId) break;
        const isActive = sub.status === 'active' || sub.status === 'trialing';
        await setTier(userId, isActive ? 'pro' : 'free', sub.status);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const userId = await getUidByCustomer(customerId);
        if (!userId) break;
        await setTier(userId, 'free', 'canceled');
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        if (!customerId) break;
        const userId = await getUidByCustomer(customerId);
        if (!userId) break;
        await supabaseAdmin.from('user_settings').upsert({
          user_id: userId,
          subscription_status: 'past_due',
        }, { onConflict: 'user_id' });
        break;
      }
    }
  } catch (err) {
    console.error('[Stripe webhook]', err);
  }

  return NextResponse.json({ received: true });
}

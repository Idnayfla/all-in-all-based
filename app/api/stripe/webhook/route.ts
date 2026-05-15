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

  async function getUidByCustomer(customerId: string): Promise<string | null> {
    const { data } = await supabaseAdmin
      .from('user_settings')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .single();
    return data?.user_id ?? null;
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
        break;
      }

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

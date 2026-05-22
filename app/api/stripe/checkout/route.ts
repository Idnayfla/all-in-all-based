import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getUserId, supabaseAdmin } from '../../_auth';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = authUser.user?.email;

    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    let customerId = settings?.stripe_customer_id as string | undefined;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email ?? undefined,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from('user_settings')
        .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: 'user_id' });
    }

    const origin = req.headers.get('origin') ?? 'https://getbased.dev';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
      mode: 'subscription',
      success_url: `${origin}?upgraded=true`,
      cancel_url: origin,
      consent_collection: { terms_of_service: 'required' },
      custom_text: {
        terms_of_service_acceptance: {
          message: `I agree to the [Terms of Service](${origin}/terms) and [Refund Policy](${origin}/refund).`,
        },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

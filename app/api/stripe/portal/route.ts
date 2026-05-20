import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getUserId, supabaseAdmin } from '../../_auth';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);

    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (!settings?.stripe_customer_id) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
    }

    const origin = req.headers.get('origin') ?? 'https://getbased.dev';
    const session = await stripe.billingPortal.sessions.create({
      customer: settings.stripe_customer_id,
      return_url: origin,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

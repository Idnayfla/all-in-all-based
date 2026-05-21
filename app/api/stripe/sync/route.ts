import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getUserId, supabaseAdmin } from '../../_auth';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);

    const { data: s } = await supabaseAdmin
      .from('user_settings')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (!s?.stripe_customer_id) {
      return NextResponse.json({ synced: false, tier: 'free', reason: 'no_customer' });
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: s.stripe_customer_id,
      status: 'all',
      limit: 10,
    });

    const active = subscriptions.data.find(
      sub => sub.status === 'active' || sub.status === 'trialing'
    );

    const tier: 'free' | 'pro' = active ? 'pro' : 'free';
    const status = active?.status ?? 'canceled';
    const item = (
      active as {
        items?: { data?: { current_period_start?: number; current_period_end?: number }[] };
      } | null
    )?.items?.data?.[0];
    const periodStart = item?.current_period_start ?? null;
    const periodEnd = item?.current_period_end ?? null;

    await supabaseAdmin.from('user_settings').upsert(
      {
        user_id: userId,
        subscription_tier: tier,
        subscription_status: status,
        ...(periodStart
          ? { subscription_period_start: new Date(periodStart * 1000).toISOString() }
          : {}),
        ...(periodEnd ? { subscription_period_end: new Date(periodEnd * 1000).toISOString() } : {}),
      },
      { onConflict: 'user_id' }
    );

    return NextResponse.json({ synced: true, tier, status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

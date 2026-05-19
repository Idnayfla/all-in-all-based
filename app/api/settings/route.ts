import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { data } = await supabaseAdmin
      .from('user_settings')
      .select(
        'personality, global_memory, theme, subscription_tier, subscription_status, generations_used, generations_reset_at, pro_bonus_expires_at, subscription_period_start, subscription_period_end'
      )
      .eq('user_id', userId)
      .single();

    // Reset monthly usage if we're in a new month
    let generationsUsed = data?.generations_used ?? 0;
    if (data?.generations_reset_at) {
      const resetAt = new Date(data.generations_reset_at);
      const now = new Date();
      if (resetAt.getMonth() !== now.getMonth() || resetAt.getFullYear() !== now.getFullYear()) {
        generationsUsed = 0;
        void (async () => {
          try {
            await supabaseAdmin.from('user_settings').upsert(
              {
                user_id: userId,
                generations_used: 0,
                generations_reset_at: now.toISOString(),
              },
              { onConflict: 'user_id' }
            );
          } catch {}
        })();
      }
    }

    const paidTier = (data?.subscription_tier ?? 'free') as 'free' | 'pro';
    const subStatus = data?.subscription_status ?? 'active';
    // Treat explicitly cancelled subscriptions as free regardless of tier column
    const isCanceled = subStatus === 'canceled' || subStatus === 'cancelled';
    const bonusExpiresAt = data?.pro_bonus_expires_at as string | null;
    const hasBonusPro = !!bonusExpiresAt && new Date(bonusExpiresAt) > new Date();
    const alwaysPro = process.env.ALWAYS_PRO === 'true';
    const effectiveTier: 'free' | 'pro' =
      alwaysPro || (paidTier === 'pro' && !isCanceled) || hasBonusPro ? 'pro' : 'free';
    const bonusDaysLeft = hasBonusPro
      ? Math.max(0, Math.ceil((new Date(bonusExpiresAt!).getTime() - Date.now()) / 86400000))
      : 0;

    return NextResponse.json({
      personality: data?.personality ?? '',
      globalMemory: data?.global_memory ?? '',
      theme: data?.theme ?? {},
      subscriptionTier: effectiveTier,
      subscriptionStatus: data?.subscription_status ?? 'active',
      generationsUsed,
      bonusDaysLeft,
      subscriptionPeriodStart: data?.subscription_period_start ?? null,
      subscriptionPeriodEnd: data?.subscription_period_end ?? null,
    });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const body = await req.json();
    const upsertData: Record<string, unknown> = { user_id: userId };
    if (body.personality !== undefined) upsertData.personality = body.personality;
    if (body.globalMemory !== undefined) upsertData.global_memory = body.globalMemory;
    if (body.theme !== undefined) upsertData.theme = body.theme;
    const { error } = await supabaseAdmin
      .from('user_settings')
      .upsert(upsertData, { onConflict: 'user_id' });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

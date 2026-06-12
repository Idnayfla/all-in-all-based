import { supabaseAdmin } from '@/app/api/_auth';

export const TIER_LIMITS = {
  free: { generationsPerMonth: 10, companionPerDay: 5, label: 'Free' },
  beta: { generationsPerMonth: 30, companionPerDay: 20, label: 'Beta' },
  pro: { generationsPerMonth: 150, companionPerDay: Infinity, label: 'Pro' },
} as const;

export type Tier = keyof typeof TIER_LIMITS;

export async function getEffectiveTier(userId: string): Promise<Tier> {
  const { data } = await supabaseAdmin
    .from('user_settings')
    .select('subscription_tier, subscription_status, pro_bonus_expires_at, beta_expires_at')
    .eq('user_id', userId)
    .single();

  const alwaysPro = process.env.ALWAYS_PRO === 'true';
  if (alwaysPro) return 'pro';

  const paidTier = (data?.subscription_tier ?? 'free') as string;
  const subStatus = data?.subscription_status ?? 'active';
  const isCanceled = subStatus === 'canceled' || subStatus === 'cancelled';
  const bonusExpiresAt = data?.pro_bonus_expires_at as string | null;
  const hasBonusPro = !!bonusExpiresAt && new Date(bonusExpiresAt) > new Date();

  if ((paidTier === 'pro' && !isCanceled) || hasBonusPro) return 'pro';

  if (paidTier === 'beta') {
    const betaExpiry = data?.beta_expires_at as string | null;
    if (betaExpiry && new Date(betaExpiry) > new Date()) return 'beta';
    // Expired beta → free (don't auto-downgrade the DB record here, just return free)
  }

  return 'free';
}

// Check if user can generate and increment the counter. Returns null if allowed,
// or an error object if blocked.
export async function checkAndIncrementGeneration(
  userId: string
): Promise<{ error: 'generation_limit_reached'; tier: Tier; limit: number; used: number } | null> {
  try {
    const tier = await getEffectiveTier(userId);
    const limit = TIER_LIMITS[tier].generationsPerMonth;
    if (limit === Infinity) return null; // pro with no cap (future)

    const { data: s } = await supabaseAdmin
      .from('user_settings')
      .select('generations_used, generations_reset_at')
      .eq('user_id', userId)
      .single();

    const now = new Date();
    const needsReset =
      !s?.generations_reset_at ||
      new Date(s.generations_reset_at).getMonth() !== now.getMonth() ||
      new Date(s.generations_reset_at).getFullYear() !== now.getFullYear();
    const used = needsReset ? 0 : (s?.generations_used ?? 0);

    if (used >= limit) {
      return { error: 'generation_limit_reached', tier, limit, used };
    }

    // Increment fire-and-forget
    void (async () => {
      try {
        await supabaseAdmin.from('user_settings').upsert(
          {
            user_id: userId,
            generations_used: used + 1,
            generations_reset_at: needsReset ? now.toISOString() : s?.generations_reset_at,
          },
          { onConflict: 'user_id' }
        );
      } catch {
        // silent — never block on DB error
      }
    })();

    return null;
  } catch {
    return null; // fail open — never block on DB error
  }
}

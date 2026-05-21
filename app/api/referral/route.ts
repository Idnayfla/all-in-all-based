import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);

    const { data } = await supabaseAdmin
      .from('user_settings')
      .select('referral_code, referral_count, pro_bonus_expires_at')
      .eq('user_id', userId)
      .single();

    let code = data?.referral_code as string | null;

    if (!code) {
      // Generate a unique code
      let attempts = 0;
      while (!code && attempts < 5) {
        const candidate = generateCode();
        const { error } = await supabaseAdmin
          .from('user_settings')
          .upsert({ user_id: userId, referral_code: candidate }, { onConflict: 'user_id' });
        if (!error) code = candidate;
        attempts++;
      }
    }

    const bonusExpiresAt = data?.pro_bonus_expires_at as string | null;
    const bonusDaysLeft = bonusExpiresAt
      ? Math.max(0, Math.ceil((new Date(bonusExpiresAt).getTime() - Date.now()) / 86400000))
      : 0;

    return NextResponse.json({
      code,
      referralCount: data?.referral_count ?? 0,
      bonusDaysLeft,
      bonusExpiresAt,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

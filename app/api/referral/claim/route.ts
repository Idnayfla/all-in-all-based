import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

const REFERRAL_BONUS_DAYS = 3;

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { code } = await req.json();
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 });
    }

    // Check if user already claimed a referral
    const { data: self } = await supabaseAdmin
      .from('user_settings')
      .select('referred_by, referral_code, pro_bonus_expires_at')
      .eq('user_id', userId)
      .single();

    if (self?.referred_by) {
      return NextResponse.json({ ok: true, alreadyClaimed: true });
    }

    // Prevent self-referral
    if (self?.referral_code === code.toUpperCase()) {
      return NextResponse.json({ error: 'Cannot use your own referral code' }, { status: 400 });
    }

    // Look up the referrer
    const { data: referrer } = await supabaseAdmin
      .from('user_settings')
      .select('user_id')
      .eq('referral_code', code.toUpperCase())
      .single();

    if (!referrer) {
      return NextResponse.json({ error: 'Invalid referral code' }, { status: 404 });
    }

    // Grant new user 7 days free Pro
    const bonusExpires = new Date(Date.now() + REFERRAL_BONUS_DAYS * 86400000).toISOString();

    await supabaseAdmin.from('user_settings').upsert(
      {
        user_id: userId,
        referred_by: code.toUpperCase(),
        pro_bonus_expires_at: bonusExpires,
      },
      { onConflict: 'user_id' }
    );

    return NextResponse.json({ ok: true, bonusDays: REFERRAL_BONUS_DAYS });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

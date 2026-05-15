import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { data } = await supabaseAdmin
      .from('user_settings')
      .select('personality, global_memory, theme, subscription_tier, subscription_status, generations_used, generations_reset_at')
      .eq('user_id', userId)
      .single();

    // Reset monthly usage if we're in a new month
    let generationsUsed = data?.generations_used ?? 0;
    if (data?.generations_reset_at) {
      const resetAt = new Date(data.generations_reset_at);
      const now = new Date();
      if (resetAt.getMonth() !== now.getMonth() || resetAt.getFullYear() !== now.getFullYear()) {
        generationsUsed = 0;
        void (async () => { try { await supabaseAdmin.from('user_settings').upsert({
          user_id: userId,
          generations_used: 0,
          generations_reset_at: now.toISOString(),
        }, { onConflict: 'user_id' }); } catch {} })();
      }
    }

    return NextResponse.json({
      personality:        data?.personality ?? '',
      globalMemory:       data?.global_memory ?? '',
      theme:              data?.theme ?? {},
      subscriptionTier:   (data?.subscription_tier ?? 'free') as 'free' | 'pro',
      subscriptionStatus: data?.subscription_status ?? 'active',
      generationsUsed,
    });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const body = await req.json();
    const upsertData: Record<string, unknown> = { user_id: userId };
    if (body.personality  !== undefined) upsertData.personality   = body.personality;
    if (body.globalMemory !== undefined) upsertData.global_memory = body.globalMemory;
    if (body.theme        !== undefined) upsertData.theme         = body.theme;
    const { error } = await supabaseAdmin
      .from('user_settings')
      .upsert(upsertData, { onConflict: 'user_id' });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

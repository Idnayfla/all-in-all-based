import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from './_auth';

// Monthly limits per Pro user
const LIMITS = { video: 30, image: 200, music: 50 } as const;
type MediaType = keyof typeof LIMITS;

type Ok = { userId: string };

export async function checkMediaRateLimit(
  req: NextRequest,
  type: MediaType
): Promise<Ok | NextResponse> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: s } = await supabaseAdmin
    .from('user_settings')
    .select('subscription_tier, video_count, image_count, music_count, media_reset_at')
    .eq('user_id', user.id)
    .single();

  const alwaysPro = process.env.ALWAYS_PRO === 'true' || !!process.env.BETA_ACCESS_CODE;
  if (!alwaysPro && (s?.subscription_tier ?? 'free') !== 'pro') {
    return NextResponse.json({ error: 'Pro subscription required' }, { status: 403 });
  }

  const now = new Date();
  const needsReset =
    !s?.media_reset_at ||
    new Date(s.media_reset_at).getMonth() !== now.getMonth() ||
    new Date(s.media_reset_at).getFullYear() !== now.getFullYear();

  const countKey = `${type}_count` as 'video_count' | 'image_count' | 'music_count';
  const count = needsReset ? 0 : (s?.[countKey] ?? 0);
  const limit = LIMITS[type];

  if (count >= limit) {
    return NextResponse.json(
      {
        error: `Monthly ${type} limit reached (${limit}/month). Resets next month.`,
      },
      { status: 429 }
    );
  }

  const updates: Record<string, unknown> = { user_id: user.id };
  if (needsReset) {
    updates.video_count = type === 'video' ? 1 : 0;
    updates.image_count = type === 'image' ? 1 : 0;
    updates.music_count = type === 'music' ? 1 : 0;
    updates.media_reset_at = now.toISOString();
  } else {
    updates[`${type}_count`] = count + 1;
  }

  await supabaseAdmin.from('user_settings').upsert(updates, { onConflict: 'user_id' });

  return { userId: user.id };
}

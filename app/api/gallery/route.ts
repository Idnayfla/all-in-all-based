import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('shares')
    .select('id, project_name, author_name, remix_count, gallery_published_at')
    .eq('in_gallery', true)
    .order('remix_count', { ascending: false })
    .order('gallery_published_at', { ascending: false })
    .limit(24);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { shareId, authorName } = await req.json();
    if (!shareId) return NextResponse.json({ error: 'Missing shareId' }, { status: 400 });

    const { data: share } = await supabaseAdmin
      .from('shares')
      .select('id, user_id')
      .eq('id', shareId)
      .eq('user_id', userId)
      .single();

    if (!share) return NextResponse.json({ error: 'Share not found' }, { status: 404 });

    const { error: updateError } = await supabaseAdmin
      .from('shares')
      .update({
        in_gallery: true,
        gallery_published_at: new Date().toISOString(),
        author_name: authorName?.trim() || null,
      })
      .eq('id', shareId);

    // Surface failures (e.g. missing column) instead of reporting a false
    // success — the client treats `ok` as "now in gallery".
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

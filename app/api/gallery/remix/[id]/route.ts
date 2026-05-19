import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../../_auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await supabaseAdmin
    .from('shares')
    .select('project_name, files')
    .eq('id', id)
    .eq('in_gallery', true)
    .single();

  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ projectName: data.project_name, files: data.files });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getUserId(req);
    const { id } = await params;

    const { data: share } = await supabaseAdmin
      .from('shares')
      .select('remix_count')
      .eq('id', id)
      .eq('in_gallery', true)
      .single();

    if (!share) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await supabaseAdmin
      .from('shares')
      .update({
        remix_count: (share.remix_count ?? 0) + 1,
      })
      .eq('id', id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

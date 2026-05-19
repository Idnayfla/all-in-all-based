import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { files, projectName } = await req.json();
    if (!files?.length) return NextResponse.json({ error: 'No files to share' }, { status: 400 });

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);

    const { error } = await supabaseAdmin.from('shares').insert({
      id,
      user_id: userId,
      project_name: projectName ?? 'Untitled',
      files,
    });

    if (error) throw error;

    return NextResponse.json({ id, url: `/s/${id}` });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

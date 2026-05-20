import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { files, projectName, projectId } = await req.json();
    if (!files?.length) return NextResponse.json({ error: 'No files to share' }, { status: 400 });

    // If projectId provided, upsert — same project always gets the same share URL
    if (projectId) {
      const { data: existing } = await supabaseAdmin
        .from('shares')
        .select('id')
        .eq('user_id', userId)
        .eq('project_id', projectId)
        .single();

      if (existing?.id) {
        await supabaseAdmin
          .from('shares')
          .update({
            files,
            project_name: projectName ?? 'Untitled',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        return NextResponse.json({ id: existing.id, url: `/s/${existing.id}` });
      }
    }

    // First share for this project (or no projectId)
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const { error } = await supabaseAdmin.from('shares').insert({
      id,
      user_id: userId,
      project_id: projectId ?? null,
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

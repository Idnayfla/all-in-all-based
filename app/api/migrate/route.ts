import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { projects, personality, globalMemory } = await req.json();

    if (Array.isArray(projects) && projects.length > 0) {
      const rows = projects.map((p: any) => ({
        id: p.id,
        user_id: userId,
        name: p.name ?? 'Untitled',
        files: p.files ?? [],
        messages: (p.messages ?? []).map((m: any) => ({
          ...m,
          content: Array.isArray(m.content)
            ? m.content.map((b: any) =>
                b.type === 'image' ? { type: 'text', text: '[image]' } : b
              )
            : m.content,
        })),
        memory: p.memory ?? '',
        updated_at: p.updatedAt
          ? new Date(p.updatedAt).toISOString()
          : new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin
        .from('projects')
        .upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    await supabaseAdmin
      .from('user_settings')
      .upsert(
        { user_id: userId, personality: personality ?? '', global_memory: globalMemory ?? '' },
        { onConflict: 'user_id' }
      );

    return NextResponse.json({ migrated: projects?.length ?? 0 });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

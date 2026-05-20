import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { projects, personality, globalMemory } = await req.json();

    if (Array.isArray(projects) && projects.length > 0) {
      const rows = projects.map((p: { id: string; name?: string; files?: unknown[]; messages?: { role: string; content: unknown }[]; memory?: string; updatedAt?: string }) => ({
        id: p.id,
        user_id: userId,
        name: p.name ?? 'Untitled',
        files: p.files ?? [],
        messages: (p.messages ?? []).map((m: { role: string; content: unknown }) => ({
          ...m,
          content: Array.isArray(m.content)
            ? (m.content as { type: string; text?: string }[]).map(b =>
                b.type === 'image' ? { type: 'text', text: '[image]' } : b
              )
            : m.content,
        })),
        memory: p.memory ?? '',
        updated_at: p.updatedAt ? new Date(p.updatedAt).toISOString() : new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from('projects').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    await supabaseAdmin
      .from('user_settings')
      .upsert(
        { user_id: userId, personality: personality ?? '', global_memory: globalMemory ?? '' },
        { onConflict: 'user_id' }
      );

    return NextResponse.json({ migrated: projects?.length ?? 0 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

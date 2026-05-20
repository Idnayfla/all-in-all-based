import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('id, name, files, messages, memory, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const projects = data.map(p => ({
      id: p.id,
      name: p.name,
      files: p.files,
      messages: p.messages,
      memory: p.memory,
      updatedAt: new Date(p.updated_at).getTime(),
    }));
    return NextResponse.json({ projects });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { name, id } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });
    const row: Record<string, unknown> = {
      user_id: userId,
      name: name.trim(),
      files: [],
      messages: [],
      memory: '',
    };
    if (id) row.id = id;
    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert(row)
      .select('id, name, files, messages, memory, updated_at')
      .single();
    if (error) throw error;
    return NextResponse.json({
      project: {
        id: data.id,
        name: data.name,
        files: data.files,
        messages: data.messages,
        memory: data.memory,
        updatedAt: new Date(data.updated_at).getTime(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[POST /api/projects]', msg, err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

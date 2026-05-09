import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const userId = await getUserId(req);
    const { id } = await ctx.params;
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('id, name, files, messages, memory, updated_at')
      .eq('id', id)
      .eq('user_id', userId)
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
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const userId = await getUserId(req);
    const { id } = await ctx.params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.files !== undefined) updates.files = body.files;
    if (body.messages !== undefined) updates.messages = body.messages;
    if (body.memory !== undefined) updates.memory = body.memory;
    if (Object.keys(updates).length === 0) return NextResponse.json({ success: true });
    const { error } = await supabaseAdmin
      .from('projects')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const userId = await getUserId(req);
    const { id } = await ctx.params;
    const { error } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

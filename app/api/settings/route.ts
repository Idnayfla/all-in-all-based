import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { data } = await supabaseAdmin
      .from('user_settings')
      .select('personality, global_memory, theme')
      .eq('user_id', userId)
      .single();
    return NextResponse.json({
      personality: data?.personality ?? '',
      globalMemory: data?.global_memory ?? '',
      theme: data?.theme ?? {},
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
    if (body.personality !== undefined) upsertData.personality = body.personality;
    if (body.globalMemory !== undefined) upsertData.global_memory = body.globalMemory;
    if (body.theme !== undefined) upsertData.theme = body.theme;
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

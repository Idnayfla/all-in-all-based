import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { data, error } = await supabaseAdmin
      .from('notes')
      .select('id, title, content, drawing_data, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const body = await req.json();
    const { data, error } = await supabaseAdmin
      .from('notes')
      .insert({
        user_id: userId,
        title: body.title ?? 'Untitled',
        content: body.content ?? '',
        drawing_data: body.drawing_data ?? null,
      })
      .select('id, title, content, drawing_data, created_at, updated_at')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

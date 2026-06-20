import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const roomId = req.nextUrl.searchParams.get('room_id');
  if (!roomId) return NextResponse.json({ error: 'room_id required' }, { status: 400 });

  const { data: self } = await supabaseAdmin
    .from('group_members')
    .select('user_id')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .single();
  if (!self) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const { data: members } = await supabaseAdmin
    .from('group_members')
    .select('display_name, joined_at')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });

  return NextResponse.json({ members: members ?? [] });
}

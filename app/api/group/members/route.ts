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

  const { data: room } = await supabaseAdmin
    .from('group_rooms')
    .select('created_by')
    .eq('id', roomId)
    .single();
  const isCreator = room?.created_by === userId;

  const { data: members } = await supabaseAdmin
    .from('group_members')
    .select('display_name, user_id, joined_at')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });

  let bannedUsers: { user_id: string; display_name: string | null }[] = [];
  if (isCreator) {
    const { data: bans } = await supabaseAdmin
      .from('group_bans')
      .select('user_id, display_name')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });
    bannedUsers = bans ?? [];
  }

  return NextResponse.json({ members: members ?? [], bannedUsers });
}

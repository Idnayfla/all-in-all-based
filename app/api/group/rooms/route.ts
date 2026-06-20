import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode(): string {
  const buf = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

// POST /api/group/rooms — create a room
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { name?: string; displayName?: string };
  const name = (body.name ?? 'Group Chat').slice(0, 60);
  const displayName = (body.displayName ?? 'You').slice(0, 40);

  let code = randomCode();
  for (let i = 0; i < 5; i++) {
    const { data: existing } = await supabaseAdmin
      .from('group_rooms')
      .select('id')
      .eq('code', code)
      .single();
    if (!existing) break;
    code = randomCode();
  }

  const { data: room, error } = await supabaseAdmin
    .from('group_rooms')
    .insert({ name, code, created_by: userId })
    .select('id, name, code')
    .single();

  if (error || !room) {
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }

  await supabaseAdmin
    .from('group_members')
    .insert({ room_id: room.id, user_id: userId, display_name: displayName });

  return NextResponse.json({ id: room.id, name: room.name, code: room.code, is_creator: true });
}

// GET /api/group/rooms?code=XXXX — look up room by invite code and auto-join
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const code = req.nextUrl.searchParams.get('code')?.toUpperCase();
  const displayName = (req.nextUrl.searchParams.get('name') ?? 'Guest').slice(0, 40);
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 });

  const { data: room } = await supabaseAdmin
    .from('group_rooms')
    .select('id, name, code, created_by')
    .eq('code', code)
    .single();

  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  // Check if user is banned
  const { data: ban } = await supabaseAdmin
    .from('group_bans')
    .select('id')
    .eq('room_id', room.id)
    .eq('user_id', userId)
    .single();
  if (ban) return NextResponse.json({ error: 'Banned' }, { status: 403 });

  // Upsert membership — updates display_name if they rejoin with a new name
  await supabaseAdmin
    .from('group_members')
    .upsert(
      { room_id: room.id, user_id: userId, display_name: displayName },
      { onConflict: 'room_id,user_id' }
    );

  return NextResponse.json({
    id: room.id,
    name: room.name,
    code: room.code,
    is_creator: room.created_by === userId,
  });
}

// DELETE /api/group/rooms?room_id=XXXX — delete room (creator only)
export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const roomId = req.nextUrl.searchParams.get('room_id');
  if (!roomId) return NextResponse.json({ error: 'room_id required' }, { status: 400 });

  const { data: room } = await supabaseAdmin
    .from('group_rooms')
    .select('created_by')
    .eq('id', roomId)
    .single();

  if (!room || room.created_by !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Broadcast before delete so connected clients are still subscribed to receive it
  const bc = supabaseAdmin.channel(`group:${roomId}`);
  await bc.subscribe();
  await bc.send({ type: 'broadcast', event: 'room_deleted', payload: {} });
  await supabaseAdmin.removeChannel(bc);

  await supabaseAdmin.from('group_rooms').delete().eq('id', roomId);

  return NextResponse.json({ success: true });
}

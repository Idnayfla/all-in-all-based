import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

function randomCode(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

// POST /api/group/rooms — create a room
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { name?: string; displayName?: string };
  const name = (body.name ?? 'Group Chat').slice(0, 60);
  const displayName = (body.displayName ?? 'You').slice(0, 40);

  let code = randomCode();
  // Retry on collision (extremely unlikely)
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

  // Creator auto-joins
  await supabaseAdmin
    .from('group_members')
    .insert({ room_id: room.id, user_id: userId, display_name: displayName });

  return NextResponse.json({ id: room.id, name: room.name, code: room.code });
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
    .select('id, name, code')
    .eq('code', code)
    .single();

  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  // Upsert membership — no-op if already a member
  await supabaseAdmin
    .from('group_members')
    .upsert(
      { room_id: room.id, user_id: userId, display_name: displayName },
      { onConflict: 'room_id,user_id' }
    );

  return NextResponse.json({ id: room.id, name: room.name, code: room.code });
}

import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    room_id?: string;
    target_user_id?: string;
    action?: 'kick' | 'ban' | 'unban';
  };
  const { room_id, target_user_id, action } = body;

  if (!room_id || !target_user_id || !['kick', 'ban', 'unban'].includes(action ?? '')) {
    return NextResponse.json(
      { error: 'room_id, target_user_id, action required' },
      { status: 400 }
    );
  }
  if (target_user_id === userId) {
    return NextResponse.json({ error: 'Cannot moderate yourself' }, { status: 400 });
  }

  const { data: room } = await supabaseAdmin
    .from('group_rooms')
    .select('created_by')
    .eq('id', room_id)
    .single();

  if (!room || room.created_by !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Unban: just remove from ban list, no broadcast needed
  if (action === 'unban') {
    await supabaseAdmin
      .from('group_bans')
      .delete()
      .eq('room_id', room_id)
      .eq('user_id', target_user_id);
    return NextResponse.json({ success: true });
  }

  // Look up display_name before deleting membership
  const { data: member } = await supabaseAdmin
    .from('group_members')
    .select('display_name')
    .eq('room_id', room_id)
    .eq('user_id', target_user_id)
    .single();
  const displayName = member?.display_name ?? 'Someone';

  if (action === 'ban') {
    await supabaseAdmin
      .from('group_bans')
      .upsert(
        { room_id, user_id: target_user_id, banned_by: userId, display_name: displayName },
        { onConflict: 'room_id,user_id' }
      );
  }

  await supabaseAdmin
    .from('group_members')
    .delete()
    .eq('room_id', room_id)
    .eq('user_id', target_user_id);

  // Single broadcast carries both the target user_id (so they redirect) and display_name
  // (so other clients can show a system event in the feed)
  const bc = supabaseAdmin.channel(`group:${room_id}`);
  await bc.subscribe();
  await bc.send({
    type: 'broadcast',
    event: action === 'ban' ? 'banned' : 'kicked',
    payload: { user_id: target_user_id, display_name: displayName },
  });
  await supabaseAdmin.removeChannel(bc);

  return NextResponse.json({ success: true });
}

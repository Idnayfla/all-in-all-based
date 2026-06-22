import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

// Tables scoped to a user by `user_id`. Each is deleted best-effort so one
// failure (e.g. a renamed column) never blocks the account removal itself.
const USER_ID_TABLES = [
  'api_keys',
  'companion_usage',
  'device_heartbeats',
  'entities',
  'feature_requests',
  'feature_votes',
  'feedback',
  'group_bans',
  'group_members',
  'group_messages',
  'inference_logs',
  'memory_vectors',
  'notes',
  'projects',
  'shares',
  'tasks',
  'user_settings',
];

// DELETE /api/account/delete — permanently delete the signed-in user's account
// and all associated data. Required for Google Play (account deletion policy).
export async function DELETE(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1. Delete user-scoped rows (best-effort — keep going if any single table errors).
  for (const table of USER_ID_TABLES) {
    try {
      await supabaseAdmin.from(table).delete().eq('user_id', userId);
    } catch {
      // Non-fatal: continue so the auth account is still removed below.
    }
  }
  // group_rooms is owned via created_by.
  try {
    await supabaseAdmin.from('group_rooms').delete().eq('created_by', userId);
  } catch {
    // Non-fatal.
  }

  // 2. Delete the auth account itself — this is the part Play policy requires.
  try {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      return NextResponse.json(
        { error: 'Could not delete account. Please contact support.' },
        { status: 500 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Could not delete account. Please contact support.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

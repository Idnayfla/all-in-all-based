import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { memory } = await req.json();
    const { error } = await supabaseAdmin
      .from('user_settings')
      .upsert(
        { user_id: userId, global_memory: memory ?? '' },
        { onConflict: 'user_id' }
      );
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

type DeviceType = 'mobile' | 'tablet' | 'desktop';

// POST — upsert this device's heartbeat
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { deviceType, projectId, projectName } = await req.json();

    if (!['mobile', 'tablet', 'desktop'].includes(deviceType)) {
      return NextResponse.json({ error: 'Invalid deviceType' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('device_heartbeats').upsert(
      {
        user_id: userId,
        device_type: deviceType as DeviceType,
        project_id: projectId ?? null,
        project_name: projectName ?? null,
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'user_id,device_type' }
    );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET — fetch most recent heartbeat from a DIFFERENT device (last 5 minutes)
export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const currentDevice = req.nextUrl.searchParams.get('current') as DeviceType | null;
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    let query = supabaseAdmin
      .from('device_heartbeats')
      .select('device_type, project_id, project_name, last_seen')
      .eq('user_id', userId)
      .gte('last_seen', since)
      .order('last_seen', { ascending: false })
      .limit(1);

    if (currentDevice) query = query.neq('device_type', currentDevice);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;

    return NextResponse.json({ heartbeat: data ?? null });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

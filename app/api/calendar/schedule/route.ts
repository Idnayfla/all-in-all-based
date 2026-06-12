import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../_auth';
import { getValidAccessToken, checkFreebusy, findFreeSlot } from '@/lib/googleCalendar';

// Re-export listCalendarIds — it's internal, so we inline what we need
async function getCalendarIds(accessToken: string): Promise<string[]> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=25',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) return ['primary'];
    const data = (await res.json()) as { items?: Array<{ id: string }> };
    const ids = (data.items ?? []).map(i => i.id).filter(Boolean);
    return ids.length > 0 ? ids : ['primary'];
  } catch {
    return ['primary'];
  }
}

// GET /api/calendar/schedule?date=YYYY-MM-DD&time=HH:MM&duration=60&tz_offset=+08:00
export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const time = searchParams.get('time');
    const durationStr = searchParams.get('duration');
    const tzOffset = searchParams.get('tz_offset') ?? '+00:00';

    if (!date || !time || !durationStr) {
      return NextResponse.json({ error: 'date, time, and duration are required' }, { status: 400 });
    }
    const duration = parseInt(durationStr, 10);
    if (isNaN(duration) || duration < 5) {
      return NextResponse.json({ error: 'duration must be a number >= 5' }, { status: 400 });
    }

    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return NextResponse.json({ connected: false });
    }

    const calendarIds = await getCalendarIds(accessToken);
    const busySlots = await checkFreebusy(accessToken, date, tzOffset, calendarIds);
    const result = findFreeSlot(busySlots, date, time, duration, tzOffset);

    return NextResponse.json({
      connected: true,
      date,
      time,
      duration,
      tzOffset,
      conflict: result.conflict,
      suggested: result.suggested ?? null,
      busyCount: busySlots.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../_auth';
import { buildAuthUrl, deleteTokensForUser } from '@/lib/googleCalendar';

// GET  — returns the Google OAuth URL the client should redirect to
export async function GET(req: NextRequest) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'Google Calendar not configured' }, { status: 501 });
  }
  try {
    await getUserId(req); // verify auth — we don't need userId here, just valid session
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    return NextResponse.json({ url: buildAuthUrl(token) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE — disconnect Google Calendar
export async function DELETE(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    await deleteTokensForUser(userId);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

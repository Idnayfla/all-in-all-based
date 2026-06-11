import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../_auth';
import {
  getTokensForUser,
  getValidAccessToken,
  listEvents,
  createEvent,
} from '@/lib/googleCalendar';

// GET — returns { enabled, connected, email?, events[] }
export async function GET(req: NextRequest) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ enabled: false, connected: false, events: [] });
  }
  try {
    const userId = await getUserId(req);
    const tokens = await getTokensForUser(userId);
    if (!tokens) {
      return NextResponse.json({ enabled: true, connected: false, events: [] });
    }
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return NextResponse.json({ enabled: true, connected: false, events: [] });
    }
    const events = await listEvents(accessToken, 30);
    return NextResponse.json({ enabled: true, connected: true, email: tokens.email, events });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST — create a Google Calendar event from a task
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const body = (await req.json()) as { title?: string; due_date?: string; notes?: string };
    if (!body.title || !body.due_date) {
      return NextResponse.json({ error: 'title and due_date are required' }, { status: 400 });
    }
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return NextResponse.json({ error: 'Calendar not connected' }, { status: 403 });
    }
    const event = await createEvent(accessToken, body.title, body.due_date, body.notes);
    return NextResponse.json(event);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

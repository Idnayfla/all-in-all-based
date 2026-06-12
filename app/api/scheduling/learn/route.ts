import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../_auth';
import { recordSlotAccepted } from '@/lib/schedulingPrefs';

export const maxDuration = 15;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as {
    original_time?: string;
    accepted_time?: string;
    date?: string;
  };

  const { original_time, accepted_time, date } = body;
  if (!original_time || !accepted_time || !date) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  await recordSlotAccepted(userId, original_time, accepted_time, date);
  return NextResponse.json({ ok: true });
}

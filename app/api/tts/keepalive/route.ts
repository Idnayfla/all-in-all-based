import { NextResponse } from 'next/server';

export const maxDuration = 10;

// Lightweight health ping — keeps the Modal container alive without generating audio.
// Called every 4 minutes while the companion is open.
export async function POST() {
  const endpoint = process.env.MODAL_TTS_ENDPOINT;
  if (!endpoint) return NextResponse.json({ ok: false });
  const healthUrl = endpoint.replace(/\/generate$/, '/health');
  try {
    await fetch(healthUrl, { method: 'GET' });
  } catch {
    // silently ignore
  }
  return NextResponse.json({ ok: true });
}

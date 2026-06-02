import { NextResponse } from 'next/server';

export const maxDuration = 5;

// Lightweight health ping — keeps the Modal container alive without generating audio.
// Called every 4 minutes while the companion is open.
// Fire-and-forget: do NOT await the fetch — return immediately so Vercel never times out.
export async function POST() {
  const endpoint = process.env.MODAL_TTS_ENDPOINT;
  if (!endpoint) return NextResponse.json({ ok: false });
  const healthUrl = endpoint.replace(/\/generate$/, '/health');
  // Fire-and-forget: intentionally not awaited
  fetch(healthUrl, { method: 'GET' }).catch(() => {});
  return NextResponse.json({ ok: true });
}

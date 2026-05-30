import { NextResponse } from 'next/server';

export const maxDuration = 30;

// Pings the Modal TTS health endpoint to keep the container warm.
// Fire-and-forget — does not generate audio, just wakes the container.
export async function POST() {
  const endpoint = process.env.MODAL_TTS_ENDPOINT;
  if (!endpoint) return NextResponse.json({ ok: false });
  // Health endpoint is the same base URL with /health — Modal cls methods share the base
  const healthUrl = endpoint.replace(/\/generate$/, '/health');
  try {
    await fetch(healthUrl, { method: 'GET' });
  } catch {
    // silently ignore
  }
  return NextResponse.json({ ok: true });
}

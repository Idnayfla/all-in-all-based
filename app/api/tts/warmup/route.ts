import { NextResponse } from 'next/server';

export const maxDuration = 60;

// Warms the Modal TTS GPU by running a real generation request.
// A health ping returns instantly but does NOT load the model onto the GPU.
// Sending a real /generate request forces F5-TTS to load — response is discarded.
export async function POST() {
  const endpoint = process.env.MODAL_TTS_ENDPOINT;
  if (!endpoint) return NextResponse.json({ ok: false });
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 35000); // 35s — cold-start takes ~25-30s
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hey' }),
      signal: abort.signal,
    });
    clearTimeout(timer);
  } catch {
    // silently ignore — warmup is best-effort
  }
  return NextResponse.json({ ok: true });
}

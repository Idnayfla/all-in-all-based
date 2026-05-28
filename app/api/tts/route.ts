import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../_auth';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: 'No text' }, { status: 400 });

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'TTS not configured' }, { status: 503 });

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: text.slice(0, 500),
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[tts]', res.status, err);
    return NextResponse.json({ error: 'TTS failed' }, { status: 500 });
  }

  const audio = await res.arrayBuffer();
  return new NextResponse(audio, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
  });
}

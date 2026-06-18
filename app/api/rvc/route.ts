import { NextRequest, NextResponse } from 'next/server';
import { checkMediaRateLimit } from '../_mediaRateLimit';

export const maxDuration = 120;

const RVC_URL = process.env.MODAL_RVC_URL ?? '';

export async function POST(req: NextRequest) {
  const limit = await checkMediaRateLimit(req, 'music');
  if (limit instanceof NextResponse) return limit;

  if (!RVC_URL) {
    return NextResponse.json(
      { error: 'RVC endpoint not configured. Set MODAL_RVC_URL in environment variables.' },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { audioBase64, pitchShift = 0 } = body as {
      audioBase64?: string;
      pitchShift?: number;
    };

    if (!audioBase64) {
      return NextResponse.json({ error: 'audioBase64 required' }, { status: 400 });
    }

    const res = await fetch(RVC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: audioBase64, pitch_shift: pitchShift }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[rvc] Modal error:', res.status, text);
      return NextResponse.json({ error: 'Voice conversion failed — try again.' }, { status: 500 });
    }

    const data = (await res.json()) as { audioBase64?: string; mimeType?: string; error?: string };
    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 500 });
    }

    return NextResponse.json({
      audioBase64: data.audioBase64,
      mimeType: data.mimeType ?? 'audio/wav',
    });
  } catch (err) {
    console.error('[rvc] Unexpected error:', err);
    return NextResponse.json({ error: 'Voice conversion failed — try again.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { checkMediaRateLimit } from '../../_mediaRateLimit';
import { generateVideo } from '../../../../lib/higgsfield';

export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const limit = await checkMediaRateLimit(req, 'video');
  if (limit instanceof NextResponse) return limit;

  if (!process.env.HIGGSFIELD_API_KEY) {
    return NextResponse.json({ error: 'Higgsfield API key not configured' }, { status: 500 });
  }

  const { imageUrl, prompt, model } = await req.json();
  if (!imageUrl?.trim()) {
    return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
  }
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  try {
    const url = await generateVideo(imageUrl, prompt, model ?? 'dop-lite');
    return NextResponse.json({ url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[higgsfield/video] error:', message);
    return NextResponse.json(
      { error: message || 'Video generation failed — please try again.' },
      { status: 500 }
    );
  }
}

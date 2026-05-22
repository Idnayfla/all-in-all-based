import { NextRequest, NextResponse } from 'next/server';
import { checkMediaRateLimit } from '../../_mediaRateLimit';
import { generateImage } from '../../../../lib/higgsfield';

export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const limit = await checkMediaRateLimit(req, 'image');
  if (limit instanceof NextResponse) return limit;

  if (!process.env.HIGGSFIELD_API_KEY || !process.env.HIGGSFIELD_SECRET) {
    return NextResponse.json({ error: 'Higgsfield API keys not configured' }, { status: 500 });
  }

  const { prompt } = await req.json();
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  try {
    const url = await generateImage(prompt);
    return NextResponse.json({ url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[higgsfield/image] error:', message);
    return NextResponse.json(
      { error: message || 'Image generation failed — please try again.' },
      { status: 500 }
    );
  }
}

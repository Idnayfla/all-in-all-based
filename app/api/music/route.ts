import { NextRequest, NextResponse } from 'next/server';
import { generateMusic } from '@/lib/fal';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { prompt, duration } = await req.json();
    if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 });

    const url = await generateMusic(prompt, duration ?? 30);
    if (!url) return NextResponse.json({ error: 'FAL_KEY not configured or generation failed' }, { status: 500 });

    return NextResponse.json({ url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

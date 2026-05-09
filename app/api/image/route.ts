import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 });
  }

  const { prompt } = await req.json();
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  fal.config({ credentials: process.env.FAL_KEY });

  try {
    const result = await fal.subscribe('fal-ai/flux/dev', {
      input: {
        prompt,
        image_size: 'landscape_4_3',
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: 1,
        enable_safety_checker: true,
      },
    });

    const url = (result.data as any).images?.[0]?.url;
    if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });

    return NextResponse.json({ url, prompt });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Generation failed' }, { status: 500 });
  }
}

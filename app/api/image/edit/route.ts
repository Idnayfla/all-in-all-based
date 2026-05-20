import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 });
  }

  const body = await req.json();
  const { mode, sourceImageUrl, sourceImageData, sourceMediaType, prompt, maskDataUrl } = body as {
    mode: 'transform' | 'inpaint';
    sourceImageUrl?: string;
    sourceImageData?: string;
    sourceMediaType?: string;
    prompt: string;
    maskDataUrl?: string;
  };

  if (!mode || (!sourceImageUrl && !sourceImageData) || !prompt?.trim()) {
    return NextResponse.json(
      { error: 'mode, sourceImageUrl or sourceImageData, and prompt are required' },
      { status: 400 }
    );
  }
  if (mode === 'inpaint' && !maskDataUrl) {
    return NextResponse.json(
      { error: 'maskDataUrl is required for inpaint mode' },
      { status: 400 }
    );
  }

  fal.config({ credentials: process.env.FAL_KEY });

  // Resolve source URL — either pre-uploaded or upload now from base64
  let resolvedSourceUrl: string = sourceImageUrl ?? '';
  if (!sourceImageUrl && sourceImageData) {
    const buffer = Buffer.from(sourceImageData, 'base64');
    const blob = new Blob([buffer], { type: sourceMediaType ?? 'image/png' });
    resolvedSourceUrl = await fal.storage.upload(blob);
  }
  if (!resolvedSourceUrl) {
    return NextResponse.json({ error: 'Could not resolve source image' }, { status: 400 });
  }

  try {
    if (mode === 'transform') {
      const result = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
        input: {
          image_url: resolvedSourceUrl,
          prompt,
          strength: 0.85,
          num_inference_steps: 28,
          guidance_scale: 3.5,
          num_images: 1,
          enable_safety_checker: true,
        },
      });
      const url = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
      if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });
      return NextResponse.json({ url });
    }

    // inpaint: upload mask, then call flux fill
    const maskBase64 = maskDataUrl!.split(',')[1];
    const maskBuffer = Buffer.from(maskBase64, 'base64');
    const maskBlob = new Blob([maskBuffer], { type: 'image/png' });
    const maskUrl = await fal.storage.upload(maskBlob);

    const result = await fal.subscribe('fal-ai/flux-pro/v1/fill', {
      input: {
        image_url: resolvedSourceUrl,
        mask_url: maskUrl,
        prompt,
        num_images: 1,
        safety_tolerance: '2',
      },
    });
    const url = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
    if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });
    return NextResponse.json({ url });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Edit failed' },
      { status: 500 }
    );
  }
}

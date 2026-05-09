// app/api/image/edit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 });
  }

  const body = await req.json();
  const { mode, sourceImageUrl, prompt, maskDataUrl } = body as {
    mode: 'transform' | 'inpaint';
    sourceImageUrl: string;
    prompt: string;
    maskDataUrl?: string;
  };

  if (!mode || !sourceImageUrl || !prompt?.trim()) {
    return NextResponse.json(
      { error: 'mode, sourceImageUrl, and prompt are required' },
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

  try {
    if (mode === 'transform') {
      const result = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
        input: {
          image_url: sourceImageUrl,
          prompt,
          strength: 0.85,
          num_inference_steps: 28,
          guidance_scale: 3.5,
          num_images: 1,
          enable_safety_checker: true,
        },
      });
      const url = (result.data as any).images?.[0]?.url;
      if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });
      return NextResponse.json({ url });
    }

    // inpaint: upload mask data URL to FAL storage, then call inpainting model
    const base64 = maskDataUrl!.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    const maskBlob = new Blob([buffer], { type: 'image/png' });
    const maskUrl = await fal.storage.upload(maskBlob);

    const result = await fal.subscribe('fal-ai/flux-pro/v1/fill', {
      input: {
        image_url: sourceImageUrl,
        mask_url: maskUrl,
        prompt,
        num_images: 1,
        safety_tolerance: '2',
      },
    });
    const url = (result.data as any).images?.[0]?.url;
    if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });
    return NextResponse.json({ url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Edit failed' }, { status: 500 });
  }
}

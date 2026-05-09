import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { friendlyFalError } from '../_falError';

if (process.env.FAL_KEY) fal.config({ credentials: process.env.FAL_KEY });

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 });
  }

  const { prompt, model = 'flux', sourceImageData, sourceMediaType } = await req.json();
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  try {
    let imageUrl: string | undefined;
    if (sourceImageData) {
      const buffer = Buffer.from(sourceImageData, 'base64');
      const blob = new Blob([buffer], { type: sourceMediaType ?? 'image/png' });
      imageUrl = await fal.storage.upload(blob);
    }

    let url: string | undefined;

    if (model === 'nano-banana') {
      if (imageUrl) {
        const result = await fal.subscribe('fal-ai/nano-banana-2/edit', {
          input: { image_urls: [imageUrl], prompt },
        });
        url = (result.data as any).images?.[0]?.url;
      } else {
        const result = await fal.subscribe('fal-ai/nano-banana-2', {
          input: { prompt, num_images: 1 },
        });
        url = (result.data as any).images?.[0]?.url;
      }
    } else {
      if (imageUrl) {
        const result = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
          input: {
            image_url: imageUrl,
            prompt,
            strength: 0.85,
            num_inference_steps: 28,
            guidance_scale: 3.5,
            num_images: 1,
            enable_safety_checker: true,
          },
        });
        url = (result.data as any).images?.[0]?.url;
      } else {
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
        url = (result.data as any).images?.[0]?.url;
      }
    }

    if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });
    return NextResponse.json({ url, prompt });
  } catch (err: any) {
    console.error('[image] FAL error — status:', err.status, '| body:', JSON.stringify(err.body), '| message:', err.message);
    return NextResponse.json({ error: friendlyFalError(err, 'Image generation failed — please try again.') }, { status: 500 });
  }
}

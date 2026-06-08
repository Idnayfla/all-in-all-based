import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { friendlyFalError } from '../_falError';
import { checkMediaRateLimit } from '../_mediaRateLimit';

export const maxDuration = 120;

if (process.env.FAL_KEY) fal.config({ credentials: process.env.FAL_KEY });

export async function POST(req: NextRequest) {
  const limit = await checkMediaRateLimit(req, 'image');
  if (limit instanceof NextResponse) return limit;

  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 });
  }

  const { prompt, model = 'flux', sourceImageData, sourceMediaType } = await req.json();
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  // Auto-detect infographic/poster/text-heavy requests → Ideogram handles text far better than Flux
  const isInfographic =
    /\b(pyramid|triangle|infographic|tier list|tier chart|ranking chart|hierarchy|ranked list|leaderboard)\b/i.test(
      prompt
    ) ||
    (/\b(rank|ranking|tier|tiers|category|categories)\b/i.test(prompt) &&
      /\b(hotel|restaurant|brand|product|company|logo)\b/i.test(prompt)) ||
    (/\b(triangle|pyramid)\b/i.test(prompt) &&
      /\b(hotel|luxury|ranking|rank|category|list|logo)\b/i.test(prompt));

  const resolvedModel = isInfographic ? 'ideogram' : model;

  try {
    let imageUrl: string | undefined;
    if (sourceImageData) {
      const buffer = Buffer.from(sourceImageData, 'base64');
      const blob = new Blob([buffer], { type: sourceMediaType ?? 'image/png' });
      imageUrl = await fal.storage.upload(blob);
    }

    let url: string | undefined;

    if (resolvedModel === 'ideogram') {
      // Ideogram v3 — best-in-class for text rendering, infographics, posters
      const enhancedPrompt = `${prompt}. Dark luxury poster design. Solid gold triangle pyramid divided by horizontal gold lines into tiers. City skyline silhouette in background. White text labels clearly readable on each tier. Professional infographic style, sharp typography, elegant gold accents, high contrast dark background, magazine quality graphic design.`;
      const ideogramInput: Record<string, unknown> = {
        prompt: enhancedPrompt,
        aspect_ratio: '2:3',
        style_type: 'design',
        negative_prompt:
          'blurry text, distorted text, low quality, watermark, cartoon, anime, 3D render, overexposed',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fal.subscribe('fal-ai/ideogram/v3', { input: ideogramInput as any });
      url = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
    } else if (resolvedModel === 'nano-banana') {
      if (imageUrl) {
        const result = await fal.subscribe('fal-ai/nano-banana-2/edit', {
          input: { image_urls: [imageUrl], prompt },
        });
        url = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
      } else {
        const result = await fal.subscribe('fal-ai/nano-banana-2', {
          input: { prompt, num_images: 1 },
        });
        url = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
      }
    } else {
      if (imageUrl) {
        // Flux Kontext — instruction-following image editor ("turn X into Y").
        // Falls back to flux dev image-to-image if Kontext is unavailable.
        try {
          const result = await fal.subscribe('fal-ai/flux-pro/kontext/max', {
            input: { image_url: imageUrl, prompt, num_images: 1 },
          });
          url = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
        } catch (kontextErr: unknown) {
          const kontextMsg = String(
            kontextErr instanceof Error ? kontextErr.message : kontextErr
          ).toLowerCase();
          const isUnavailable =
            kontextMsg.includes('404') ||
            kontextMsg.includes('not found') ||
            kontextMsg.includes('403') ||
            kontextMsg.includes('forbidden') ||
            kontextMsg.includes('downstream') ||
            kontextMsg.includes('unavailable') ||
            kontextMsg.includes('503') ||
            kontextMsg.includes('502') ||
            kontextMsg.includes('timeout') ||
            kontextMsg.includes('overloaded');
          if (!isUnavailable) throw kontextErr;
          // Fallback: flux dev i2i at lower strength for better instruction following
          const result = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
            input: {
              image_url: imageUrl,
              prompt,
              strength: 0.55, // 0.55 preserves structure better than 0.85
              num_inference_steps: 20,
              guidance_scale: 7.5,
              num_images: 1,
              enable_safety_checker: true,
            },
          });
          url = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
        }
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
        url = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
      }
    }

    if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });
    return NextResponse.json({ url, prompt });
  } catch (err: unknown) {
    const falErr = err as { status?: unknown; body?: unknown; message?: string };
    console.error(
      '[image] FAL error — status:',
      falErr.status,
      '| body:',
      JSON.stringify(falErr.body),
      '| message:',
      falErr.message
    );
    return NextResponse.json(
      { error: friendlyFalError(falErr, 'Image generation failed — please try again.') },
      { status: 500 }
    );
  }
}

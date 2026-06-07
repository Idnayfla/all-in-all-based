import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { checkMediaRateLimit } from '../../_mediaRateLimit';

export const maxDuration = 180;

if (process.env.FAL_KEY) fal.config({ credentials: process.env.FAL_KEY });

type FalImagesResult = { images?: { url: string }[] };

export async function POST(req: NextRequest) {
  const limit = await checkMediaRateLimit(req, 'image');
  if (limit instanceof NextResponse) return limit;

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

  try {
    // Upload source image — always re-upload to fal storage to guarantee a fresh, valid URL.
    // If we pass a stale/expired fal CDN URL directly to the model it fetches a black frame
    // and outputs black. Re-uploading avoids this for chained transformations.
    let resolvedSourceUrl: string;
    if (sourceImageData) {
      const buffer = Buffer.from(sourceImageData, 'base64');
      const blob = new Blob([buffer], { type: sourceMediaType ?? 'image/png' });
      resolvedSourceUrl = await fal.storage.upload(blob);
    } else if (sourceImageUrl) {
      // Download the URL (even if it's already a fal CDN URL) and re-upload for freshness
      const fetchRes = await fetch(sourceImageUrl);
      if (!fetchRes.ok) {
        return NextResponse.json(
          { error: 'Could not fetch source image — try again.' },
          { status: 400 }
        );
      }
      const contentType = fetchRes.headers.get('content-type') ?? 'image/png';
      const arrayBuffer = await fetchRes.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: contentType });
      resolvedSourceUrl = await fal.storage.upload(blob);
    } else {
      return NextResponse.json({ error: 'Could not resolve source image' }, { status: 400 });
    }

    // ── Transform — Flux Kontext (instruction-following editor) ─────────────
    if (mode === 'transform') {
      let url: string | undefined;
      try {
        const result = await fal.subscribe('fal-ai/flux-pro/kontext/max', {
          input: { image_url: resolvedSourceUrl, prompt, num_images: 1 },
        });
        url = (result.data as FalImagesResult).images?.[0]?.url;
      } catch (kontextErr: unknown) {
        const kontextMsg = String(
          kontextErr instanceof Error ? kontextErr.message : kontextErr
        ).toLowerCase();
        const shouldFallback =
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
        if (!shouldFallback) throw kontextErr;
        console.warn('[image/edit] flux-pro/kontext/max unavailable, falling back to flux dev i2i');
        const result = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
          input: {
            image_url: resolvedSourceUrl,
            prompt,
            strength: 0.55,
            num_inference_steps: 20,
            guidance_scale: 7.5,
            num_images: 1,
            enable_safety_checker: true,
          },
        });
        url = (result.data as FalImagesResult).images?.[0]?.url;
      }
      if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });
      return NextResponse.json({ url });
    }

    // ── Inpaint ──────────────────────────────────────────────────────────
    const maskBase64 = maskDataUrl!.split(',')[1];
    const maskBuffer = Buffer.from(maskBase64, 'base64');
    const maskBlob = new Blob([maskBuffer], { type: 'image/png' });
    const maskUrl = await fal.storage.upload(maskBlob);

    // Try flux-pro/fill first (best quality); fall back to SD inpainting if plan-gated
    let url: string | undefined;
    try {
      const result = await fal.subscribe('fal-ai/flux-pro/v1/fill', {
        input: {
          image_url: resolvedSourceUrl,
          mask_url: maskUrl,
          prompt,
          num_images: 1,
          safety_tolerance: '2',
        },
      });
      url = (result.data as FalImagesResult).images?.[0]?.url;
    } catch (fillErr: unknown) {
      const fillMsg = String(fillErr instanceof Error ? fillErr.message : fillErr);
      const isPlanGated =
        fillMsg.includes('403') ||
        fillMsg.toLowerCase().includes('forbidden') ||
        fillMsg.toLowerCase().includes('not found') ||
        fillMsg.toLowerCase().includes('404');

      if (!isPlanGated) throw fillErr; // re-throw unexpected errors

      console.warn('[image/edit] flux-pro/fill unavailable, falling back to SD inpainting');
      const result = await fal.subscribe('fal-ai/stable-diffusion-inpainting', {
        input: {
          image_url: resolvedSourceUrl,
          mask_url: maskUrl,
          prompt,
          num_inference_steps: 20,
          num_images: 1,
        },
      });
      url = (result.data as FalImagesResult).images?.[0]?.url;
    }

    if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });
    return NextResponse.json({ url });
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    console.error('[image/edit] error:', msg);
    const friendly =
      msg.includes('downstream') || msg.includes('unavailable') || msg.includes('503')
        ? 'Image service is temporarily busy — please try again in a moment.'
        : msg.includes('content') || msg.includes('moderat') || msg.includes('safety')
          ? 'Prompt was flagged by content filters — try rephrasing.'
          : msg.includes('timeout')
            ? 'Request timed out — try a simpler edit or try again.'
            : 'Edit failed — please try again.';
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}

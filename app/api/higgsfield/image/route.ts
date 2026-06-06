import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { checkMediaRateLimit } from '../../_mediaRateLimit';
import { generateImage } from '../../../../lib/higgsfield';

export const maxDuration = 180;

if (process.env.FAL_KEY) fal.config({ credentials: process.env.FAL_KEY });

export async function POST(req: NextRequest) {
  const limit = await checkMediaRateLimit(req, 'image');
  if (limit instanceof NextResponse) return limit;

  if (!process.env.HIGGSFIELD_API_KEY) {
    return NextResponse.json({ error: 'Higgsfield API key not configured' }, { status: 500 });
  }
  if (!process.env.HIGGSFIELD_SECRET) {
    return NextResponse.json(
      { error: 'HIGGSFIELD_SECRET not configured — add it to .env.local and Vercel env vars' },
      { status: 500 }
    );
  }

  const { prompt } = await req.json();
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  // Try Higgsfield first
  try {
    const url = await generateImage(prompt);
    return NextResponse.json({ url, provider: 'higgsfield' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isCreditsError =
      message.includes('403') ||
      message.toLowerCase().includes('credits') ||
      message.toLowerCase().includes('forbidden');

    if (!isCreditsError) {
      console.error('[higgsfield/image] error:', message);
      return NextResponse.json(
        { error: message || 'Image generation failed — please try again.' },
        { status: 500 }
      );
    }

    console.warn('[higgsfield/image] credits exhausted — falling back to Flux (fal.ai)');

    // Fallback: Flux via fal.ai
    if (!process.env.FAL_KEY) {
      return NextResponse.json(
        {
          error:
            'Higgsfield has no credits (add at platform.higgsfield.ai) and FAL_KEY is not set for fallback.',
        },
        { status: 402 }
      );
    }

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
      const url = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
      if (!url)
        return NextResponse.json({ error: 'No image returned from fallback' }, { status: 500 });
      return NextResponse.json({
        url,
        provider: 'fal',
        note: 'Generated with Flux — Higgsfield credits exhausted. Top up at platform.higgsfield.ai.',
      });
    } catch (falErr: unknown) {
      const falMsg = falErr instanceof Error ? falErr.message : String(falErr);
      console.error('[higgsfield/image] fallback fal error:', falMsg);
      return NextResponse.json(
        {
          error: `Higgsfield credits exhausted (top up at platform.higgsfield.ai). Flux fallback also failed: ${falMsg}`,
        },
        { status: 500 }
      );
    }
  }
}

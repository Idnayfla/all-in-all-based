import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { friendlyFalError } from '../_falError';
import { checkMediaRateLimit } from '../_mediaRateLimit';

export const maxDuration = 180;

if (process.env.FAL_KEY) fal.config({ credentials: process.env.FAL_KEY });

export async function POST(req: NextRequest) {
  const limit = await checkMediaRateLimit(req, 'video');
  if (limit instanceof NextResponse) return limit;

  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 });
  }

  const { prompt, imageData, mediaType, generateAudio } = await req.json();
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  try {
    let url: string | undefined;

    if (imageData) {
      const buffer = Buffer.from(imageData, 'base64');
      const blob = new Blob([buffer], { type: mediaType ?? 'image/png' });
      const imageUrl = await fal.storage.upload(blob);
      const result = await fal.subscribe('bytedance/seedance-2.0/image-to-video', {
        input: { image_url: imageUrl, prompt, generate_audio: !!generateAudio },
      });
      const videoData = result.data as { video?: { url: string }; videos?: { url: string }[] };
      url = videoData.video?.url ?? videoData.videos?.[0]?.url;
    } else {
      const result = await fal.subscribe('bytedance/seedance-2.0/text-to-video', {
        input: { prompt, generate_audio: !!generateAudio },
      });
      const videoData = result.data as { video?: { url: string }; videos?: { url: string }[] };
      url = videoData.video?.url ?? videoData.videos?.[0]?.url;
    }

    if (!url) return NextResponse.json({ error: 'No video returned' }, { status: 500 });
    return NextResponse.json({ url, prompt });
  } catch (err: unknown) {
    const falErr = err as { status?: unknown; body?: unknown; message?: string };
    console.error(
      '[video] FAL error — status:',
      falErr.status,
      '| body:',
      JSON.stringify(falErr.body),
      '| message:',
      falErr.message
    );
    return NextResponse.json(
      { error: friendlyFalError(falErr, 'Video generation failed — please try again.') },
      { status: 500 }
    );
  }
}

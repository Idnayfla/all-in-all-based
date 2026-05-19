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
      url = (result.data as any).video?.url ?? (result.data as any).videos?.[0]?.url;
    } else {
      const result = await fal.subscribe('bytedance/seedance-2.0/text-to-video', {
        input: { prompt, generate_audio: !!generateAudio },
      });
      url = (result.data as any).video?.url ?? (result.data as any).videos?.[0]?.url;
    }

    if (!url) return NextResponse.json({ error: 'No video returned' }, { status: 500 });
    return NextResponse.json({ url, prompt });
  } catch (err: any) {
    console.error(
      '[video] FAL error — status:',
      err.status,
      '| body:',
      JSON.stringify(err.body),
      '| message:',
      err.message
    );
    return NextResponse.json(
      { error: friendlyFalError(err, 'Video generation failed — please try again.') },
      { status: 500 }
    );
  }
}

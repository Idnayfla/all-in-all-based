import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { fal } from '@fal-ai/client';
import { friendlyFalError } from '../_falError';
import { checkMediaRateLimit } from '../_mediaRateLimit';
import { MODEL_HAIKU } from '@/lib/models';

export const maxDuration = 120;

if (process.env.FAL_KEY) fal.config({ credentials: process.env.FAL_KEY });

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY,
});

async function enhancePrompt(prompt: string): Promise<string> {
  try {
    const res = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 200,
      system:
        'You are a music prompt engineer. Expand a short music request into a rich, detailed prompt for an AI music generator. Include: mood/emotion, instruments, tempo (BPM range), key (major/minor), genre, dynamics, and atmosphere. Output only the enhanced prompt — no explanation, no quotes.',
      messages: [
        {
          role: 'user',
          content: `Music request: "${prompt}"\n\nExpand into a detailed music generation prompt.`,
        },
      ],
    });
    const text = res.content[0].type === 'text' ? res.content[0].text.trim() : '';
    return text || prompt;
  } catch {
    return prompt;
  }
}

export async function POST(req: NextRequest) {
  const limit = await checkMediaRateLimit(req, 'music');
  if (limit instanceof NextResponse) return limit;

  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 });
  }

  try {
    const { prompt, duration } = await req.json();
    if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 });

    const enhanced = await enhancePrompt(prompt);

    const result = await fal.subscribe('fal-ai/stable-audio', {
      input: {
        prompt: enhanced,
        seconds_total: Math.min(duration ?? 30, 45),
        steps: 100,
      },
    });

    const data = result.data as { audio_file?: { url?: string } };
    const url = data.audio_file?.url ?? '';
    if (!url) return NextResponse.json({ error: 'No audio URL returned' }, { status: 500 });

    return NextResponse.json({ url, enhanced });
  } catch (err: unknown) {
    const falErr = err as { status?: unknown; body?: unknown; message?: string };
    console.error(
      '[music] FAL error — status:',
      falErr.status,
      '| body:',
      JSON.stringify(falErr.body),
      '| message:',
      falErr.message
    );
    return NextResponse.json(
      { error: friendlyFalError(falErr, 'Music generation failed — please try again.') },
      { status: 500 }
    );
  }
}

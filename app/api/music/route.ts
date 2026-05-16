import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 120;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY,
});

async function enhancePrompt(prompt: string): Promise<string> {
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: 'You are a music prompt engineer. Expand a short music request into a rich, detailed prompt for an AI music generator. Include: mood/emotion, instruments, tempo (BPM range), key (major/minor), genre, dynamics, and atmosphere. Output only the enhanced prompt — no explanation, no quotes.',
      messages: [{ role: 'user', content: `Music request: "${prompt}"\n\nExpand into a detailed music generation prompt.` }],
    });
    const text = res.content[0].type === 'text' ? res.content[0].text.trim() : '';
    return text || prompt;
  } catch {
    return prompt;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, duration } = await req.json();
    if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 });

    const key = process.env.FAL_KEY || process.env.FAL_API_KEY;
    if (!key) return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 });

    const enhanced = await enhancePrompt(prompt);

    const res = await fetch('https://fal.run/fal-ai/musicgen', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: enhanced,
        duration: Math.min(duration ?? 30, 30),
        model_version: 'stereo-large',
      }),
    });

    if (!res.ok) {
      // Fall back to stable-audio if musicgen fails
      const fallback = await fetch('https://fal.run/fal-ai/stable-audio', {
        method: 'POST',
        headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: enhanced, seconds_total: Math.min(duration ?? 30, 45), steps: 100 }),
      });
      if (!fallback.ok) return NextResponse.json({ error: 'Music generation failed' }, { status: 500 });
      const fd = await fallback.json();
      const url = fd.audio_file?.url ?? '';
      if (!url) return NextResponse.json({ error: 'No audio URL returned' }, { status: 500 });
      return NextResponse.json({ url, enhanced });
    }

    const data = await res.json();
    const url = data.audio?.url ?? data.audio_file?.url ?? '';
    if (!url) return NextResponse.json({ error: 'No audio URL returned' }, { status: 500 });

    return NextResponse.json({ url, enhanced });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

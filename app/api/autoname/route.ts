import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL_HAIKU } from '@/lib/models';

const anthropic = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ name: 'New chat' });
    }

    const msg = await anthropic.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 30,
      messages: [
        {
          role: 'user',
          content: `Generate a short 3-5 word project name for this chat prompt. Reply with ONLY the name — no quotes, no punctuation at end, no explanation.\n\nPrompt: ${prompt.slice(0, 300)}`,
        },
      ],
    });

    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
    const name = raw.replace(/^["']|["']$/g, '').trim() || 'New chat';
    return NextResponse.json({ name });
  } catch {
    return NextResponse.json({ name: 'New chat' });
  }
}

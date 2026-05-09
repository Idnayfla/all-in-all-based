import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from 'redis';

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text ?? '')
      .join('\n');
  }
  return '';
}

async function readMemory(): Promise<string> {
  if (!process.env.REDIS_URL) return '';
  const redis = createClient({ url: process.env.REDIS_URL });
  redis.on('error', () => {});
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000));
  try {
    await Promise.race([redis.connect(), timeout]);
    const memory = await redis.get('based_memory');
    redis.disconnect().catch(() => {});
    return memory ?? '';
  } catch {
    redis.disconnect().catch(() => {});
    return '';
  }
}

export async function GET() {
  const memory = await readMemory();
  return NextResponse.json({ memory });
}

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({ apiKey: process.env.APP_ANTHROPIC_API_KEY });
  const redis = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 2000 } });
  redis.on('error', () => {});
  try {
    const { messages } = await req.json();

    const conversation = messages
      .map((m: any) => `${m.role.toUpperCase()}: ${contentToText(m.content)}`)
      .join('\n');

    await redis.connect();
    const existing = await redis.get('based_memory') ?? '';

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are a memory extractor. Based on this conversation, extract key facts about the user (preferences, skills, projects, goals, personal details) and merge with existing memory.

EXISTING MEMORY:
${existing || 'None yet'}

NEW CONVERSATION:
${conversation}

        Return ONLY a plain numbered list. Max 20 items. Format exactly like:
        1) Fact about the user
        2) Another fact
        3) Another fact

        STRICT RULES:
        - No headers
        - No bold text, no asterisks, no markdown whatsoever
        - No categories or labels
        - Just plain sentences
        - If nothing new to add, return existing memory unchanged.`
      }]
    });

    const newMemory = response.content[0].type === 'text' ? response.content[0].text : existing;
    await redis.set('based_memory', newMemory);
    await redis.disconnect();

    return NextResponse.json({ memory: newMemory });
  } catch (err: any) {
    try { await redis.disconnect(); } catch {}
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from 'redis';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function getRedis() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

export async function GET() {
  let redis;
  try {
    redis = await getRedis();
    const memory = await redis.get('based_memory');
    return NextResponse.json({ memory: memory ?? '' });
  } catch (err: any) {
    return NextResponse.json({ memory: '' });
  } finally {
    await redis?.disconnect();
  }
}

export async function POST(req: NextRequest) {
  let redis;
  try {
    const { messages } = await req.json();

    const conversation = messages
      .map((m: any) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const existing = await (async () => {
      redis = await getRedis();
      return await redis.get('based_memory') ?? '';
    })();

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

Return ONLY a concise updated memory as bullet points. Max 20 bullets. Focus on facts that would help personalize future conversations. If nothing new to add, return existing memory unchanged.`
      }]
    });

    const newMemory = response.content[0].type === 'text' ? response.content[0].text : existing;
    await redis!.set('based_memory', newMemory);
    await redis!.disconnect();

    return NextResponse.json({ memory: newMemory });
  } catch (err: any) {
    console.error(err);
    await redis?.disconnect();
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
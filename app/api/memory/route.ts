import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId, supabaseAdmin } from '../_auth';

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as { type: string; text?: string }[])
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('\n');
  }
  return '';
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { data } = await supabaseAdmin
      .from('user_settings')
      .select('global_memory')
      .eq('user_id', userId)
      .single();
    return NextResponse.json({ memory: data?.global_memory ?? '' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({
    apiKey: process.env.APP_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
  });
  try {
    const userId = await getUserId(req);
    const { messages } = await req.json();

    const conversation = (messages as { role: string; content: unknown }[])
      .map(m => `${String(m.role).toUpperCase()}: ${contentToText(m.content)}`)
      .join('\n');

    const { data: settingsData } = await supabaseAdmin
      .from('user_settings')
      .select('global_memory')
      .eq('user_id', userId)
      .single();
    const existing = settingsData?.global_memory ?? '';

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `You are a memory extractor. Based on this conversation, extract key facts about the person (preferences, skills, projects, goals, personal details) and merge with existing memory.

EXISTING MEMORY:
${existing || 'None yet'}

NEW CONVERSATION:
${conversation}

Return ONLY a plain numbered list. Max 20 items. Format exactly like:
1) Prefers dark mode interfaces
2) Works primarily in TypeScript
3) Building a SaaS product

STRICT RULES:
- Never start a fact with "User" — write the fact directly as a statement or preference
- No headers, no bold text, no asterisks, no markdown whatsoever
- No categories or labels
- Just plain sentences in first-person-implied style
- If nothing new to add, return existing memory unchanged.`,
        },
      ],
    });

    const newMemory = response.content[0].type === 'text' ? response.content[0].text : existing;

    await supabaseAdmin
      .from('user_settings')
      .upsert({ user_id: userId, global_memory: newMemory }, { onConflict: 'user_id' });

    return NextResponse.json({ memory: newMemory });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

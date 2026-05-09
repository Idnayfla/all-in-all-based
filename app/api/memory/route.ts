import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId, supabaseAdmin } from '../_auth';

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as any[])
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
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({ apiKey: process.env.APP_ANTHROPIC_API_KEY });
  try {
    const userId = await getUserId(req);
    const { messages } = await req.json();

    const conversation = (messages as any[])
      .map(m => `${String(m.role).toUpperCase()}: ${contentToText(m.content)}`)
      .join('\n');

    const { data: settingsData } = await supabaseAdmin
      .from('user_settings')
      .select('global_memory')
      .eq('user_id', userId)
      .single();
    const existing = settingsData?.global_memory ?? '';

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
- If nothing new to add, return existing memory unchanged.`,
      }],
    });

    const newMemory = response.content[0].type === 'text' ? response.content[0].text : existing;

    await supabaseAdmin
      .from('user_settings')
      .upsert(
        { user_id: userId, global_memory: newMemory },
        { onConflict: 'user_id' }
      );

    return NextResponse.json({ memory: newMemory });
  } catch (err: any) {
    if (err.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

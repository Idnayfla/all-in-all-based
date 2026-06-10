import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId, supabaseAdmin } from '../../_auth';
import { MODEL_HAIKU } from '@/lib/models';

const anthropic = new Anthropic();

const EXTRACT_PROMPT = `Analyze this conversation and extract named entities that are significant to the user's life or work.

Return a JSON array only — no other text:
[
  {
    "name": "exact name as mentioned",
    "type": "project|person|topic|account|place|other",
    "summary": "one sentence description based on what was said",
    "notes": "any relevant details, stats, status, or context mentioned"
  }
]

Rules:
- Only extract entities meaningfully discussed (owned, worked on, cared about) — not casually mentioned
- Accounts = social media, platforms, services (TikTok account, LinkedIn, Product Hunt, etc.)
- Projects = products being built, features, codebases
- People = real individuals mentioned by name
- Skip generic terms like "the app", "the user", "Claude"
- Return [] if nothing significant found`;

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ ok: true, extracted: 0 });
    }

    const convo = messages
      .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const res = await anthropic.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 1024,
      messages: [{ role: 'user', content: `${EXTRACT_PROMPT}\n\nConversation:\n${convo}` }],
    });

    const raw = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '[]';
    let entities: Array<{ name: string; type: string; summary?: string; notes?: string }> = [];
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      entities = match ? JSON.parse(match[0]) : [];
    } catch {
      return NextResponse.json({ ok: true, extracted: 0 });
    }

    const VALID_TYPES = ['project', 'person', 'topic', 'account', 'place', 'other'];
    let count = 0;
    for (const e of entities) {
      if (!e.name || typeof e.name !== 'string') continue;
      const type = VALID_TYPES.includes(e.type) ? e.type : 'other';
      const now = new Date().toISOString();

      // Check for existing entity (case-insensitive)
      const { data: existing } = await supabaseAdmin
        .from('entities')
        .select('id, content, notes')
        .eq('user_id', userId)
        .ilike('name', e.name.trim())
        .limit(1);

      if (existing && existing.length > 0) {
        await supabaseAdmin
          .from('entities')
          .update({
            type,
            ...(e.summary ? { summary: e.summary } : {}),
            ...(e.notes ? { notes: e.notes } : {}),
            last_mentioned_at: now,
            updated_at: now,
          })
          .eq('id', existing[0].id)
          .eq('user_id', userId);
      } else {
        await supabaseAdmin.from('entities').insert({
          user_id: userId,
          name: e.name.slice(0, 200),
          type,
          summary: e.summary ?? null,
          notes: e.notes ?? null,
          content: {},
          tags: [],
          last_mentioned_at: now,
        });
      }
      count++;
    }

    return NextResponse.json({ ok: true, extracted: count });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized') return NextResponse.json({ ok: true, extracted: 0 });
    console.error('[brain/extract]', msg);
    return NextResponse.json({ ok: true, extracted: 0 }); // always succeed silently
  }
}

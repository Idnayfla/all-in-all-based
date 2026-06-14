import { supabaseAdmin } from '@/app/api/_auth';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL_HAIKU } from './models';

// Gemini text-embedding-004 — 768-dimensional, free, same key as future vision.
// Falls back silently if GEMINI_API_KEY is absent.

async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text: text.slice(0, 2000) }] },
        }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    return data.embedding?.values ?? null;
  } catch {
    return null;
  }
}

/**
 * Find the most semantically relevant memories for a given query.
 * Returns an empty array if GEMINI_API_KEY is absent or the table doesn't exist yet.
 */
export async function searchMemory(userId: string, query: string, limit = 4): Promise<string[]> {
  const embedding = await embedText(query);
  if (!embedding) return [];
  try {
    const { data } = await supabaseAdmin.rpc('match_memories', {
      query_embedding: embedding,
      match_user_id: userId,
      match_count: limit,
      match_threshold: 0.72,
    });
    return ((data as { content: string }[] | null) ?? []).map(r => r.content);
  } catch {
    return [];
  }
}

/** Store a single atomic memory fact with its embedding. */
export async function storeMemory(
  userId: string,
  content: string,
  source = 'conversation'
): Promise<void> {
  const embedding = await embedText(content);
  if (!embedding) return;
  try {
    await supabaseAdmin.from('memory_vectors').insert({
      user_id: userId,
      content,
      embedding,
      source,
      session_at: new Date().toISOString(),
    });
  } catch {
    // silent — never block the companion
  }
}

/**
 * Extract memorable facts from the last 6 messages and store them as embeddings.
 * Fire-and-forget — never awaited, never blocks the response.
 */
export function extractAndStoreMemoriesAsync(
  userId: string,
  messages: Array<{ role: string; content: string }>
): void {
  if (!process.env.GEMINI_API_KEY) return;
  void (async () => {
    try {
      const haiku = new Anthropic({
        apiKey: process.env.APP_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
      });
      const last6 = messages.slice(-6);
      const conversation = last6
        .map(m => `${String(m.role).toUpperCase()}: ${String(m.content).slice(0, 500)}`)
        .join('\n');

      const response = await haiku.messages.create({
        model: MODEL_HAIKU,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: `Extract 0-4 specific memorable facts about the person from this conversation.
Only extract concrete long-term facts: skills, projects, goals, preferences, opinions, personal details, life events.
Skip small talk, instructions, and anything task-specific or ephemeral.
One fact per line, plain text, no bullets or numbers. If nothing memorable, return nothing.

${conversation}`,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
      if (!text) return;

      const facts = text
        .split('\n')
        .map(f => f.trim())
        .filter(f => f.length > 15);
      for (const fact of facts.slice(0, 4)) {
        await storeMemory(userId, fact, 'conversation');
      }
    } catch {
      // silent fail
    }
  })();
}

import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { requireAdmin } from '../_auth';
import { MODEL_SONNET, MODEL_OPUS } from '@/lib/models';

export const maxDuration = 60;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY,
});

const ALLOWED_SLUGS = new Set([
  'orchestrator',
  'architect',
  'senior-engineer',
  'ai-engineer',
  'product',
  'designer',
  'devops',
  'security',
  'qa',
  'growth',
  'data-analyst',
  'mobile',
  'finance',
  'legal',
  'community',
  'chief-of-staff',
  'technical-writer',
]);

// Orchestrator + senior technical agents get Opus — they need the depth
const OPUS_SLUGS = new Set(['orchestrator', 'architect', 'senior-engineer', 'ai-engineer']);

function loadSystemPrompt(slug: string): string {
  try {
    const filePath = path.join(process.cwd(), '.claude', 'agents', `${slug}.md`);
    const raw = readFileSync(filePath, 'utf-8');
    return (
      raw +
      '\n\n---\nYou are responding via the Based Team hub — a direct chat interface. ' +
      'Be direct and concise. No preamble. Respond as your specialist self, not as a generic assistant.'
    );
  } catch {
    return `You are the ${slug} specialist agent for Based AI studio. Be direct and expert.`;
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    const status = msg === 'Forbidden' ? 403 : 401;
    return new Response(JSON.stringify({ error: msg }), { status });
  }

  let body: { agent?: string; messages?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
  }

  const { agent, messages } = body;

  if (!agent || typeof agent !== 'string' || !ALLOWED_SLUGS.has(agent)) {
    return new Response(JSON.stringify({ error: 'Invalid agent' }), { status: 400 });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages required' }), { status: 400 });
  }

  const systemPrompt = loadSystemPrompt(agent);
  const model = OPUS_SLUGS.has(agent) ? MODEL_OPUS : MODEL_SONNET;

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = await client.messages.stream({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: messages as Parameters<typeof client.messages.stream>[0]['messages'],
        });
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 200) : 'stream_failed';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

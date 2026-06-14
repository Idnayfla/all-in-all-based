import Anthropic from '@anthropic-ai/sdk';
import { MODEL_SONNET } from './models';

type SSEController = ReadableStreamDefaultController<Uint8Array>;

function pushSSE(ctrl: SSEController, enc: TextEncoder, text: string) {
  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ text })}\n\n`));
}

async function parseOAIStream(
  body: ReadableStream<Uint8Array>,
  ctrl: SSEController,
  enc: TextEncoder
): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const j = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
        const t = j.choices?.[0]?.delta?.content;
        if (t) pushSSE(ctrl, enc, t);
      } catch {
        /* ignore malformed chunks */
      }
    }
  }
}

async function tryGroq(
  system: string,
  messages: Array<{ role: string; content: string }>,
  ctrl: SSEController,
  enc: TextEncoder
): Promise<boolean> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    if (!res.ok || !res.body) return false;
    await parseOAIStream(res.body, ctrl, enc);
    return true;
  } catch {
    return false;
  }
}

async function tryCerebras(
  system: string,
  messages: Array<{ role: string; content: string }>,
  ctrl: SSEController,
  enc: TextEncoder
): Promise<boolean> {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    if (!res.ok || !res.body) return false;
    await parseOAIStream(res.body, ctrl, enc);
    return true;
  } catch {
    return false;
  }
}

async function anthropicFallback(
  client: Anthropic,
  system: string,
  messages: Anthropic.MessageParam[],
  ctrl: SSEController,
  enc: TextEncoder
): Promise<void> {
  // Sonnet — Opus is reserved for app generation only
  const stream = await client.messages.stream({
    model: MODEL_SONNET,
    max_tokens: 1024,
    system,
    messages,
  });
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      pushSSE(ctrl, enc, chunk.delta.text);
    }
  }
}

/**
 * Route companion chat to the cheapest available provider.
 *
 * Priority: Groq (free) → Cerebras (free) → Anthropic Sonnet (paid fallback).
 *
 * Vision requests bypass free-tier routing — Groq/Cerebras require image URLs,
 * not the base64 blobs we send, so they go directly to Anthropic.
 */
export async function streamCompanion(opts: {
  client: Anthropic;
  system: string;
  textMessages: Array<{ role: string; content: string }>;
  anthropicMessages: Anthropic.MessageParam[];
  hasVision: boolean;
  controller: SSEController;
  encoder: TextEncoder;
}): Promise<void> {
  const { client, system, textMessages, anthropicMessages, hasVision, controller, encoder } = opts;

  if (!hasVision) {
    if (await tryGroq(system, textMessages, controller, encoder)) return;
    if (await tryCerebras(system, textMessages, controller, encoder)) return;
  }

  await anthropicFallback(client, system, anthropicMessages, controller, encoder);
}

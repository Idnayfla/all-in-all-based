import Anthropic from '@anthropic-ai/sdk';
import { MODEL_SONNET } from './models';

type SSEController = ReadableStreamDefaultController<Uint8Array>;

function pushSSE(ctrl: SSEController, enc: TextEncoder, text: string) {
  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ text })}\n\n`));
}

async function parseGeminiStream(
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
      if (!raw || raw === '[DONE]') continue;
      try {
        const j = JSON.parse(raw) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const t = j.candidates?.[0]?.content?.parts?.[0]?.text;
        if (t) pushSSE(ctrl, enc, t);
      } catch {
        /* ignore malformed chunks */
      }
    }
  }
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

async function tryGeminiVision(
  system: string,
  textMessages: Array<{ role: string; content: string }>,
  visionBase64: string,
  visionMediaType: string,
  ctrl: SSEController,
  enc: TextEncoder
): Promise<boolean> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return false;
  try {
    const contents = textMessages.map((m, i) => {
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (i === textMessages.length - 1 && m.role === 'user') {
        return {
          role,
          parts: [
            { text: m.content || 'Look at this screen.' },
            { inlineData: { mimeType: visionMediaType, data: visionBase64 } },
          ],
        };
      }
      return { role, parts: [{ text: m.content }] };
    });

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { temperature: 0.9, maxOutputTokens: 1024 },
        }),
      }
    );
    if (!res.ok || !res.body) return false;
    await parseGeminiStream(res.body, ctrl, enc);
    return true;
  } catch {
    return false;
  }
}

async function tryOllama(
  system: string,
  messages: Array<{ role: string; content: string }>,
  ctrl: SSEController,
  enc: TextEncoder
): Promise<boolean> {
  const url = process.env.OLLAMA_URL;
  if (!url) return false;
  const model = process.env.OLLAMA_MODEL ?? 'llama3.2';
  try {
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body) return false;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          if (j.message?.content) pushSSE(ctrl, enc, j.message.content);
        } catch { /* skip malformed chunk */ }
      }
    }
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
 * Priority:
 *   Vision  → Gemini 2.0 Flash (free) → Anthropic Sonnet fallback
 *   No vision → Groq (free) → Cerebras (free) → Anthropic Sonnet fallback
 *
 * Groq/Cerebras don't accept base64 image blobs, so vision always routes
 * to Gemini first. Anthropic is the paid fallback for both paths.
 */
export async function streamCompanion(opts: {
  client: Anthropic;
  system: string;
  textMessages: Array<{ role: string; content: string }>;
  anthropicMessages: Anthropic.MessageParam[];
  hasVision: boolean;
  visionBase64?: string;
  visionMediaType?: string;
  controller: SSEController;
  encoder: TextEncoder;
}): Promise<void> {
  const {
    client,
    system,
    textMessages,
    anthropicMessages,
    hasVision,
    visionBase64,
    visionMediaType,
    controller,
    encoder,
  } = opts;

  // Offline / self-hosted: Ollama takes priority over all cloud providers when OLLAMA_URL is set
  if (await tryOllama(system, textMessages, controller, encoder)) return;

  if (hasVision && visionBase64 && visionMediaType) {
    if (
      await tryGeminiVision(
        system,
        textMessages,
        visionBase64,
        visionMediaType,
        controller,
        encoder
      )
    )
      return;
  } else if (!hasVision) {
    if (await tryGroq(system, textMessages, controller, encoder)) return;
    if (await tryCerebras(system, textMessages, controller, encoder)) return;
  }

  await anthropicFallback(client, system, anthropicMessages, controller, encoder);
}

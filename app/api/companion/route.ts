import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId } from '@/app/api/_auth';

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.APP_ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { messages, personality, memory, screenshot, previewSource } = await req.json();

  const systemParts = [personality];
  if (memory) systemParts.push(`User memory:\n${memory}`);
  const system = systemParts.join('\n\n');

  // Inject screenshot or previewSource into the last user message
  const apiMessages = (messages as Array<{ role: string; content: string }>).map((m, i) => {
    if (i !== messages.length - 1 || m.role !== 'user') return m;

    if (screenshot) {
      const base64 = screenshot.replace(/^data:image\/\w+;base64,/, '');
      return {
        role: 'user' as const,
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: base64 } },
          { type: 'text' as const, text: m.content },
        ],
      };
    }

    if (previewSource) {
      return { role: 'user' as const, content: `Here is the current preview source:\n\n${previewSource}\n\n${m.content}` };
    }

    return m;
  });

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system,
    messages: apiMessages as Parameters<typeof client.messages.stream>[0]['messages'],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`));
          }
        }
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
      'Connection': 'keep-alive',
    },
  });
}

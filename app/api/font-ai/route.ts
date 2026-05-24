import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId } from '../_auth';

export const maxDuration = 120;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY,
});

const SYSTEM = `You are Font Studio — a specialized AI that designs original typefaces using SVG path data. You are NOT the main Based assistant. You only do font design.

When the user describes a font, output:
1. A short design note (2-3 sentences about your choices)
2. A complete font definition block in this exact format:

<<<FONT_DEF>>>
{
  "name": "FontName",
  "description": "one-line style summary",
  "metrics": { "unitsPerEm": 100, "ascent": 80, "descent": -20 },
  "glyphs": {
    "A": { "path": "M10,75 L50,5 L90,75 M20,55 L80,55", "width": 80 },
    "B": { "path": "M15,5 L15,75 M15,5 Q55,5 55,25 Q55,40 15,40 Q60,40 60,58 Q60,75 15,75", "width": 75 },
    ...all other characters...
  }
}
<<<END_FONT_DEF>>>

SVG coordinate system rules:
- Canvas is 0–100 wide, 0–100 tall. Top is y=0, bottom is y=100.
- Baseline sits at y=75. Cap height at y=10. x-height at y=38. Descenders reach y=92.
- Valid SVG path commands: M (moveto), L (lineto), C (cubic bezier), Q (quadratic bezier), A (arc), Z (close).
- width = advance width in units (typically 55–85; space = 35).

You MUST include every one of these characters in "glyphs":
A B C D E F G H I J K L M N O P Q R S T U V W X Y Z
a b c d e f g h i j k l m n o p q r s t u v w x y z
0 1 2 3 4 5 6 7 8 9
(space) . , ! ? : ; - _ ( ) ' "

Be consistent — same stroke weight, angle, and personality across all glyphs. When the user asks for changes, output the full updated <<<FONT_DEF>>> block again.`;

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const messages = body.messages as Array<{ role: string; content: string }>;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = await client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: SYSTEM,
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
        const reason = err instanceof Error ? err.message.slice(0, 200) : 'stream_failed';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: reason })}\n\n`));
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

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId } from '../_auth';

export const maxDuration = 60;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are a Three.js scene generator. Given a description, return ONLY a JavaScript function body that builds a Three.js scene.
The function receives (THREE, scene, camera, renderer) as arguments.
Use only Three.js core — no imports, no external libs.
Clear the scene first: while(scene.children.length > 0) scene.remove(scene.children[0]);
Then add lights, geometry, materials, meshes.
You may also set up an animation loop by assigning to renderer.userData.animateFn = function(time) { ... } where time is elapsed ms.
Return only executable JS — no markdown, no explanation, no backticks.`;

export async function POST(req: NextRequest) {
  // Auth gate — must be signed in
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let prompt: string;
  try {
    const body = await req.json();
    prompt = (body.prompt ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const code =
      message.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('') ?? '';

    return NextResponse.json({ code });
  } catch (e: any) {
    console.error('[generate-3d] Claude error:', e);
    return NextResponse.json({ error: e?.message ?? 'Generation failed' }, { status: 500 });
  }
}

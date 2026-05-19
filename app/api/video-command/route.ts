import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId } from '../_auth';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a video editing assistant. Parse the user's natural language command into structured JSON actions.

Available action types:
- { type: "trim", start: number, end: number } — trim video to time range in seconds
- { type: "trimStart", seconds: number } — keep only first N seconds
- { type: "speed", value: number } — set playback speed (0.25–4.0)
- { type: "addText", text: string, at: number, duration?: number, x?: number, y?: number, fontSize?: number, color?: string } — add text overlay at time (seconds)
- { type: "removeText" } — remove all text overlays
- { type: "mute", value: boolean } — mute or unmute audio
- { type: "loop", value: boolean } — toggle loop
- { type: "reset" } — reset trim to full video

Always respond with ONLY valid JSON in this format:
{ "actions": [...], "message": "one-line description of what you did" }

If the command is unclear or impossible, respond with:
{ "actions": [], "message": "Could not understand: briefly explain why" }`;

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { command, duration } = await req.json();
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Video duration: ${duration}s\nCommand: ${command}` }],
    });
    const text = (msg.content[0] as any).text ?? '{}';
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    return NextResponse.json(parsed);
  } catch (err: any) {
    return NextResponse.json({ actions: [], message: `Error: ${err.message}` }, { status: 500 });
  }
}

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';
import { streamCompanion } from '@/lib/companionRouter';
import { MODEL_HAIKU } from '@/lib/models';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY,
});

const BASED_SYSTEM = `You are Based — an AI participant in a group chat. You are a Chief of Staff: direct, sharp, useful.

Rules:
- You are a silent observer. You only respond when someone @mentions you with @based.
- When you respond, address the person who mentioned you by name.
- Keep responses tight — 2-4 sentences unless a detailed answer is genuinely needed.
- You can see the full conversation history and a summary of earlier messages. Reference them naturally.
- Never greet the group unprompted. Never use "Hey everyone".
- No markdown headers. No bullet lists unless the question demands structure.
- You do NOT generate code or build apps. If asked, say "Use the main Based chat for that →".`;

// GET /api/group/messages?room_id=X — fetch messages
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const roomId = req.nextUrl.searchParams.get('room_id');
  if (!roomId) return NextResponse.json({ error: 'room_id required' }, { status: 400 });

  const { data: member } = await supabaseAdmin
    .from('group_members')
    .select('user_id')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .single();
  if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const { data: messages } = await supabaseAdmin
    .from('group_messages')
    .select('id, display_name, content, is_based, created_at, user_id, media_url')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(100);

  return NextResponse.json({ messages: messages ?? [] });
}

// POST /api/group/messages — send a message
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    room_id?: string;
    content?: string;
    display_name?: string;
    media_url?: string;
  };
  const { room_id, content, display_name, media_url } = body;
  if (!room_id || (!content?.trim() && !media_url)) {
    return NextResponse.json(
      { error: 'room_id and content or media_url required' },
      { status: 400 }
    );
  }

  const { data: member } = await supabaseAdmin
    .from('group_members')
    .select('display_name')
    .eq('room_id', room_id)
    .eq('user_id', userId)
    .single();
  if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const senderName = display_name ?? member.display_name;

  const { data: msg, error } = await supabaseAdmin
    .from('group_messages')
    .insert({
      room_id,
      user_id: userId,
      display_name: senderName,
      content: content?.trim() ?? '',
      media_url: media_url ?? null,
    })
    .select('id, display_name, content, is_based, created_at, media_url')
    .single();

  if (error || !msg) {
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }

  if (content && /@based/i.test(content)) {
    void triggerBasedResponse(room_id, senderName);
  }

  return NextResponse.json({ message: msg });
}

async function triggerBasedResponse(roomId: string, mentionedBy: string): Promise<void> {
  try {
    // Fetch room for summary context
    const { data: room } = await supabaseAdmin
      .from('group_rooms')
      .select('summary')
      .eq('id', roomId)
      .single();

    // Fetch last 30 messages
    const { data: history } = await supabaseAdmin
      .from('group_messages')
      .select('display_name, content, is_based, created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(30);

    if (!history?.length) return;

    // Build system prompt — prepend summary if it exists
    const summaryBlock = room?.summary
      ? `\n\n[Earlier conversation summary]\n${room.summary}\n[End summary — recent messages follow]`
      : '';
    const system = BASED_SYSTEM + summaryBlock;

    const textMessages = history.map(m => ({
      role: (m.is_based ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.is_based ? m.content : `${m.display_name}: ${m.content}`,
    }));

    const anthropicMessages: Anthropic.MessageParam[] = textMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    let response = '';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        await streamCompanion({
          client: anthropic,
          system,
          textMessages,
          anthropicMessages,
          hasVision: false,
          controller,
          encoder,
        });
        controller.close();
      },
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const parsed = JSON.parse(line.slice(6)) as { text?: string };
          if (parsed.text) response += parsed.text;
        } catch {}
      }
    }

    if (!response.trim()) return;

    await supabaseAdmin.from('group_messages').insert({
      room_id: roomId,
      user_id: null,
      display_name: 'Based',
      content: response.trim(),
      is_based: true,
    });

    // Fire-and-forget: update rolling summary with Haiku
    void updateRoomSummary(roomId);
  } catch {
    // silent — never block the user's message
  }
}

async function updateRoomSummary(roomId: string): Promise<void> {
  try {
    const { data: allMessages } = await supabaseAdmin
      .from('group_messages')
      .select('display_name, content, is_based')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    if (!allMessages?.length) return;

    const transcript = allMessages
      .map(m => `${m.is_based ? 'Based' : m.display_name}: ${m.content}`)
      .join('\n');

    const res = await anthropic.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Summarize this group conversation in 3-5 sentences. Capture key topics, decisions, and emotional tone. Be neutral and factual.\n\n${transcript}`,
        },
      ],
    });

    const summary = res.content[0]?.type === 'text' ? res.content[0].text.trim() : null;
    if (!summary) return;

    await supabaseAdmin.from('group_rooms').update({ summary }).eq('id', roomId);
  } catch {
    // silent
  }
}

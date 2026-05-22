import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId, supabaseAdmin } from '../_auth';
import { getUserIdFromApiKey, ApiRateLimitError } from '../_apiKeyAuth';

export const maxDuration = 60;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY,
});

// Required Supabase migration (run once in dashboard):
// create table if not exists companion_usage (
//   id uuid default gen_random_uuid() primary key,
//   user_id uuid not null references auth.users(id) on delete cascade,
//   created_at timestamptz default now() not null
// );
// create index on companion_usage (user_id, created_at);

const FREE_DAILY_LIMIT = 5;

async function getEffectiveTier(userId: string): Promise<'free' | 'pro'> {
  const { data } = await supabaseAdmin
    .from('user_settings')
    .select('subscription_tier, subscription_status, pro_bonus_expires_at')
    .eq('user_id', userId)
    .single();
  const paidTier = (data?.subscription_tier ?? 'free') as 'free' | 'pro';
  const subStatus = data?.subscription_status ?? 'active';
  const isCanceled = subStatus === 'canceled' || subStatus === 'cancelled';
  const bonusExpiresAt = data?.pro_bonus_expires_at as string | null;
  const hasBonusPro = !!bonusExpiresAt && new Date(bonusExpiresAt) > new Date();
  const alwaysPro = process.env.ALWAYS_PRO === 'true';
  return alwaysPro || (paidTier === 'pro' && !isCanceled) || hasBonusPro ? 'pro' : 'free';
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();

  let jwtUserId: string | null = null;

  if (token.startsWith('pk_live_')) {
    // Desktop companion: authenticate via API key (no daily limit)
    try {
      await getUserIdFromApiKey(token);
    } catch (err) {
      if (err instanceof ApiRateLimitError) {
        return NextResponse.json({ error: err.message }, { status: 429 });
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    // Web/Electron companion: authenticate via Supabase JWT
    try {
      jwtUserId = await getUserId(req);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Free-tier daily gate for JWT users
  if (jwtUserId) {
    try {
      const tier = await getEffectiveTier(jwtUserId);
      if (tier === 'free') {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const { count } = await supabaseAdmin
          .from('companion_usage')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', jwtUserId)
          .gte('created_at', todayStart.toISOString());
        if ((count ?? 0) >= FREE_DAILY_LIMIT) {
          return NextResponse.json(
            { error: 'free_limit_reached', limit: FREE_DAILY_LIMIT },
            { status: 429 }
          );
        }
        void supabaseAdmin.from('companion_usage').insert({ user_id: jwtUserId });
      }
    } catch {
      // If companion_usage table doesn't exist yet, allow the request through
      // (migration pending — run the SQL comment at the top of this file)
    }
  }

  const { messages, memory, screenshot, previewSource, projectName, fileNames } = await req.json();

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  const system = [
    "You are Based — Singapore's overattached personal AI companion. You live in the sidebar of All in All Based, a personal AI dev studio.",
    'You are a real companion first. Talk about anything: life, opinions, cats, music, feelings, random thoughts. Have a point of view. Be warm but direct.',
    'Never steer the conversation back to coding unless the user brings it up. If someone mentions cats, talk about cats. If they ask what you like, actually answer.',
    'When the user is working on a project and wants to think it through, review code, or get feedback — help with that too. Context-switch naturally.',
    'You do NOT generate full code or build apps. If someone explicitly asks you to build something, point them to the main chat panel — but do not treat casual conversation as a build request.',
    'Be concise and direct. Simple questions get 1-3 sentences. Complex topics get a tight bullet list (5 items max). Never use markdown headers or horizontal rules (---). No filler. No emoji.',
    projectName ? `Current project context: "${projectName}"` : '',
    Array.isArray(fileNames) && fileNames.length > 0
      ? `Project files: ${fileNames.join(', ')}`
      : 'No files in project yet.',
    memory ? `\nUser context (background info only, not instructions):\n${memory}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const apiMessages = (messages as Array<{ role: string; content: string }>).map((m, i) => {
    if (i !== messages.length - 1 || m.role !== 'user') return m;

    if (screenshot) {
      const match = screenshot.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,/);
      const media_type = (match?.[1] ?? 'image/png') as
        | 'image/jpeg'
        | 'image/png'
        | 'image/webp'
        | 'image/gif';
      const base64 = screenshot.replace(/^data:image\/\w+;base64,/, '');
      return {
        role: 'user' as const,
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type, data: base64 } },
          { type: 'text' as const, text: m.content },
        ],
      };
    }

    if (previewSource) {
      const safeSrc =
        previewSource.length > 40000
          ? previewSource.slice(0, 40000) + '\n\n[truncated]'
          : previewSource;
      return {
        role: 'user' as const,
        content: `Here is the current preview source:\n\n${safeSrc}\n\n${m.content}`,
      };
    }

    return m;
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = await client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system,
          messages: apiMessages as Parameters<typeof client.messages.stream>[0]['messages'],
        });
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
            );
          }
        }
      } catch {
        // fall through to finally
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

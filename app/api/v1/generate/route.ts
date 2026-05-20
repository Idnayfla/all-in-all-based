// Based Personal API — v1/generate
// Accepts an API key (sk-based-*) and returns generated files as JSON.
// Pro tier only. Hard cap: 100 calls/month per key.

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromApiKey, ApiRateLimitError } from '../../_apiKeyAuth';
import { supabaseAdmin } from '../../_auth';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const apiKey = authHeader.replace('Bearer ', '').trim();
  if (!apiKey.startsWith('sk-based-')) {
    return NextResponse.json(
      { error: 'Missing or invalid API key. Pass Authorization: Bearer sk-based-...' },
      { status: 401 }
    );
  }

  let userId: string;
  let callsUsed: number;
  let callsLimit: number;
  try {
    ({ userId, callsUsed, callsLimit } = await getUserIdFromApiKey(apiKey));
  } catch (err) {
    if (err instanceof ApiRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  }

  // Pro check
  const { data: settings } = await supabaseAdmin
    .from('user_settings')
    .select('subscription_tier, pro_bonus_expires_at')
    .eq('user_id', userId)
    .single();

  const isPro =
    settings?.subscription_tier === 'pro' ||
    (settings?.pro_bonus_expires_at && new Date(settings.pro_bonus_expires_at) > new Date());
  if (!isPro) {
    return NextResponse.json(
      { error: 'Pro subscription required to use the API' },
      { status: 403 }
    );
  }

  let body: { prompt?: string; projectType?: string; existingFiles?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { prompt, projectType, existingFiles } = body;
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  const origin = req.nextUrl.origin;
  const generateRes = await fetch(`${origin}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-user-id': userId,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      projectType: projectType ?? null,
      files: existingFiles ?? [],
      apiMode: true,
    }),
  });

  if (!generateRes.ok) {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }

  const reader = generateRes.body?.getReader();
  if (!reader) return NextResponse.json({ error: 'No response body' }, { status: 500 });

  const decoder = new TextDecoder();
  let files: unknown[] = [];
  let reply = '';
  let projectTypeOut = projectType ?? null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.done) {
          files = data.files ?? [];
          reply = data.reply ?? '';
          projectTypeOut = data.projectType ?? projectTypeOut;
        }
      } catch {}
    }
  }

  return NextResponse.json(
    { files, reply, projectType: projectTypeOut },
    {
      headers: {
        'X-RateLimit-Limit': String(callsLimit),
        'X-RateLimit-Remaining': String(callsLimit - callsUsed),
        'X-RateLimit-Reset': 'monthly',
      },
    }
  );
}

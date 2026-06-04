import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/api/_auth';

export async function POST(req: NextRequest) {
  try {
    // ── No auth guard ─────────────────────────────────────────────────────────
    // Feedback is frequently submitted from error/degraded states (e.g. the
    // "Report" button shown when generation fails), where the session token may
    // be stale or unavailable. Requiring auth here caused reports to silently
    // 401 while the UI still showed "Reported". IP rate limiting below already
    // prevents spam, so we accept unauthenticated feedback by design.

    // ── IP rate limit: max 5 requests per IP per hour (belt-and-suspenders) ───
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      'unknown';
    if (process.env.REDIS_URL) {
      try {
        const { createClient } = await import('redis');
        const redis = createClient({ url: process.env.REDIS_URL });
        // Attach an error listener — without one, node-redis throws emitted
        // 'error' events as unhandled exceptions that bypass try/catch.
        redis.on('error', () => {});
        await redis.connect();
        const key = `feedback:${ip}`;
        const count = await redis.incr(key);
        if (count === 1) {
          await redis.expire(key, 3600);
        }
        await redis.disconnect();
        if (count > 5) {
          return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }
      } catch {
        /* fail open — never block users due to Redis issues */
      }
    }

    const { message, email, type, context } = await req.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('feedback').insert({
      message: message.trim().slice(0, 2000),
      email: email?.trim() || null,
      type: type || 'general',
      context: context?.trim().slice(0, 500) || null,
    });

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error('[feedback]', e);
    return NextResponse.json({ error: 'Could not save feedback' }, { status: 500 });
  }
}

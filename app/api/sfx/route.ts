import { NextRequest, NextResponse } from 'next/server';

// Mixkit changed CDN path: sfx/preview/ returns 403 (S3 block).
// Correct path: active_storage/sfx/{id}/{id}-preview.mp3
// where {id} is the trailing number in the slug (mixkit-horror-lose-2011 → 2011).
export async function GET(req: NextRequest) {
  // ── Rate limiting: max 60 requests per IP per minute ──────────────────────
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  if (process.env.REDIS_URL) {
    try {
      const { createClient } = await import('redis');
      const redis = createClient({ url: process.env.REDIS_URL });
      await redis.connect();
      const key = `sfx:${ip}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, 60);
      }
      await redis.disconnect();
      if (count > 60) {
        return new NextResponse('Too many requests', { status: 429 });
      }
    } catch {
      /* fail open — never block users due to Redis issues */
    }
  }

  const slug = req.nextUrl.searchParams.get('slug') ?? '';

  if (!/^[a-z0-9-]{3,80}$/.test(slug)) {
    return new NextResponse('Invalid slug', { status: 400 });
  }

  const idMatch = slug.match(/(\d+)$/);
  if (!idMatch) {
    return new NextResponse('Slug must end with a numeric Mixkit asset ID', { status: 400 });
  }
  const id = idMatch[1];
  const url = `https://assets.mixkit.co/active_storage/sfx/${id}/${id}-preview.mp3`;

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      return new NextResponse('Audio not found', { status: upstream.status });
    }

    const body = upstream.body;
    if (!body) return new NextResponse('No body', { status: 502 });

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new NextResponse('Fetch failed', { status: 502 });
  }
}

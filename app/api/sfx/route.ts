import { NextRequest, NextResponse } from 'next/server';

// Allowed slug prefixes — only Mixkit assets, no SSRF
const MIXKIT_BASE = 'https://assets.mixkit.co/sfx/preview/';

// Server-side audio proxy: generated HTML calls /api/sfx?slug=mixkit-horror-lose-2011
// The server fetches from Mixkit (no CORS server-side), streams it back same-origin.
// This means zero CORS issues inside the sandboxed iframe preview.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') ?? '';

  // Only allow safe slug characters — letters, numbers, hyphens
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) {
    return new NextResponse('Invalid slug', { status: 400 });
  }

  const url = `${MIXKIT_BASE}${slug}.mp3`;

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      return new NextResponse('Audio not found', { status: 404 });
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

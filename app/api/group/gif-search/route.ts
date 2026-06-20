import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../_auth';

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.TENOR_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GIF search not configured' }, { status: 503 });

  const q = req.nextUrl.searchParams.get('q') ?? '';
  const trending = req.nextUrl.searchParams.get('trending') === '1';

  const base = trending
    ? `https://tenor.googleapis.com/v2/featured?key=${apiKey}&limit=20&media_filter=tinygif`
    : `https://tenor.googleapis.com/v2/search?key=${apiKey}&q=${encodeURIComponent(q)}&limit=20&media_filter=tinygif`;

  const res = await fetch(base);
  if (!res.ok) return NextResponse.json({ gifs: [] });

  const data = (await res.json()) as {
    results: { media_formats: { tinygif?: { url: string }; gif?: { url: string } } }[];
  };

  const gifs = data.results
    .map(r => r.media_formats.tinygif?.url ?? r.media_formats.gif?.url)
    .filter((u): u is string => !!u);

  return NextResponse.json({ gifs });
}

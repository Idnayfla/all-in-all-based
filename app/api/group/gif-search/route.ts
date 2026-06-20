import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../_auth';

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GIF search not configured' }, { status: 503 });

  const q = req.nextUrl.searchParams.get('q') ?? '';
  const trending = req.nextUrl.searchParams.get('trending') === '1';

  const base = trending
    ? `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=20&rating=g`
    : `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(q)}&limit=20&rating=g`;

  const res = await fetch(base);
  if (!res.ok) return NextResponse.json({ gifs: [] });

  const data = (await res.json()) as {
    data: { images: { fixed_width_small?: { url: string }; original?: { url: string } } }[];
  };

  const gifs = data.data
    .map(r => r.images.fixed_width_small?.url ?? r.images.original?.url)
    .filter((u): u is string => !!u);

  return NextResponse.json({ gifs });
}

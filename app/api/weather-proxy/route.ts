import { NextRequest, NextResponse } from 'next/server';

const CORS = { 'Access-Control-Allow-Origin': '*' };

// Same-origin weather proxy for generated apps. Generated HTML runs in a
// sandboxed iframe with no API keys, so it can't call OpenWeatherMap directly.
// This route fetches free, key-less data from wttr.in server-side and returns
// a simplified JSON shape the generated app can consume.
export async function GET(req: NextRequest) {
  const location = req.nextUrl.searchParams.get('location') ?? 'Singapore';
  // Sanitize: only allow alphanumeric, spaces, and commas. Cap length.
  const safe = location.replace(/[^a-zA-Z0-9 ,]/g, '').slice(0, 50) || 'Singapore';

  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(safe)}?format=j1`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'Weather unavailable' }, { status: 502, headers: CORS });
    }
    const data = await res.json();
    const w = data.current_condition?.[0];
    return NextResponse.json(
      {
        location: safe,
        temp_c: w?.temp_C,
        temp_f: w?.temp_F,
        description: w?.weatherDesc?.[0]?.value,
        humidity: w?.humidity,
        wind_kmph: w?.windspeedKmph,
        feels_like_c: w?.FeelsLikeC,
      },
      { headers: CORS }
    );
  } catch {
    return NextResponse.json({ error: 'Weather unavailable' }, { status: 502, headers: CORS });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
  });
}

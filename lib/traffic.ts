const CHECKPOINTS: Record<string, { lat: number; lon: number; label: string }> = {
  woodlands: { lat: 1.4473, lon: 103.7634, label: 'Woodlands Checkpoint (Causeway)' },
  tuas: { lat: 1.3428, lon: 103.639, label: 'Tuas Checkpoint (Second Link)' },
};

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resolveCheckpoint(location: string): string {
  const l = location.toLowerCase();
  if (l.includes('tuas') || l.includes('second link')) return 'tuas';
  return 'woodlands';
}

async function getLtaIncidents(key: string): Promise<string | null> {
  const ltaKey = process.env.LTA_DATAMALL_API_KEY;
  if (!ltaKey) return null;
  const cp = CHECKPOINTS[key];
  try {
    const res = await fetch('https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents', {
      headers: { AccountKey: ltaKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const { value } = (await res.json()) as {
      value: Array<{ Type: string; Latitude: number; Longitude: number; Message: string }>;
    };
    const nearby = value.filter(inc => distanceKm(inc.Latitude, inc.Longitude, cp.lat, cp.lon) < 3);
    if (nearby.length === 0) return 'No incidents reported near checkpoint.';
    return nearby.map(inc => `[${inc.Type}] ${inc.Message}`).join('\n');
  } catch {
    return null;
  }
}

async function getTavilyTraffic(key: string): Promise<string | null> {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) return null;
  const cp = CHECKPOINTS[key];
  const now = new Date();
  const day = now.toLocaleDateString('en-SG', { weekday: 'long', timeZone: 'Asia/Singapore' });
  const time = now.toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  });
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyKey,
        query: `"${cp.label}" traffic wait time congestion ${day} ${time} Singapore`,
        search_depth: 'basic',
        max_results: 3,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ title: string; content: string }> };
    if (!data.results?.length) return null;
    return data.results.map(r => `${r.title}: ${r.content.slice(0, 300)}`).join('\n\n');
  } catch {
    return null;
  }
}

export async function getTrafficInfo(location: string): Promise<string> {
  const key = resolveCheckpoint(location);
  const cp = CHECKPOINTS[key];

  const [ltaResult, tavilyResult] = await Promise.allSettled([
    getLtaIncidents(key),
    getTavilyTraffic(key),
  ]);

  const parts: string[] = [`Checkpoint: ${cp.label}`];

  const ltaData = ltaResult.status === 'fulfilled' ? ltaResult.value : null;
  const tavilyData = tavilyResult.status === 'fulfilled' ? tavilyResult.value : null;

  if (ltaData) parts.push(`LTA Incidents:\n${ltaData}`);
  if (tavilyData) parts.push(`Current conditions:\n${tavilyData}`);

  return parts.join('\n\n') || 'Traffic data temporarily unavailable.';
}

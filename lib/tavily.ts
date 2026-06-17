export async function exaSearch(query: string, numResults = 3): Promise<string | null> {
  const key = process.env.EXA_API_KEY;
  if (!key) return null;

  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      query,
      numResults,
      contents: { text: { maxCharacters: 800 } },
      useAutoprompt: true,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();

  interface ExaResult {
    title: string;
    url: string;
    text?: string;
    publishedDate?: string;
  }

  const parts: string[] = [];
  (data.results ?? []).slice(0, numResults).forEach((r: ExaResult) => {
    const snippet = r.text ? r.text.trim() : '';
    parts.push(`[${r.title}]\n${snippet}\nSource: ${r.url}`);
  });

  return parts.length ? parts.join('\n\n---\n\n') : null;
}

export async function searchWeb(query: string, maxResults = 3): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return '';

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: true,
    }),
  });

  if (!res.ok) return '';
  const data = await res.json();

  const parts: string[] = [];
  if (data.answer) parts.push(`Answer: ${data.answer}`);
  interface TavilyResult {
    title: string;
    content: string;
    url: string;
  }
  (data.results ?? []).slice(0, maxResults).forEach((r: TavilyResult) => {
    parts.push(`[${r.title}]\n${r.content}\nSource: ${r.url}`);
  });

  return parts.join('\n\n---\n\n');
}

async function searchImagesExa(
  query: string,
  maxImages: number,
  key: string
): Promise<Array<{ url: string; title: string }>> {
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      query: `${query} photo`,
      numResults: maxImages * 4,
      contents: { summary: { query: 'image' } },
      useAutoprompt: true,
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  interface ExaResult { title: string; url: string; image?: string }
  const seen = new Set<string>();
  const images: Array<{ url: string; title: string }> = [];
  for (const r of (data.results ?? []) as ExaResult[]) {
    const url = r.image;
    if (url && url.startsWith('https') && !seen.has(url)) {
      seen.add(url);
      images.push({ url, title: r.title || query });
      if (images.length >= maxImages) break;
    }
  }
  return images;
}

function toHttps(url: string): string | null {
  if (!url) return null;
  if (url.startsWith('https://')) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return null;
}

async function wikiSummaryImage(title: string): Promise<{ url: string; title: string } | null> {
  try {
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    );
    if (!r.ok) return null;
    const p = await r.json() as { thumbnail?: { source?: string }; originalimage?: { source?: string }; title?: string };
    const src = p?.thumbnail?.source ?? p?.originalimage?.source;
    const safe = src ? toHttps(src) : null;
    return safe ? { url: safe, title: p.title ?? title } : null;
  } catch {
    return null;
  }
}

async function searchImagesWikimedia(
  query: string,
  maxImages: number
): Promise<Array<{ url: string; title: string }>> {
  // Step 1: try direct REST summary on the query string (fast path for well-known topics)
  const direct = await wikiSummaryImage(query);
  if (direct) return [direct];

  // Step 2: search Wikipedia for matching articles, then fetch REST summary for each
  try {
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=0&srlimit=10&format=json&origin=*`
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json() as { query?: { search?: { title: string }[] } };
    const titles = (searchData.query?.search ?? []).map(r => r.title);
    const images: Array<{ url: string; title: string }> = [];

    for (const title of titles.slice(0, 8)) {
      if (images.length >= maxImages) break;
      const img = await wikiSummaryImage(title);
      if (img) images.push(img);
    }
    return images;
  } catch {
    return [];
  }
}

export async function searchImages(
  query: string,
  maxImages = 5
): Promise<Array<{ url: string; title: string }>> {
  const exaKey = process.env.EXA_API_KEY;

  // Try Exa first if key available
  if (exaKey) {
    try {
      const results = await searchImagesExa(query, maxImages, exaKey);
      if (results.length > 0) return results;
    } catch { /* fall through */ }
  }

  // Always-available fallback: Wikipedia/Wikimedia (no key needed)
  try {
    return await searchImagesWikimedia(query, maxImages);
  } catch {
    return [];
  }
}

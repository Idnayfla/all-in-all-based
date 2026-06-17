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
  if (url.startsWith('https://') || url.startsWith('http://')) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return null;
}

async function searchImagesWikimedia(
  query: string,
  maxImages: number
): Promise<Array<{ url: string; title: string }>> {
  const encoded = encodeURIComponent(query);

  // Step 1: direct pageimages lookup on the query as a title (fast path for known topics)
  try {
    const directRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encoded}&prop=pageimages&pithumbsize=800&pilimit=3&format=json&origin=*`
    );
    if (directRes.ok) {
      const d = await directRes.json();
      const pages = Object.values(d.query?.pages ?? {}) as Record<string, unknown>[];
      const directImgs: Array<{ url: string; title: string }> = [];
      for (const page of pages) {
        const src = (page as { thumbnail?: { source?: string }; title?: string }).thumbnail?.source;
        const safe = src ? toHttps(src) : null;
        if (safe) directImgs.push({ url: safe, title: String((page as { title?: string }).title ?? query) });
      }
      if (directImgs.length > 0) return directImgs.slice(0, maxImages);
    }
  } catch { /* fall through */ }

  // Step 2: search Wikipedia articles, then fetch pageimages for each sequentially
  try {
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&srnamespace=0&srlimit=10&format=json&origin=*`
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const titles: string[] = (searchData.query?.search ?? []).map((r: { title: string }) => r.title);
    const images: Array<{ url: string; title: string }> = [];

    for (const title of titles.slice(0, 8)) {
      if (images.length >= maxImages) break;
      try {
        const r = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&pithumbsize=800&format=json&origin=*`
        );
        if (!r.ok) continue;
        const p = await r.json();
        const pages = Object.values(p.query?.pages ?? {}) as Record<string, unknown>[];
        for (const page of pages) {
          const src = (page as { thumbnail?: { source?: string } }).thumbnail?.source;
          const safe = src ? toHttps(src) : null;
          if (safe && images.length < maxImages) {
            images.push({ url: safe, title: title });
          }
        }
      } catch { /* skip */ }
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

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

async function searchImagesWikimedia(
  query: string,
  maxImages: number
): Promise<Array<{ url: string; title: string }>> {
  const encoded = encodeURIComponent(query);
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&srnamespace=0&srlimit=${maxImages * 2}&format=json&origin=*`
  );
  if (!res.ok) return [];
  const data = await res.json();
  const titles: string[] = (data.query?.search ?? []).map((r: { title: string }) => r.title);
  const images: Array<{ url: string; title: string }> = [];
  await Promise.all(
    titles.slice(0, maxImages * 2).map(async (title: string) => {
      if (images.length >= maxImages) return;
      try {
        const r = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
        );
        if (!r.ok) return;
        const p = await r.json();
        const url: string | undefined = p?.thumbnail?.source ?? p?.originalimage?.source;
        if (url && url.startsWith('https') && images.length < maxImages) {
          images.push({ url, title: p.title || title });
        }
      } catch { /* skip */ }
    })
  );
  return images;
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

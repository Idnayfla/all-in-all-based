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

export async function searchImages(
  query: string,
  maxImages = 5
): Promise<Array<{ url: string; title: string }>> {
  const key = process.env.EXA_API_KEY;
  if (!key) return [];

  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        query: `${query} photo image`,
        numResults: maxImages * 3,
        contents: { text: { maxCharacters: 0 } },
        useAutoprompt: true,
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();

    interface ExaResult {
      title: string;
      url: string;
      image?: string;
    }

    const seen = new Set<string>();
    const images: Array<{ url: string; title: string }> = [];

    for (const r of (data.results ?? []) as ExaResult[]) {
      const url = r.image;
      if (url && url.startsWith('http') && !seen.has(url)) {
        seen.add(url);
        images.push({ url, title: r.title || query });
        if (images.length >= maxImages) break;
      }
    }

    return images;
  } catch {
    return [];
  }
}

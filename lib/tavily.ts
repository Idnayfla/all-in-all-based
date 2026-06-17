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

// Wikipedia REST API requires Title_Case_With_Underscores for reliable responses.
// Lowercase + %20 spaces return 429 or 404.
function toWikiTitle(s: string): string {
  return s
    .split(' ')
    .map((w, i) => (i === 0 || w.length > 3 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join('_');
}

async function wikiSummaryImage(title: string): Promise<{ url: string; title: string } | null> {
  // Try formatted title (Title_Case_Underscores) first, then raw encoded as fallback
  const candidates = [toWikiTitle(title), encodeURIComponent(title)];
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${candidate}`
        );
        if (r.status === 429) {
          // Brief back-off on rate limit before retry
          await new Promise(res => setTimeout(res, 600 * (attempt + 1)));
          continue;
        }
        if (!r.ok) break; // 404 / other error — try next candidate
        const p = await r.json() as { thumbnail?: { source?: string }; originalimage?: { source?: string }; title?: string };
        const src = p?.thumbnail?.source ?? p?.originalimage?.source;
        const safe = src ? toHttps(src) : null;
        if (safe) return { url: safe, title: p.title ?? title };
        break; // page exists but no thumbnail — try next candidate
      } catch {
        break;
      }
    }
  }
  return null;
}

async function searchCommonsImages(
  query: string,
  maxImages: number
): Promise<Array<{ url: string; title: string }>> {
  try {
    const res = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=20&format=json&origin=*`
    );
    if (!res.ok) return [];
    const data = await res.json() as { query?: { search?: { title: string }[] } };
    const files = (data.query?.search ?? [])
      .map(r => r.title)
      .filter(t => /\.(jpg|jpeg|png|webp)$/i.test(t));

    const images: Array<{ url: string; title: string }> = [];
    for (const file of files.slice(0, 10)) {
      if (images.length >= maxImages) break;
      try {
        const infoRes = await fetch(
          `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(file)}&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json&origin=*`
        );
        if (!infoRes.ok) continue;
        const info = await infoRes.json() as { query?: { pages?: Record<string, { imageinfo?: { thumburl?: string; url?: string }[] }> } };
        const pages = Object.values(info.query?.pages ?? {});
        for (const page of pages) {
          const imgInfo = page.imageinfo?.[0];
          const src = imgInfo?.thumburl ?? imgInfo?.url;
          const safe = src ? toHttps(src) : null;
          if (safe) { images.push({ url: safe, title: file.replace(/^File:/, '') }); break; }
        }
      } catch { continue; }
    }
    return images;
  } catch {
    return [];
  }
}

async function searchImagesWikimedia(
  query: string,
  maxImages: number
): Promise<Array<{ url: string; title: string }>> {
  // Step 1: direct REST summary with properly formatted title
  const direct = await wikiSummaryImage(query);
  if (direct) return [direct];

  // Step 2: search Wikipedia articles, fetch summary image for each
  try {
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=0&srlimit=10&format=json&origin=*`
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json() as { query?: { search?: { title: string }[] } };
      const titles = (searchData.query?.search ?? []).map(r => r.title);
      const images: Array<{ url: string; title: string }> = [];
      for (const title of titles.slice(0, 8)) {
        if (images.length >= maxImages) break;
        const img = await wikiSummaryImage(title);
        if (img) images.push(img);
      }
      if (images.length > 0) return images;
    }
  } catch { /* fall through */ }

  // Step 3: Wikimedia Commons — works for abstract/visual queries with no Wikipedia article
  return searchCommonsImages(query, maxImages);
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

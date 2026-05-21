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

const BASE = process.env.CRAWL4AI_URL ?? 'http://localhost:11235';

/**
 * Deep-extract clean markdown from any URL via a local crawl4ai container.
 * Returns null if crawl4ai is not configured or the request fails.
 *
 * Docker: docker run -p 11235:11235 unclecode/crawl4ai:latest
 * Env:    CRAWL4AI_URL=http://localhost:11235
 */
export async function crawl4aiExtract(url: string, maxChars = 4000): Promise<string | null> {
  if (!process.env.CRAWL4AI_URL) return null;
  try {
    // Submit async crawl task
    const submit = await fetch(`${BASE}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: [url],
        word_count_threshold: 10,
        bypass_cache: false,
        priority: 10,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!submit.ok) return null;
    const { task_id } = (await submit.json()) as { task_id?: string };
    if (!task_id) return null;

    // Poll up to ~15s
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const poll = await fetch(`${BASE}/task/${task_id}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!poll.ok) continue;
      const data = (await poll.json()) as {
        status?: string;
        results?: { markdown?: string; success?: boolean }[];
      };
      if (data.status === 'completed') {
        const md = data.results?.[0]?.markdown;
        return md ? md.slice(0, maxChars) : null;
      }
      if (data.status === 'failed') return null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if crawl4ai container is reachable.
 */
export async function isCrawl4aiAvailable(): Promise<boolean> {
  if (!process.env.CRAWL4AI_URL) return false;
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

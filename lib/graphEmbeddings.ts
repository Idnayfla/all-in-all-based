const BATCH_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents';

export async function batchEmbedTexts(texts: string[]): Promise<(number[] | null)[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || texts.length === 0) return texts.map(() => null);

  const results: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100);
    try {
      const res = await fetch(`${BATCH_URL}?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: chunk.map(text => ({
            model: 'models/text-embedding-004',
            content: { parts: [{ text: text.slice(0, 2000) }] },
          })),
        }),
      });
      if (!res.ok) {
        chunk.forEach(() => results.push(null));
        continue;
      }
      const data = (await res.json()) as { embeddings: { values: number[] }[] };
      data.embeddings.forEach(e => results.push(e.values ?? null));
    } catch {
      chunk.forEach(() => results.push(null));
    }
  }
  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

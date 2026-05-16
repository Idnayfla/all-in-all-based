export async function generateMusic(prompt: string, durationSeconds = 30): Promise<string> {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY;
  if (!key) return '';

  const res = await fetch('https://fal.run/fal-ai/stable-audio', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      seconds_total: Math.min(durationSeconds, 45),
      steps: 100,
    }),
  });

  if (!res.ok) return '';
  const data = await res.json();
  return data.audio_file?.url ?? '';
}

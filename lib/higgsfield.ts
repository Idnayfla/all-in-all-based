const BASE_URL = 'https://platform.higgsfield.ai';
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 180_000; // 3 minutes

function higgsHeaders(): Record<string, string> {
  const key = process.env.HIGGSFIELD_API_KEY;
  const secret = process.env.HIGGSFIELD_SECRET;
  if (!key || !secret) throw new Error('HIGGSFIELD_API_KEY or HIGGSFIELD_SECRET not configured');
  return {
    'Content-Type': 'application/json',
    'hf-api-key': key,
    'hf-secret': secret,
  };
}

interface JobSetResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  outputs?: Array<{ url: string }>;
}

async function pollJobSet(id: string): Promise<string> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/v1/job-sets/${id}`, {
      headers: higgsHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Higgsfield poll error: ${res.status} ${res.statusText}`);
    }
    const data: JobSetResponse = await res.json();
    if (data.status === 'completed') {
      const url = data.outputs?.[0]?.url;
      if (!url) throw new Error('Higgsfield job completed but returned no output URL');
      return url;
    }
    if (data.status === 'failed') {
      throw new Error('Higgsfield job failed');
    }
    // pending or processing — wait and retry
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Higgsfield job timed out after 3 minutes');
}

export async function generateImage(prompt: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/text2image/soul`, {
    method: 'POST',
    headers: higgsHeaders(),
    body: JSON.stringify({
      prompt,
      aspect_ratio: '16:9',
    }),
  });
  if (!res.ok) {
    throw new Error(`Higgsfield image submit error: ${res.status} ${res.statusText}`);
  }
  const { id }: { id: string } = await res.json();
  if (!id) throw new Error('Higgsfield did not return a job set ID for image generation');
  return pollJobSet(id);
}

export async function generateVideo(
  imageUrl: string,
  prompt: string,
  model: string = 'dop-lite'
): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/image2video/dop`, {
    method: 'POST',
    headers: higgsHeaders(),
    body: JSON.stringify({
      prompt,
      input_images: [{ image_url: imageUrl }],
      model,
    }),
  });
  if (!res.ok) {
    throw new Error(`Higgsfield video submit error: ${res.status} ${res.statusText}`);
  }
  const { id }: { id: string } = await res.json();
  if (!id) throw new Error('Higgsfield did not return a job set ID for video generation');
  return pollJobSet(id);
}

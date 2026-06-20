const BASE_URL = 'https://platform.higgsfield.ai';
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 180_000; // 3 minutes

function higgsHeaders(): Record<string, string> {
  const key = process.env.HIGGSFIELD_API_KEY;
  if (!key) throw new Error('HIGGSFIELD_API_KEY not configured');
  const secret = process.env.HIGGSFIELD_SECRET;
  if (!secret) throw new Error('HIGGSFIELD_SECRET not configured');
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

export async function importMediaFromUrl(url: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/media/import-url`, {
    method: 'POST',
    headers: higgsHeaders(),
    body: JSON.stringify({ url, type: 'image' }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `Higgsfield media import error: ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`
    );
  }
  const body = await res.json();
  const id: string = body.id ?? body.media_id ?? body.mediaId ?? '';
  if (!id) throw new Error('Higgsfield media import returned no ID');
  return id;
}

export async function generateImage(prompt: string, faceMediaId?: string): Promise<string> {
  const params: Record<string, unknown> = {
    prompt,
    aspect_ratio: '16:9',
    ...(faceMediaId
      ? { quality: '2k', medias: [{ value: faceMediaId, role: 'image' }] }
      : { width_and_height: '2048x1152' }),
  };
  const endpoint = faceMediaId ? 'soul_2' : 'soul';
  const res = await fetch(`${BASE_URL}/v1/text2image/${endpoint}`, {
    method: 'POST',
    headers: higgsHeaders(),
    body: JSON.stringify({ params }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {}
    throw new Error(
      `Higgsfield image submit error: ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
    );
  }
  const body = await res.json();
  const id: string = body.id ?? body.job_set_id ?? body.jobSetId ?? '';
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

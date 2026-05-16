const PANTHEON_URL = process.env.PANTHEON_API_URL ?? 'https://pantheon-api.vercel.app'
const PANTHEON_KEY = process.env.PANTHEON_API_KEY ?? process.env.PANTHEON_OWNER_KEY ?? ''

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }

type PantheonStreamOptions = {
  messages: ChatMessage[]
  task_type?: string
  max_tokens?: number
  onChunk: (text: string) => void
  onDone?: (model: string) => void
}

export async function streamFromPantheon({
  messages,
  task_type,
  max_tokens,
  onChunk,
  onDone,
}: PantheonStreamOptions): Promise<void> {
  const res = await fetch(`${PANTHEON_URL}/api/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PANTHEON_KEY}`,
    },
    body: JSON.stringify({ messages, task_type, max_tokens, stream: true }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `Pantheon error ${res.status}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') continue

      try {
        const parsed = JSON.parse(payload)
        if (parsed.type === 'text') onChunk(parsed.text)
        else if (parsed.type === 'done') onDone?.(parsed.model)
      } catch {
        // skip malformed SSE line
      }
    }
  }
}

export async function generateMediaFromPantheon(
  task_type: 'image' | 'music' | 'video_gen',
  prompt: string,
  options?: Record<string, unknown>
): Promise<{ url: string; format: string; duration?: number; width?: number; height?: number }> {
  const res = await fetch(`${PANTHEON_URL}/api/v1/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PANTHEON_KEY}`,
    },
    body: JSON.stringify({ task_type, prompt, options }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `Pantheon error ${res.status}`)
  }

  return res.json()
}

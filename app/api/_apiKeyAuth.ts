import { supabaseAdmin } from './_auth';

const API_MONTHLY_LIMIT = 100; // Pro tier: 100 calls/month

export class ApiRateLimitError extends Error {
  constructor() {
    super(
      'Monthly API limit reached (100 calls/month on Pro). Wait for next month or contact support.'
    );
    this.name = 'ApiRateLimitError';
  }
}

export interface ApiKeyResult {
  userId: string;
  callsUsed: number;
  callsLimit: number;
}

export async function getUserIdFromApiKey(apiKey: string): Promise<ApiKeyResult> {
  const hash = await sha256(apiKey);
  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, user_id, revoked_at, calls_this_month, calls_reset_at')
    .eq('key_hash', hash)
    .single();

  if (error || !data || data.revoked_at) throw new Error('Unauthorized');

  const now = new Date();
  const resetAt = new Date(data.calls_reset_at);
  const needsReset =
    resetAt.getMonth() !== now.getMonth() || resetAt.getFullYear() !== now.getFullYear();

  const currentCount = needsReset ? 0 : (data.calls_this_month ?? 0);

  if (currentCount >= API_MONTHLY_LIMIT) throw new ApiRateLimitError();

  await supabaseAdmin
    .from('api_keys')
    .update({
      calls_this_month: needsReset ? 1 : currentCount + 1,
      calls_reset_at: needsReset ? now.toISOString() : data.calls_reset_at,
      last_used_at: now.toISOString(),
    })
    .eq('id', data.id);

  return {
    userId: data.user_id as string,
    callsUsed: currentCount + 1,
    callsLimit: API_MONTHLY_LIMIT,
  };
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const raw = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `sk-based-${raw}`;
}

export async function hashApiKey(key: string): Promise<string> {
  return sha256(key);
}

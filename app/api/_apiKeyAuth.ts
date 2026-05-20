import { supabaseAdmin } from './_auth';

export async function getUserIdFromApiKey(apiKey: string): Promise<string> {
  const hash = await sha256(apiKey);
  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('user_id, revoked_at')
    .eq('key_hash', hash)
    .single();

  if (error || !data || data.revoked_at) throw new Error('Unauthorized');

  // Update last_used_at fire-and-forget
  void supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', hash);

  return data.user_id as string;
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

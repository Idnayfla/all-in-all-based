import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';
import { generateApiKey, hashApiKey } from '../_apiKeyAuth';

// GET — list user's API keys (no raw key, just metadata)
export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { data, error } = await supabaseAdmin
      .from('api_keys')
      .select('id, name, created_at, last_used_at, revoked_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ keys: data ?? [] });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — create a new API key (Pro only)
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);

    // Pro check
    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('subscription_tier, pro_bonus_expires_at')
      .eq('user_id', userId)
      .single();
    const isPro =
      settings?.subscription_tier === 'pro' ||
      (settings?.pro_bonus_expires_at && new Date(settings.pro_bonus_expires_at) > new Date());
    if (!isPro) {
      return NextResponse.json({ error: 'Pro subscription required' }, { status: 403 });
    }

    // Limit to 3 active keys
    const { count } = await supabaseAdmin
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('revoked_at', null);
    if ((count ?? 0) >= 3) {
      return NextResponse.json({ error: 'Maximum 3 active API keys allowed' }, { status: 400 });
    }

    const { name } = await req.json().catch(() => ({ name: 'Default' }));
    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);

    const { error } = await supabaseAdmin.from('api_keys').insert({
      user_id: userId,
      name: name ?? 'Default',
      key_hash: keyHash,
    });
    if (error) throw error;

    // Return raw key ONCE — never stored, never shown again
    return NextResponse.json({ key: rawKey, name: name ?? 'Default' });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE — revoke a key by id
export async function DELETE(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

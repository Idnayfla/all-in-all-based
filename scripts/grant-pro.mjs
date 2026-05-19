// One-shot script: grant permanent Pro to a user by email.
// Usage: node scripts/grant-pro.mjs husgogogo@gmail.com
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY from .env.local

import { readFileSync } from 'fs';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';

// ── Load .env.local ──────────────────────────────────────────────────────────
const env = {};
try {
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .forEach(line => {
      const [k, ...v] = line.trim().split('=');
      if (k && !k.startsWith('#')) env[k] = v.join('=');
    });
} catch {
  console.error('Could not read .env.local');
  process.exit(1);
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local');
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/grant-pro.mjs <email>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

// ── Find user by email ───────────────────────────────────────────────────────
const {
  data: { users },
  error: listErr,
} = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listErr) {
  console.error('listUsers error:', listErr.message);
  process.exit(1);
}

const target = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
if (!target) {
  console.error(`No user found with email: ${email}`);
  console.log('Existing emails:', users.map(u => u.email).join(', '));
  process.exit(1);
}
console.log(`Found user: ${target.id} (${target.email})`);

// ── Check current settings ───────────────────────────────────────────────────
const { data: current } = await supabase
  .from('user_settings')
  .select('subscription_tier, pro_bonus_expires_at')
  .eq('user_id', target.id)
  .single();

console.log('Current settings:', current);

// ── Grant permanent Pro (expires 100 years from now) ─────────────────────────
const permanentDate = new Date();
permanentDate.setFullYear(permanentDate.getFullYear() + 100);

const { error: upsertErr } = await supabase.from('user_settings').upsert(
  {
    user_id: target.id,
    pro_bonus_expires_at: permanentDate.toISOString(),
  },
  { onConflict: 'user_id' }
);

if (upsertErr) {
  console.error('Upsert error:', upsertErr.message);
  process.exit(1);
}

console.log(`✓ Granted permanent Pro to ${email} (expires ${permanentDate.toISOString()})`);

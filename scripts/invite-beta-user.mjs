#!/usr/bin/env node
// Usage: node scripts/invite-beta-user.mjs user@email.com [days]
// Sets subscription_tier=beta and beta_expires_at=now+14d for the given email.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const email = process.argv[2];
const days = parseInt(process.argv[3] ?? '14', 10);

if (!email) {
  console.error('Usage: node scripts/invite-beta-user.mjs user@email.com [days]');
  process.exit(1);
}

// Load env from .env.local if present
let env = {};
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of envFile.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
} catch {}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
// Codebase uses SUPABASE_SERVICE_KEY; accept SUPABASE_SERVICE_ROLE_KEY too.
const supabaseKey =
  env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  console.error('Add them to .env.local or set as env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: users, error: userErr } = await supabase.auth.admin.listUsers();
if (userErr) {
  console.error('Error listing users:', userErr.message);
  process.exit(1);
}

const user = users.users.find(u => u.email === email);
if (!user) {
  console.error(`No user found with email: ${email}`);
  process.exit(1);
}

const betaExpiry = new Date(Date.now() + days * 86_400_000).toISOString();

const { error } = await supabase
  .from('user_settings')
  .upsert(
    { user_id: user.id, subscription_tier: 'beta', beta_expires_at: betaExpiry },
    { onConflict: 'user_id' }
  );

if (error) {
  console.error('Error updating user:', error.message);
  process.exit(1);
}

console.log(`OK ${email} -> beta tier, expires ${betaExpiry} (${days} days)`);

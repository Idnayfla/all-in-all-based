#!/usr/bin/env node
// Usage: node scripts/invite-beta-user.mjs user@email.com [days]

import { readFileSync } from 'fs';
import { resolve } from 'path';

const email = process.argv[2];
const days = parseInt(process.argv[3] ?? '14', 10);

if (!email) {
  console.error('Usage: node scripts/invite-beta-user.mjs user@email.com [days]');
  process.exit(1);
}

// Load env from .env.local
let env = {};
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of envFile.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
} catch {}

const url = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local');
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

// List auth users to find by email
const usersRes = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers });
if (!usersRes.ok) {
  console.error('Error listing users:', await usersRes.text());
  process.exit(1);
}
const { users } = await usersRes.json();
const user = users.find(u => u.email === email);
if (!user) {
  console.error(`No user found with email: ${email}`);
  process.exit(1);
}

// Fetch current settings
const settingsRes = await fetch(
  `${url}/rest/v1/user_settings?user_id=eq.${user.id}&select=subscription_tier,subscription_status`,
  { headers: { ...headers, Accept: 'application/json' } }
);
const [existing] = await settingsRes.json();

const currentTier = existing?.subscription_tier ?? 'free';
const subStatus = existing?.subscription_status ?? 'active';
const isActivePro = currentTier === 'pro' && subStatus !== 'canceled' && subStatus !== 'cancelled';

if (isActivePro) {
  console.log(`SKIPPED — ${email} is already a paying Pro user. Beta would be a downgrade.`);
  process.exit(0);
}

const betaExpiry = new Date(Date.now() + days * 86_400_000).toISOString();

const upsertRes = await fetch(`${url}/rest/v1/user_settings`, {
  method: 'POST',
  headers: {
    ...headers,
    Prefer: 'resolution=merge-duplicates',
  },
  body: JSON.stringify({
    user_id: user.id,
    subscription_tier: 'beta',
    beta_expires_at: betaExpiry,
  }),
});

if (!upsertRes.ok) {
  console.error('Error updating user:', await upsertRes.text());
  process.exit(1);
}

const prev = currentTier === 'free' ? 'free' : currentTier;
console.log(`OK ${email} -> beta tier (from ${prev}), expires ${betaExpiry} (${days} days)`);

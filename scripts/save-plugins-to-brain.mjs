import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => {
      const idx = l.indexOf('=');
      const key = l.slice(0, idx).trim();
      const val = l
        .slice(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      return [key, val];
    })
);

const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_KEY;
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function sbGet(table, params) {
  const url = `${BASE}/rest/v1/${table}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers });
  return r.json();
}

async function sbUpsert(table, body) {
  const url = `${BASE}/rest/v1/${table}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  return r.json();
}

const EMAIL = 'husgogogo@gmail.com';

const PLUGIN_FACT = `Has 29 Claude Code plugins installed (typescript-lsp, security-guidance, semgrep, github, supabase, sentry, figma, vercel, code-review, code-simplifier, code-modernization, coderabbit, pr-review-toolkit, context7, greptile, commit-commands, claude-md-management, hookify, feature-dev, ralph-loop, session-report, claude-code-setup, frontend-design, playwright, superpowers, skill-creator, agent-sdk-dev, mcp-server-dev, plugin-dev) [from: Claude Code plugin setup]`;

// Get user ID from auth.users
const authRes = await fetch(`${BASE}/auth/v1/admin/users?email=${EMAIL}`, { headers });
const authData = await authRes.json();
const authUser = authData.users?.find(u => u.email === EMAIL);
if (!authUser) {
  console.error('User not found:', authData);
  process.exit(1);
}
const userId = authUser.id;
console.log('User ID:', userId);

// Get current memory
const settings = await sbGet('user_settings', { select: 'global_memory', user_id: `eq.${userId}` });
const existing = settings?.[0]?.global_memory ?? '';
console.log('\nCurrent memory:\n', existing || '(empty)');

// Build updated memory
let updated;
if (existing.includes('Claude Code plugins installed')) {
  const lines = existing.split('\n').filter(l => !l.includes('Claude Code plugins installed'));
  updated = lines.join('\n').trim() + `\n${lines.filter(Boolean).length + 1}) ${PLUGIN_FACT}`;
  console.log('\nReplacing existing plugin fact.');
} else {
  const lines = existing.split('\n').filter(Boolean);
  updated = (existing.trim() ? existing.trim() + '\n' : '') + `${lines.length + 1}) ${PLUGIN_FACT}`;
  console.log('\nAppending plugin fact to brain.');
}

await sbUpsert('user_settings', { user_id: userId, global_memory: updated });
console.log('\nDone. Brain updated.');

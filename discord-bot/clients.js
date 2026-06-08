'use strict';
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

const STATUSES = {
  'orchestrator':     'keeping the room from spinning',
  'architect':        'thinking in tradeoffs',
  'senior-engineer':  'in the code',
  'ai-engineer':      'watching model behavior',
  'product':          'reading user feedback',
  'designer':         'in Figma',
  'devops':           'watching uptime',
  'security':         'thinking like an attacker',
  'qa':               'finding edge cases',
  'growth':           'watching the funnel',
  'data-analyst':     'in the dashboards',
  'mobile':           'fighting iOS Safari',
  'finance':          'running the numbers',
  'legal':            'reading the fine print',
  'community':        'talking to users',
  'chief-of-staff':   'keeping receipts',
  'technical-writer': 'making it clear',
};

// Rotation pools — each agent cycles through realistic statuses over the day
const STATUS_POOLS = {
  'orchestrator':     ['keeping the room from spinning', 'in 1:1s', 'reading updates', 'thinking through it'],
  'architect':        ['thinking in tradeoffs', 'whiteboarding', 'reviewing the design', 'reading the RFC'],
  'senior-engineer':  ['in the code', 'reviewing PR', 'debugging', 'reading docs', 'pushing a fix'],
  'ai-engineer':      ['watching model behavior', 'running evals', 'tweaking prompts', 'reading papers'],
  'product':          ['reading user feedback', 'writing specs', 'in roadmap review', 'talking to users'],
  'designer':         ['in Figma', 'reviewing designs', 'making assets', 'tweaking spacing'],
  'devops':           ['watching uptime', 'deploying', 'checking logs', 'in the terminal'],
  'security':         ['thinking like an attacker', 'reviewing auth flow', 'reading CVEs', 'running scans'],
  'qa':               ['finding edge cases', 'running tests', 'writing test cases', 'checking prod'],
  'growth':           ['watching the funnel', 'writing copy', 'reviewing metrics', 'planning launch'],
  'data-analyst':     ['in the dashboards', 'running queries', 'building charts', 'analyzing cohorts'],
  'mobile':           ['fighting iOS Safari', 'testing on device', 'reading app store guidelines'],
  'finance':          ['running the numbers', 'reviewing burn', 'modeling scenarios', 'in a spreadsheet'],
  'legal':            ['reading the fine print', 'reviewing ToS', 'checking compliance'],
  'community':        ['talking to users', 'reading feedback', 'in the Discord', 'writing comms'],
  'chief-of-staff':   ['keeping receipts', 'updating the log', 'chasing decisions', 'in the calendar'],
  'technical-writer': ['making it clear', 'writing docs', 'editing', 'reviewing changelog'],
};

const agentClients = new Map(); // slug → logged-in Discord Client

// ── Register the main listener client under an agent slug ─────────────────────
// Call this in bot.js once Discord is ready, with slug = config.listener_agent || 'orchestrator'
function registerMainClient(slug, client) {
  agentClients.set(slug, client);
  console.log(`[clients] ${slug.padEnd(20)} → ${client.user.tag} (main listener)`);
}

// ── Login all configured agent bots ──────────────────────────────────────────
async function initAgentClients(agentTokens = {}, listenerToken = null) {
  const entries = Object.entries(agentTokens);
  if (!entries.length) {
    console.log('[clients] No agent_tokens configured — using webhook fallback for all agents.');
    return;
  }

  await Promise.all(entries.map(async ([slug, token]) => {
    if (!token || token.startsWith('Bot token for')) return; // skip placeholders
    if (token === listenerToken) {
      // Same token as the main listener — already registered, skip to avoid duplicate connection
      console.log(`[clients] ${slug.padEnd(20)} → using main listener client (same token)`);
      return;
    }

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });

    try {
      await client.login(token);
      agentClients.set(slug, client);
      console.log(`[clients] ${slug.padEnd(20)} → ${client.user.tag}`);
      const status = STATUSES[slug];
      if (status) {
        client.user.setPresence({
          activities: [{ name: status, type: ActivityType.Custom }],
          status: 'online',
        });
      }
    } catch (err) {
      console.warn(`[clients] ${slug} login failed: ${err.message.slice(0, 80)}`);
    }
  }));

  const total = entries.filter(([, t]) => t && !t.startsWith('Bot token for')).length;
  console.log(`[clients] ${agentClients.size}/${total} agent bots connected.`);
}

// ── Get a connected client for an agent slug ──────────────────────────────────
function getAgentClient(slug) {
  return agentClients.get(slug) || null;
}

// ── User ID helpers for @mention resolution ───────────────────────────────────
function getAgentUserId(slug) {
  return agentClients.get(slug)?.user?.id || null;
}

// Returns Map<userId, slug> for all connected agent bots
function getAgentUserIdMap() {
  const map = new Map();
  for (const [slug, client] of agentClients) {
    if (client?.user?.id) map.set(client.user.id, slug);
  }
  return map;
}

// ── Destroy all agent clients except the main listener ────────────────────────
async function destroyAll(listenerToken = null) {
  for (const [slug, client] of agentClients) {
    // Don't destroy the main listener — bot.js handles that
    if (listenerToken && client.token === listenerToken) continue;
    try { await client.destroy(); } catch {}
  }
  agentClients.clear();
}

// Rotate 1-2 random agents to a new status from their pool
function rotateRandomStatuses() {
  const slugs = Object.keys(STATUS_POOLS);
  const count  = 1 + Math.floor(Math.random() * 2);
  const picks  = [...slugs].sort(() => Math.random() - 0.5).slice(0, count);
  for (const slug of picks) {
    const client = agentClients.get(slug);
    if (!client?.user) continue;
    const pool   = STATUS_POOLS[slug];
    const status = pool[Math.floor(Math.random() * pool.length)];
    client.user.setPresence({
      activities: [{ name: status, type: ActivityType.Custom }],
      status: 'online',
    }).catch(() => {});
  }
}

module.exports = { initAgentClients, registerMainClient, getAgentClient, getAgentUserId, getAgentUserIdMap, rotateRandomStatuses, destroyAll };

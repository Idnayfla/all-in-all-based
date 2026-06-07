'use strict';
/**
 * Manages individual Discord bot clients — one per agent.
 *
 * Two modes:
 *   Legacy:  discord_token = separate "Based HQ" listener bot (temporary)
 *   Proper:  discord_token = Orchestrator's token — no separate Based HQ needed.
 *            Call registerMainClient('orchestrator', discordClient) in ready handler.
 *            Duplicate tokens in agent_tokens are skipped automatically.
 */

const { Client, GatewayIntentBits } = require('discord.js');

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

// ── Destroy all agent clients except the main listener ────────────────────────
async function destroyAll(listenerToken = null) {
  for (const [slug, client] of agentClients) {
    // Don't destroy the main listener — bot.js handles that
    if (listenerToken && client.token === listenerToken) continue;
    try { await client.destroy(); } catch {}
  }
  agentClients.clear();
}

module.exports = { initAgentClients, registerMainClient, getAgentClient, destroyAll };

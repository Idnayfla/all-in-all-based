'use strict';
/**
 * Manages individual Discord bot clients — one per agent.
 *
 * The LISTENER (Based HQ bot) handles incoming messages and routing.
 * AGENT clients are used only for sending — each appears as their own Discord member.
 *
 * Agents without a token in config.agent_tokens fall back to webhook delivery.
 */

const { Client, GatewayIntentBits } = require('discord.js');

const agentClients = new Map(); // slug → logged-in Discord Client

// ── Login all configured agent bots ──────────────────────────────────────────
async function initAgentClients(agentTokens = {}) {
  const entries = Object.entries(agentTokens);
  if (!entries.length) {
    console.log('[clients] No agent_tokens configured — using webhook fallback for all agents.');
    return;
  }

  await Promise.all(entries.map(async ([slug, token]) => {
    if (!token || token.startsWith('Bot token for')) return; // skip placeholders

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

  console.log(`[clients] ${agentClients.size}/${entries.length} agent bots connected.`);
}

// ── Get a connected client for an agent slug ──────────────────────────────────
function getAgentClient(slug) {
  return agentClients.get(slug) || null;
}

// ── Destroy all agent clients (clean shutdown) ────────────────────────────────
async function destroyAll() {
  for (const [slug, client] of agentClients) {
    try { await client.destroy(); } catch {}
  }
  agentClients.clear();
}

module.exports = { initAgentClients, getAgentClient, destroyAll };

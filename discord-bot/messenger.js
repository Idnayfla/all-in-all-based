'use strict';
/**
 * Unified message sender.
 *
 * Priority:
 *   1. Agent's own Discord bot client (getAgentClient) — appears as real member
 *   2. Webhook fallback — appears as "Name APP", no member list entry
 *
 * As Hus adds tokens to config.agent_tokens, agents automatically
 * upgrade from webhook to their own identity on next restart.
 */

const { WebhookClient } = require('discord.js');
const { AGENTS }        = require('./agents');
const { getAgentClient } = require('./clients');

// ── Webhook cache (fallback) ──────────────────────────────────────────────────
const webhookCache = new Map(); // parentChannelId → WebhookClient

async function getWebhook(channel) {
  const parent = channel.isThread?.() ? channel.parent : channel;
  if (!parent) throw new Error('Cannot resolve parent channel.');
  if (webhookCache.has(parent.id)) return webhookCache.get(parent.id);

  let wh;
  try {
    const existing = await parent.fetchWebhooks();
    wh = existing.find(w => w.owner?.id === parent.client.user.id && w.token);
  } catch {}

  if (!wh) wh = await parent.createWebhook({ name: 'Based HQ' });

  const client = new WebhookClient({ id: wh.id, token: wh.token });
  webhookCache.set(parent.id, client);
  return client;
}

// ── Split long messages ───────────────────────────────────────────────────────
function splitMessage(text, max = 1900) {
  if (!text || text.length <= max) return [text || ''];
  const parts = [];
  let rem = text;
  while (rem.length > max) {
    let cut = rem.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    parts.push(rem.slice(0, cut));
    rem = rem.slice(cut).trimStart();
  }
  if (rem) parts.push(rem);
  return parts;
}

// ── Send via agent's own bot (real member) ────────────────────────────────────
async function sendViaClient(agentClient, channel, content) {
  const parts = splitMessage(content);
  for (const part of parts) {
    const ch = await agentClient.channels.fetch(channel.id).catch(() => null);
    if (!ch) throw new Error(`Agent client cannot access channel ${channel.id}`);
    await ch.send(part);
  }
}

// ── Send via webhook (fallback — shows as "Name APP") ─────────────────────────
async function sendViaWebhook(channel, slug, content) {
  const agent = AGENTS[slug] || { name: slug, icon: '◈', avatarURL: null };
  const wh    = await getWebhook(channel);

  const base = {
    username:        `${agent.icon} ${agent.name}`,
    avatarURL:       agent.avatarURL || undefined,
    allowedMentions: { parse: [] },
  };
  if (channel.isThread?.()) base.threadId = channel.id;

  const parts = splitMessage(content);
  for (const part of parts) await wh.send({ ...base, content: part });
}

// ── Main send function ────────────────────────────────────────────────────────
async function sendAsAgent(channel, slug, content) {
  if (!content?.trim()) return;

  const client = getAgentClient(slug);
  if (client) {
    try {
      await sendViaClient(client, channel, content);
      return;
    } catch (err) {
      console.warn(`[messenger] ${slug} own-client send failed (${err.message}) — falling back to webhook`);
    }
  }

  await sendViaWebhook(channel, slug, content);
}

async function sendAsOrchestrator(channel, content) {
  return sendAsAgent(channel, 'orchestrator', content);
}

module.exports = { sendAsAgent, sendAsOrchestrator, splitMessage };

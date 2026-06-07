'use strict';
const { WebhookClient } = require('discord.js');
const { AGENTS } = require('./agents');

// Cache webhooks per parent channel (threads share parent's webhook)
const cache = new Map(); // parentChannelId → WebhookClient

// ── Get or create a single webhook for a channel ──────────────────────────────
async function getWebhook(channel) {
  // Threads: use parent channel for webhook creation/lookup
  const parent = channel.isThread?.() ? channel.parent : channel;
  if (!parent) throw new Error('Cannot resolve parent channel for webhook.');

  if (cache.has(parent.id)) return cache.get(parent.id);

  // Reuse existing bot-owned webhook if one exists
  let wh;
  try {
    const existing = await parent.fetchWebhooks();
    wh = existing.find(w => w.owner?.id === parent.client.user.id && w.token);
  } catch {}

  if (!wh) {
    wh = await parent.createWebhook({ name: 'Based HQ' });
  }

  const client = new WebhookClient({ id: wh.id, token: wh.token });
  cache.set(parent.id, client);
  return client;
}

// ── Split long messages ───────────────────────────────────────────────────────
function splitMessage(text, max = 1900) {
  if (text.length <= max) return [text];
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

// ── Send a message as a specific agent ───────────────────────────────────────
async function sendAsAgent(channel, slug, content) {
  const agent = AGENTS[slug] || { name: slug, icon: '◈', avatarURL: null };
  const wh    = await getWebhook(channel);

  const base = {
    username:        `${agent.icon} ${agent.name}`,
    avatarURL:       agent.avatarURL || undefined,
    allowedMentions: { parse: [] },
  };

  // Threads: message must be sent via webhook with threadId
  if (channel.isThread?.()) base.threadId = channel.id;

  const parts = splitMessage(content);
  const messages = [];
  for (const part of parts) {
    messages.push(await wh.send({ ...base, content: part }));
  }
  return messages[0];
}

// ── Send a system/status message as the Orchestrator ─────────────────────────
async function sendAsOrchestrator(channel, content) {
  return sendAsAgent(channel, 'orchestrator', content);
}

// ── Clear webhook cache (call if bot rejoins a channel) ───────────────────────
function clearCache(channelId) {
  cache.delete(channelId);
}

module.exports = { sendAsAgent, sendAsOrchestrator, splitMessage, clearCache };

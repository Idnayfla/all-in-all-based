'use strict';
/**
 * Unified message sender.
 *
 * Priority:
 *   1. Agent's own Discord bot client — appears as real member
 *   2. Webhook fallback — appears as "Name APP"
 *
 * Supports text messages AND file attachments (images, videos, documents).
 */

const { WebhookClient, AttachmentBuilder } = require('discord.js');
const { AGENTS }          = require('./agents');
const { getAgentClient }  = require('./clients');
const fs                  = require('fs');
const path                = require('path');

// ── Webhook cache ─────────────────────────────────────────────────────────────
const webhookCache = new Map();

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

// ── Split long text messages ──────────────────────────────────────────────────
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

// ── Build Discord attachment objects from file paths or URLs ──────────────────
function buildAttachments(files = []) {
  return files.map(f => {
    if (typeof f === 'string') {
      // URL — Discord will embed images/videos automatically
      if (f.startsWith('http://') || f.startsWith('https://')) {
        return new AttachmentBuilder(f);
      }
      // Local path
      if (fs.existsSync(f)) {
        return new AttachmentBuilder(f, { name: path.basename(f) });
      }
    }
    // Already an AttachmentBuilder or buffer
    return f;
  }).filter(Boolean);
}

// ── Send via agent's own client ───────────────────────────────────────────────
async function sendViaClient(agentClient, channel, content, files = []) {
  const ch = await agentClient.channels.fetch(channel.id).catch(() => null);
  if (!ch) throw new Error(`Agent client cannot access channel ${channel.id}`);

  const attachments = buildAttachments(files);
  let lastMsg = null;

  if (attachments.length) {
    const parts = splitMessage(content);
    lastMsg = await ch.send({ content: parts[0] || undefined, files: attachments });
    for (const p of parts.slice(1)) lastMsg = await ch.send(p);
  } else {
    const parts = splitMessage(content);
    for (const p of parts) lastMsg = await ch.send(p);
  }
  return lastMsg;
}

// ── Send via webhook ──────────────────────────────────────────────────────────
async function sendViaWebhook(channel, slug, content, files = []) {
  const agent = AGENTS[slug] || { name: slug, icon: '◈', avatarURL: null };
  const wh    = await getWebhook(channel);

  const base = {
    username:        `${agent.icon} ${agent.name}`,
    avatarURL:       agent.avatarURL || undefined,
    allowedMentions: { parse: [] },
  };
  if (channel.isThread?.()) base.threadId = channel.id;

  const attachments = buildAttachments(files);

  if (attachments.length) {
    const parts = splitMessage(content);
    await wh.send({ ...base, content: parts[0] || undefined, files: attachments });
    for (const p of parts.slice(1)) await wh.send({ ...base, content: p });
  } else {
    const parts = splitMessage(content);
    for (const p of parts) await wh.send({ ...base, content: p });
  }
}

// ── Main send — text (returns Message if sent via own client, null via webhook) ─
async function sendAsAgent(channel, slug, content) {
  if (!content?.trim()) return null;
  const client = getAgentClient(slug);
  if (client) {
    try { return await sendViaClient(client, channel, content); }
    catch (err) { console.warn(`[messenger] ${slug} client failed (${err.message}) — webhook fallback`); }
  }
  await sendViaWebhook(channel, slug, content);
  return null;
}

// ── Main send — with file attachments ────────────────────────────────────────
async function sendAsAgentWithFiles(channel, slug, content, files = []) {
  if (!files.length) return sendAsAgent(channel, slug, content);

  const client = getAgentClient(slug);
  if (client) {
    try { await sendViaClient(client, channel, content, files); return; }
    catch (err) { console.warn(`[messenger] ${slug} client file send failed (${err.message}) — webhook fallback`); }
  }
  await sendViaWebhook(channel, slug, content, files);
}

async function sendAsOrchestrator(channel, content) {
  return sendAsAgent(channel, 'orchestrator', content);
}

// ── Multi-message burst — splits reply into natural chunks with pauses ─────────
function splitIntoBursts(text) {
  // Skip code blocks and Discord headers — formatting would break across messages
  if (text.includes('```') || /^#{1,3} /m.test(text)) return null;

  // Paragraph splits (most natural boundary)
  const paras = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 10);
  if (paras.length >= 2 && paras.length <= 4) return paras;

  // Sentence boundary splits
  const sents = text.match(/[^.!?]*[.!?]+(?=\s|$)/g);
  if (sents && sents.length >= 2 && sents.length <= 5) {
    const trimmed = sents.map(s => s.trim()).filter(Boolean);
    if (trimmed.length <= 3) return trimmed;
    const mid = Math.floor(trimmed.length / 2);
    return [trimmed.slice(0, mid).join(' '), trimmed.slice(mid).join(' ')];
  }

  // Half-split for longer undivided text
  const words = text.split(' ');
  if (words.length < 25) return null;
  const mid = Math.floor(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

// 30% of replies arrive as 2-4 short messages, human style
// Returns the last sent Message (or null if webhook)
async function sendAsAgentBurst(channel, slug, content) {
  if (!content?.trim()) return null;

  if (content.length > 100 && Math.random() < 0.30) {
    const chunks = splitIntoBursts(content);
    if (chunks && chunks.length >= 2) {
      let lastMsg = null;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i].trim();
        if (!chunk) continue;
        if (i > 0) {
          channel.sendTyping().catch(() => {});
          await new Promise(r => setTimeout(r, 1200 + Math.random() * 1800));
        }
        lastMsg = await sendAsAgent(channel, slug, chunk);
      }
      // Typing ghost — 5%: agent starts to follow up, then goes quiet
      if (Math.random() < 0.05) {
        setTimeout(() => {
          channel.sendTyping().catch(() => {});
        }, 2000 + Math.random() * 3000);
      }
      return lastMsg;
    }
  }

  const msg = await sendAsAgent(channel, slug, content);

  // Typing ghost — 5%: agent starts to follow up, then goes quiet
  if (Math.random() < 0.05) {
    setTimeout(() => {
      channel.sendTyping().catch(() => {});
    }, 2000 + Math.random() * 3000);
  }

  return msg;
}

module.exports = { sendAsAgent, sendAsAgentBurst, sendAsAgentWithFiles, sendAsOrchestrator, splitMessage };

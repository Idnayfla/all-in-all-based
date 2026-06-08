'use strict';
const { getAgentClient, getAgentUserIdMap } = require('./clients');
const { AGENTS }                            = require('./agents');

const AGENT_REACTIONS = {
  'orchestrator':     ['✅', '👍'],
  'architect':        ['🤔', '👀'],
  'senior-engineer':  ['👀', '🔥', '💀'],
  'ai-engineer':      ['🔥', '👀', '🤯'],
  'product':          ['✅', '👍', '🎯'],
  'designer':         ['🔥', '✨', '👀'],
  'devops':           ['👍', '👀', '⚠️'],
  'security':         ['👀', '🤔', '⚠️'],
  'qa':               ['🐛', '👀', '✅'],
  'growth':           ['🔥', '📈', '✅'],
  'data-analyst':     ['📊', '👀', '🤔'],
  'mobile':           ['👍', '👀', '😬'],
  'finance':          ['👍', '🤔', '📊'],
  'legal':            ['👀', '✅', '🤔'],
  'community':        ['❤️', '🔥', '✅'],
  'chief-of-staff':   ['✅', '👍', '📝'],
  'technical-writer': ['✅', '👍', '✏️'],
};

// Each agent independently decides whether to react (~30% chance each)
// Runs in background — caller should not await
async function reactToMessage(message) {
  const slugs = Object.keys(AGENTS).filter(() => Math.random() < 0.30);
  if (!slugs.length) return;

  for (const slug of slugs) {
    const client = getAgentClient(slug);
    if (!client) continue;

    const pool  = AGENT_REACTIONS[slug] || ['👍'];
    const emoji = pool[Math.floor(Math.random() * pool.length)];

    // Staggered so reactions trickle in, not all at once
    await new Promise(r => setTimeout(r, 600 + Math.random() * 2400));
    try {
      const ch  = await client.channels.fetch(message.channel.id).catch(() => null);
      if (!ch) continue;
      const msg = await ch.messages.fetch(message.id).catch(() => null);
      if (!msg) continue;
      await msg.react(emoji);
    } catch {}
  }
}

// Agents react to each other's bot messages — 15% probability, can't self-react
async function reactToAgentMessage(message) {
  const agentIds  = getAgentUserIdMap();
  const senderSlug = agentIds.get(message.author.id);
  if (!senderSlug) return;

  const candidates = Object.keys(AGENTS).filter(s => s !== senderSlug && Math.random() < 0.15);
  if (!candidates.length) return;

  for (const slug of candidates) {
    const client = getAgentClient(slug);
    if (!client) continue;
    const pool  = AGENT_REACTIONS[slug] || ['👍'];
    const emoji = pool[Math.floor(Math.random() * pool.length)];
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 3000));
    try {
      const ch  = await client.channels.fetch(message.channel.id).catch(() => null);
      if (!ch) continue;
      const msg = await ch.messages.fetch(message.id).catch(() => null);
      if (!msg) continue;
      await msg.react(emoji);
    } catch {}
  }
}

module.exports = { reactToMessage, reactToAgentMessage };

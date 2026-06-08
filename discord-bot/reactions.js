'use strict';
const { getAgentClient } = require('./clients');
const { AGENTS }         = require('./agents');

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

module.exports = { reactToMessage };

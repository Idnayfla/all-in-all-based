'use strict';
/**
 * One-time script — renames each Discord bot account to its human name.
 * Run once: node rename-bots.js
 * Discord allows 2 username changes per hour per bot, so space them out.
 */

const config = require('./config.json');

const NAMES = {
  'orchestrator':     'Maya',
  'architect':        'Marcus',
  'senior-engineer':  'Kai',
  'ai-engineer':      'Zoe',
  'product':          'Jordan',
  'designer':         'Ren',
  'devops':           'Lars',
  'security':         'Dani',
  'qa':               'Sam',
  'growth':           'Leila',
  'data-analyst':     'Felix',
  'mobile':           'Tomas',
  'finance':          'Yuki',
  'legal':            'Asha',
  'community':        'Bea',
  'chief-of-staff':   'Priya',
  'technical-writer': 'Owen',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function rename(slug, token, name) {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username: name }),
  });

  const data = await res.json();

  if (res.ok) {
    console.log(`✓ ${slug.padEnd(20)} → ${data.username}#${data.discriminator ?? '0'}`);
  } else {
    console.error(`✗ ${slug.padEnd(20)} → ${res.status} ${data.message || JSON.stringify(data)}`);
  }

  return res.ok;
}

async function main() {
  const tokens = config.agent_tokens || {};
  const entries = Object.entries(NAMES).filter(([slug]) => tokens[slug]);

  console.log(`Renaming ${entries.length} bots — 3s gap to respect rate limits\n`);

  for (const [slug, name] of entries) {
    await rename(slug, tokens[slug], name);
    await sleep(3000);
  }

  console.log('\nDone. Restart the bot for changes to take effect in Discord.');
}

main().catch(console.error);

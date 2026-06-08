#!/usr/bin/env node
/**
 * Based HQ — Discord Bot
 *
 * Two modes:
 *   Direct   — post in an agent channel (#senior-engineer, #qa, etc.)
 *              OR prefix from any channel: "architect: question"
 *   Council  — post in #council OR use !council <task> from any channel
 *              → group meeting: Orchestrator routes, agents discuss, executor acts
 *
 * Commands:
 *   !clear           — reset conversation history for this channel
 *   !help            — list agents + tools
 *   !status          — uptime, provider, active histories
 *   !council <task>  — start a council session in a thread
 *
 * Setup:
 *   cp config.example.json config.json   (fill in tokens + keys)
 *   npm install && node bot.js
 *
 * Always-on (PM2):
 *   npm install -g pm2
 *   pm2 start bot.js --name based-hq && pm2 save && pm2 startup
 */

'use strict';
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

// ── Single-instance lock — kill any previous bot process on startup ───────────
const { execSync } = require('child_process');
const pidFile = require('path').join(__dirname, 'bot.pid');
const fs = require('fs');
try {
  if (fs.existsSync(pidFile)) {
    const oldPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (oldPid && oldPid !== process.pid) {
      try { process.kill(oldPid); console.log(`[boot] Killed previous instance (PID ${oldPid})`); }
      catch {}
    }
  }
} catch {}
fs.writeFileSync(pidFile, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(pidFile); } catch {} });
const { config, COUNCIL_CHANNEL, OLLAMA_BASE_URL, MODEL_OLLAMA } = require('./config');
const { AGENTS, dispatchAgent, anthropic, groq }  = require('./agents');
const { DEFINITIONS }                             = require('./tools');
const { runCouncil }                              = require('./council');
const { sendAsAgent, splitMessage }               = require('./messenger');
const { initAgentClients, registerMainClient, destroyAll } = require('./clients');
const scheduler                                   = require('./scheduler');

// ── Discord client ────────────────────────────────────────────────────────────
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Conversation histories for direct mode (per channel)
const histories = new Map();

// Deduplication — ignore messages already being processed
const processing = new Set();

// ── Utilities ─────────────────────────────────────────────────────────────────
function startTyping(channel) {
  channel.sendTyping().catch(() => {});
  return setInterval(() => channel.sendTyping().catch(() => {}), 8000);
}

async function sendSplit(channel, text) {
  const parts = splitMessage(text);
  await channel.send(parts[0]);
  for (const p of parts.slice(1)) await channel.send(p);
}

// ── Message handler ───────────────────────────────────────────────────────────
discord.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.author.id !== config.authorized_user_id) return;
  if (processing.has(message.id)) return;
  processing.add(message.id);
  setTimeout(() => processing.delete(message.id), 60000);

  const channelName = message.channel.name?.toLowerCase() ?? '';
  const content     = message.content.trim();
  if (!content) return;

  // ── Commands ────────────────────────────────────────────────────────────────
  if (content === '!clear') {
    histories.delete(message.channel.id);
    await message.reply('◈ Conversation cleared.');
    return;
  }

  if (content === '!status') {
    const up = Math.floor(process.uptime());
    const provider =
      config.provider === 'auto'      ? 'auto — Groq (free) for 13 · Anthropic Opus for senior 4' :
      config.provider === 'groq'      ? `groq — ${config.model_groq}` :
      /* anthropic */                   `anthropic — ${config.model_opus}`;
    await message.reply(
      `**◈ Based HQ**\n` +
      `Uptime: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m\n` +
      `Provider: ${provider}\n` +
      `Groq: ${groq ? '✓' : '✗'}  ·  Anthropic: ${anthropic ? '✓' : '✗'}\n` +
      `Active histories: ${histories.size}\n` +
      `Council: #${COUNCIL_CHANNEL}`
    );
    return;
  }

  if (content === '!help') {
    const list = Object.entries(AGENTS)
      .map(([s, { name, icon, opus }]) =>
        `${icon} **#${s}** — ${name}${opus ? ' *(Anthropic)*' : ' *(Groq)*'}`
      )
      .join('\n');
    const tools = DEFINITIONS.map(t => `\`${t.name}\``).join(' · ');
    await message.reply(
      `**◈ Based HQ — Agent Directory**\n\n` +
      `${list}\n\n` +
      `**Tools:** ${tools}\n\n` +
      `**Council mode:** Post in **#${COUNCIL_CHANNEL}** or use \`!council <task>\`\n` +
      `**Direct mode:** Post in an agent channel or prefix: \`architect: question\`\n` +
      `**Commands:** \`!clear\` · \`!help\` · \`!status\` · \`!council <task>\``
    );
    return;
  }

  // ── Council mode: explicit command from any channel ──────────────────────────
  if (content.toLowerCase().startsWith('!council ')) {
    const task = content.slice('!council '.length).trim();
    if (!task) {
      await message.reply('Usage: `!council <task description>`');
      return;
    }
    await runCouncil(task, message.channel);
    return;
  }

  // ── Council mode: posting in #council channel ────────────────────────────────
  if (channelName === COUNCIL_CHANNEL) {
    scheduler.setCouncilChannel(message.channel.id);
    await runCouncil(content, message.channel);
    return;
  }

  // ── Direct mode: resolve agent slug ──────────────────────────────────────────
  let slug, messageContent;

  // By channel name
  const byChannel = Object.keys(AGENTS).find(s => channelName === s);
  if (byChannel) {
    slug = byChannel;
    messageContent = content;
  } else {
    // By prefix: "architect: ..." or "Senior Engineer: ..."
    const lower = content.toLowerCase();
    for (const [s, { name }] of Object.entries(AGENTS)) {
      if (lower.startsWith(s + ':')) {
        slug = s;
        messageContent = content.slice(s.length + 1).trim();
        break;
      }
      const lname = name.toLowerCase();
      if (lower.startsWith(lname + ':')) {
        slug = s;
        messageContent = content.slice(lname.length + 1).trim();
        break;
      }
    }
  }

  if (!slug || !messageContent) return;

  // ── Direct mode: run agent with conversation history ──────────────────────────
  const channelId = message.channel.id;
  if (!histories.has(channelId)) histories.set(channelId, []);
  const history = histories.get(channelId);
  history.push({ role: 'user', content: messageContent });

  const typing = startTyping(message.channel);

  try {
    const onProgress = async (text) => {
      try { await message.channel.send(text); } catch {}
    };

    const reply = await dispatchAgent(slug, [...history], {
      onProgress, currentAgent: slug, channel: message.channel,
    });

    if (!reply) {
      clearInterval(typing);
      await message.reply('No response. Try again.');
      return;
    }

    history.push({ role: 'assistant', content: reply });
    while (history.length > 20) history.shift();

    clearInterval(typing);
    await sendAsAgent(message.channel, slug, reply);

  } catch (err) {
    clearInterval(typing);
    console.error(`[${slug}]`, err);
    await message.reply(`◈ Error: ${(err.message || 'Something went wrong').slice(0, 200)}`);
  }
});

// ── Ready ─────────────────────────────────────────────────────────────────────
discord.once('ready', () => {
  const provider =
    config.provider === 'auto'      ? 'auto  (Groq free · Anthropic Opus for senior 4)' :
    config.provider === 'groq'      ? `groq  (${config.model_groq})` :
    /* anthropic */                   `anthropic  (${config.model_opus} / ${config.model_sonnet})`;

  console.log(`\n◈ Based HQ  →  ${discord.user.tag}`);
  console.log(`  Provider : ${provider}`);
  console.log(`  Ollama   : ${OLLAMA_BASE_URL} (${MODEL_OLLAMA})`);
  console.log(`  Groq     : ${groq       ? '✓ configured (free)' : '✗ not configured'}`);
  console.log(`  Anthropic: ${anthropic  ? '✓ configured'        : '✗ not configured'}`);
  console.log(`  Council  : #${COUNCIL_CHANNEL}`);
  console.log(`\n  Post in #${COUNCIL_CHANNEL} to start a group meeting.\n`);

  discord.user.setActivity('Based HQ', { type: ActivityType.Watching });
  scheduler.init(discord);

  // Register main client under the listener agent slug (default: orchestrator)
  const listenerSlug = config.listener_agent || 'orchestrator';
  registerMainClient(listenerSlug, discord);

  // Connect individual agent bots (if tokens configured)
  if (config.agent_tokens && Object.keys(config.agent_tokens).length) {
    console.log('\n[clients] Connecting individual agent bots...');
    initAgentClients(config.agent_tokens, config.discord_token).then(() => {
      console.log('[clients] Agent bots ready.\n');
    }).catch(err => {
      console.error('[clients] Agent bot init failed:', err.message);
    });
  } else {
    console.log('\n[clients] No agent_tokens in config — all agents using webhook fallback.');
    console.log('          Add individual bot tokens to config.json to give each agent their own identity.\n');
  }
});

discord.on('error', e => console.error('Discord error:', e));
process.on('unhandledRejection', e => console.error('Unhandled:', e));
process.on('SIGINT',  async () => { await destroyAll(); process.exit(0); });
process.on('SIGTERM', async () => { await destroyAll(); process.exit(0); });

const listenerSlug  = config.listener_agent || 'orchestrator';
const listenerToken = config.discord_token || config.agent_tokens?.[listenerSlug];
if (!listenerToken) {
  console.error(`ERROR: No discord_token and no agent_tokens.${listenerSlug} found in config.json`);
  process.exit(1);
}
discord.login(listenerToken);

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
const { runCouncil, quickReply }                  = require('./council');
const { sendAsAgent, sendAsAgentBurst, splitMessage } = require('./messenger');
const { initAgentClients, registerMainClient, getAgentUserId, getAgentUserIdMap, destroyAll } = require('./clients');
const scheduler                                   = require('./scheduler');
const { getHistory, pushHistory, clearHistory, extractMemory } = require('./memory');
const { reactToMessage, reactToAgentMessage }     = require('./reactions');
const { updateLastHusMessage }                    = require('./state');

// ── Urgency detection — only escalating agents @here ─────────────────────────
const ESCALATING_AGENTS = new Set(['security', 'devops', 'senior-engineer']);
const URGENCY_RE = /\b(prod(?:uction)?\s+(is\s+)?(down|outage|failing)|service\s+outage|security\s+breach|data\s+leak|compromised|critical\s+(outage|incident)|emergency\s+(deploy|patch|fix))\b/i;

function isUrgent(slug, text) {
  return ESCALATING_AGENTS.has(slug) && URGENCY_RE.test(text);
}

// ── Poll detection — create a Discord poll when a decision is in play ─────────
const POLL_RE = /\b(should we (go with|use|pick|ship|choose)|option [ab]\b|a vs\.? b\b|which (one|option|approach|version)\b|vote on|i('m| am) torn between|can't decide between)\b/i;

async function maybeSendPoll(channel, slug, reply) {
  if (!POLL_RE.test(reply) || reply.length < 80) return;

  const extractPrompt = `This message was sent in a team chat:\n\n"${reply.slice(0, 500)}"\n\nIf there is a clear binary or small-set decision implied (2-4 options), output JSON only with no other text: {"question": "short poll question max 50 chars", "options": ["Option A", "Option B"]}. Options max 20 chars each. If no clear decision, output: {"question": null}`;

  let pollData;
  try {
    const raw = await quickReply(slug, extractPrompt);
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return;
    pollData = JSON.parse(match[0]);
    if (!pollData.question || !Array.isArray(pollData.options) || pollData.options.length < 2) return;
  } catch { return; }

  await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));

  try {
    await channel.send({
      poll: {
        question: { text: pollData.question.slice(0, 300) },
        answers: pollData.options.slice(0, 4).map(o => ({ text: String(o).slice(0, 55) })),
        duration: 24,
        allowMultiselect: false,
      },
    });
  } catch (err) {
    console.warn('[poll] Create failed:', err.message?.slice(0, 80));
  }
}

// ── Typo generator — swaps two adjacent letters in one content word ───────────
function introduceTypo(text) {
  if (text.includes('```') || text.length < 60) return null;
  const words = text.split(' ');
  const candidates = words
    .map((w, i) => ({ clean: w.replace(/[^a-zA-Z]/g, ''), raw: w, i }))
    .filter(({ clean }) => clean.length >= 5 && /^[a-zA-Z]+$/.test(clean));
  if (!candidates.length) return null;
  const { clean, raw, i } = candidates[Math.floor(Math.random() * candidates.length)];
  const pos  = 1 + Math.floor(Math.random() * (clean.length - 2));
  const typo = clean.slice(0, pos) + clean[pos + 1] + clean[pos] + clean.slice(pos + 2);
  const typoWords = [...words];
  typoWords[i] = raw.replace(clean, typo);
  return { typoText: typoWords.join(' '), correction: `*${clean}` };
}

// ── @mention resolver — turns @Name into <@userId> for Discord rendering ───────
function resolveAgentMentions(text) {
  let result = text;
  for (const [slug, { name }] of Object.entries(AGENTS)) {
    const userId = getAgentUserId(slug);
    if (!userId) continue;
    result = result.replace(new RegExp(`@${name}\\b`, 'g'), `<@${userId}>`);
  }
  return result;
}

// ── Message edit — agent quietly edits their own message 15-35s later ─────────
async function maybeEditMessage(sentMsg, slug, originalText) {
  if (!sentMsg) return;
  await new Promise(r => setTimeout(r, 15000 + Math.random() * 20000));
  const editPrompt = `You just sent this in Discord: "${originalText.slice(0, 300)}"\n\nIf you want to make a small natural edit — fix a word, rephrase something slightly, add a brief clarification you forgot — return only the edited message text. If you'd leave it as is, respond with exactly: [keep]`;
  try {
    const edited = await quickReply(slug, editPrompt);
    if (!edited || edited.toLowerCase().includes('[keep]') || edited.trim() === originalText.trim()) return;
    await sentMsg.edit(edited.slice(0, 2000)).catch(() => {});
  } catch {}
}

// ── Discord client ────────────────────────────────────────────────────────────
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Deduplication — ignore messages already being processed
const processing = new Set();

// ── Log channel — posts bot events to #bot-logs ───────────────────────────────
let logChannel = null;
function log(msg) {
  console.log('[log]', msg);
  if (logChannel) logChannel.send(`\`${new Date().toISOString().slice(11,19)}\` ${msg}`).catch(() => {});
}

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
  // Reactions from agent bots to each other's messages
  if (message.author.bot) {
    if (getAgentUserIdMap().has(message.author.id)) {
      reactToAgentMessage(message).catch(() => {});
    }
    return;
  }
  if (message.author.id !== config.authorized_user_id) return;
  if (processing.has(message.id)) return;
  processing.add(message.id);
  setTimeout(() => processing.delete(message.id), 60000);

  const channelName = message.channel.name?.toLowerCase() ?? '';
  const content     = message.content.trim();
  if (!content) return;

  // Track Hus's last active timestamp for check-in scheduler
  updateLastHusMessage();

  // ── Commands ────────────────────────────────────────────────────────────────
  if (content === '!clear') {
    clearHistory(message.channel.id);
    await message.reply('◈ Conversation cleared.');
    return;
  }

  if (/^(!?purge[d]?|clear\s+chat|wipe\s+chat|delete\s+messages?)\b/i.test(content)) {
    const numMatch = content.match(/\d+/);
    const limit = Math.min(numMatch ? parseInt(numMatch[0]) : 100, 100);
    log(`purge triggered in #${channelName} — fetching ${limit} messages`);
    const status = await message.channel.send(`purging...`).catch(() => null);
    try {
      const fetched = await message.channel.messages.fetch({ limit });
      log(`purge: fetched ${fetched.size} messages, deleting...`);
      let count = 0;
      for (const [, msg] of fetched) {
        await msg.delete().catch(() => {});
        count++;
      }
      log(`purge: done — deleted ${count} messages`);
      if (status) await status.edit(`Deleted ${count} messages.`).catch(() => {});
      setTimeout(() => status?.delete().catch(() => {}), 4000);
    } catch (err) {
      const hint = err.message.includes('Missing Permissions')
        ? 'Bot needs **Manage Messages** permission in this channel.'
        : err.message.slice(0, 200);
      log(`purge error: ${hint}`);
      if (status) await status.edit(`Purge failed: ${hint}`).catch(() => {});
    }
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
      `Active histories: persisted to disk\n` +
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

  // Try to resolve a specific agent from a name/slug prefix — works from any channel
  // Supports: "Kai: message"  "Kai, message"  "senior-engineer: message"
  function resolvePrefix(text) {
    const lower = text.toLowerCase();
    for (const [s, { name }] of Object.entries(AGENTS)) {
      for (const prefix of [name.toLowerCase(), s]) {
        if (lower.startsWith(prefix + ':') || lower.startsWith(prefix + ',')) {
          return { slug: s, body: text.slice(prefix.length + 1).trim() };
        }
      }
    }
    return null;
  }

  const prefixMatch = resolvePrefix(content);
  if (prefixMatch && prefixMatch.body) {
    // Explicit name prefix — always routes directly to that agent
    slug = prefixMatch.slug;
    messageContent = prefixMatch.body;
  } else {
    // By channel name
    const byChannel = Object.keys(AGENTS).find(s => channelName === s);
    if (byChannel) {
      slug = byChannel;
      messageContent = content;
    }
  }

  if (!slug || !messageContent) return;

  // Fire reactions in background — non-blocking, agents react to Hus's message
  reactToMessage(message).catch(() => {});

  // ── Direct mode: run agent with conversation history ──────────────────────────
  const channelId = message.channel.id;
  const history   = getHistory(channelId);
  pushHistory(channelId, 'user', messageContent);

  // Variable response latency — 80% fast, 15% "finishing something", 5% genuinely busy
  const latencyRoll = Math.random();
  const pauseMs = latencyRoll < 0.05
    ? (180 + Math.random() * 120) * 1000   // 3-5 min
    : latencyRoll < 0.20
    ? (30  + Math.random() * 90)  * 1000   // 30-120 s
    : 300  + Math.random() * 1500;          // 300-1800 ms
  await new Promise(r => setTimeout(r, pauseMs));
  const typing = startTyping(message.channel);

  try {
    // Orchestrator channel → council, so agents actually post as themselves
    if (slug === 'orchestrator') {
      clearInterval(typing);
      pushHistory(channelId, 'assistant', '[council]');
      await runCouncil(messageContent, message.channel);
      return;
    }

    const onProgress = async (text) => {
      try { await message.channel.send(text); } catch {}
    };

    const reply = await dispatchAgent(slug, [...history], {
      onProgress, currentAgent: slug, channel: message.channel, discordClient: discord,
    });

    if (!reply) {
      clearInterval(typing);
      await message.reply('No response. Try again.');
      return;
    }

    pushHistory(channelId, 'assistant', reply);

    // Extract memory in background — non-blocking
    extractMemory(slug, getHistory(channelId), anthropic, config.model_sonnet || 'claude-sonnet-4-6').catch(() => {});

    // 12% chance: agent sends a quick self-correction
    if (Math.random() < 0.12) {
      setTimeout(async () => {
        try {
          const correction = await quickReply(slug,
            `You just said: "${reply.slice(0, 200)}"\n\nIf you want to send a quick follow-up correction or add something you missed (start with "wait," or "actually,"), do it in one line. If you have nothing to correct or add, respond with exactly: [fine]`
          );
          if (correction && !correction.toLowerCase().includes('[fine]') && correction.length > 4) {
            await sendAsAgent(message.channel, slug, correction);
          }
        } catch {}
      }, 2000 + Math.random() * 3000);
    }

    // @here prefix for genuine critical escalations
    let finalReply = isUrgent(slug, reply) ? `@here — ${reply}` : reply;
    // Resolve @Name mentions into Discord user mentions
    finalReply = resolveAgentMentions(finalReply);

    // 40% chance: use Discord's reply-to UI (shows the quoted message header)
    const replyToId = Math.random() < 0.40 ? message.id : null;

    // 8% chance: introduce a typo, then self-correct a few seconds later
    const typoResult = Math.random() < 0.08 ? introduceTypo(finalReply) : null;

    clearInterval(typing);

    if (typoResult) {
      const sentMsg = await sendAsAgentBurst(message.channel, slug, typoResult.typoText, replyToId);
      if (Math.random() < 0.15) maybeEditMessage(sentMsg, slug, reply).catch(() => {});
      setTimeout(async () => {
        try { await sendAsAgent(message.channel, slug, typoResult.correction); } catch {}
      }, 2000 + Math.random() * 3000);
    } else {
      const sentMsg = await sendAsAgentBurst(message.channel, slug, finalReply, replyToId);
      if (Math.random() < 0.15) maybeEditMessage(sentMsg, slug, reply).catch(() => {});
    }

    // Create a poll if the reply implies a decision — non-blocking
    maybeSendPoll(message.channel, slug, reply).catch(() => {});

  } catch (err) {
    clearInterval(typing);
    log(`[${slug}] error: ${err.message?.slice(0, 200)}`);
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

  // Find log channel
  const logChannelName = config.log_channel || 'bot-logs';
  for (const guild of discord.guilds.cache.values()) {
    const ch = guild.channels.cache.find(c => c.name === logChannelName && c.isTextBased?.());
    if (ch) { logChannel = ch; break; }
  }
  log(`Bot started. Provider: ${provider}. Log channel: ${logChannel ? '#' + logChannelName : 'none'}`);

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

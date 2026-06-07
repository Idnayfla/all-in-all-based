#!/usr/bin/env node
/**
 * Based HQ — Discord Bot
 *
 * Setup (one-time):
 *   1. Go to https://discord.com/developers/applications → New Application → "Based HQ"
 *   2. Bot tab → Add Bot → copy Token → paste into config.json as discord_token
 *   3. Bot tab → enable MESSAGE CONTENT INTENT (required to read messages)
 *   4. OAuth2 → URL Generator → scopes: bot → permissions: Send Messages, Read Message History, Use Slash Commands
 *   5. Copy generated URL → open in browser → add bot to your server
 *   6. Get your Discord user ID: Settings → Advanced → Developer Mode ON → right-click your name → Copy ID
 *   7. Copy config.example.json → config.json, fill in all values
 *
 * Run:
 *   npm install
 *   node bot.js
 *
 * Run on Pi (always-on):
 *   npm install -g pm2
 *   pm2 start bot.js --name based-hq
 *   pm2 save && pm2 startup
 *
 * Commands (in any agent channel):
 *   !clear   — reset conversation history for that channel
 *   !help    — show available agents
 *   !status  — show bot status
 */

const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('ERROR: config.json not found. Copy config.example.json → config.json');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

// ── Agent registry ────────────────────────────────────────────────────────
const AGENTS = {
  orchestrator:      { name: 'Orchestrator',     icon: '◉', opus: true  },
  architect:         { name: 'Architect',         icon: '⬡', opus: true  },
  'senior-engineer': { name: 'Senior Engineer',   icon: '◈', opus: true  },
  'ai-engineer':     { name: 'AI Engineer',       icon: '⊙', opus: true  },
  product:           { name: 'Product',           icon: '◈', opus: false },
  designer:          { name: 'Designer',          icon: '◉', opus: false },
  devops:            { name: 'DevOps',            icon: '⬡', opus: false },
  security:          { name: 'Security',          icon: '◈', opus: false },
  qa:                { name: 'QA',                icon: '⊙', opus: false },
  growth:            { name: 'Growth',            icon: '◉', opus: false },
  'data-analyst':    { name: 'Data Analyst',      icon: '⬡', opus: false },
  mobile:            { name: 'Mobile',            icon: '◈', opus: false },
  finance:           { name: 'Finance',           icon: '◉', opus: false },
  legal:             { name: 'Legal',             icon: '⊙', opus: false },
  community:         { name: 'Community',         icon: '⬡', opus: false },
  'chief-of-staff':  { name: 'Chief of Staff',    icon: '◈', opus: false },
  'technical-writer':{ name: 'Technical Writer',  icon: '◉', opus: false },
};

const MODEL_OPUS   = config.model_opus   || 'claude-opus-4-8';
const MODEL_SONNET = config.model_sonnet || 'claude-sonnet-4-6';

// ── Clients ───────────────────────────────────────────────────────────────
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const anthropic = new Anthropic({ apiKey: config.anthropic_api_key });

// ── Conversation histories (per channel, last 20 messages = 10 turns) ─────
const histories = new Map();

// ── System prompt loader ──────────────────────────────────────────────────
function loadSystemPrompt(slug) {
  const agentsDir = config.agents_dir
    || path.join(__dirname, '..', '.claude', 'agents');

  const DISCORD_ADDENDUM = `

---
You are responding in the Based HQ Discord server — Hus's private team workspace.
Be direct and concise. Use Discord markdown (bold, code blocks, bullet lists) when it adds clarity.
Keep responses under 1800 characters unless the question genuinely requires depth.
Never start with "I'm the [Agent]" — just respond directly.`;

  try {
    return fs.readFileSync(path.join(agentsDir, `${slug}.md`), 'utf-8') + DISCORD_ADDENDUM;
  } catch {
    return `You are the ${AGENTS[slug]?.name || slug} specialist for Based AI studio.${DISCORD_ADDENDUM}`;
  }
}

// ── Call a single agent ───────────────────────────────────────────────────
async function callAgent(slug, messages) {
  const agent  = AGENTS[slug];
  const model  = agent?.opus ? MODEL_OPUS : MODEL_SONNET;
  const system = loadSystemPrompt(slug);

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system,
    messages,
  });

  return response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
}

// ── Orchestrator: coordinates across agents ───────────────────────────────
async function handleOrchestrator(userMessage, history) {
  // Phase 1: Orchestrator plans + responds with its own synthesis
  const orchestratorReply = await callAgent('orchestrator', history);

  // Detect if the orchestrator is routing to specific agents
  const involvedSlugs = Object.keys(AGENTS).filter(slug => {
    if (slug === 'orchestrator') return false;
    const agentName = AGENTS[slug].name.toLowerCase();
    return orchestratorReply.toLowerCase().includes(agentName) ||
           orchestratorReply.toLowerCase().includes(slug.replace('-', ' '));
  });

  // If orchestrator only references ≤1 agent, its own response is enough
  if (involvedSlugs.length <= 1) return orchestratorReply;

  // Multi-agent: call each involved agent and stitch outputs
  const agentOutputs = await Promise.all(
    involvedSlugs.slice(0, 4).map(async slug => { // cap at 4 agents
      const agentMessages = [{ role: 'user', content: userMessage }];
      const reply = await callAgent(slug, agentMessages);
      const { name, icon } = AGENTS[slug];
      return `**${icon} ${name}**\n${reply}`;
    })
  );

  return `${orchestratorReply}\n\n---\n${agentOutputs.join('\n\n---\n')}`;
}

// ── Split long messages (Discord 2000 char limit) ─────────────────────────
function splitMessage(text, maxLen = 1900) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.6) cut = maxLen;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

// ── Typing indicator helper ───────────────────────────────────────────────
function startTyping(channel) {
  channel.sendTyping().catch(() => {});
  return setInterval(() => channel.sendTyping().catch(() => {}), 8000);
}

// ── Message handler ───────────────────────────────────────────────────────
discord.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Admin gate — only Hus
  if (message.author.id !== config.authorized_user_id) return;

  const channelName = message.channel.name?.toLowerCase();
  const content     = message.content.trim();
  if (!content) return;

  // ── Built-in commands ────────────────────────────────────────────────
  if (content === '!clear') {
    histories.delete(message.channel.id);
    await message.reply('◈ Conversation cleared.');
    return;
  }

  if (content === '!status') {
    const uptime = Math.floor(process.uptime());
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = uptime % 60;
    await message.reply(
      `**◈ Based HQ Status**\n` +
      `Uptime: ${h}h ${m}m ${s}s\n` +
      `Active histories: ${histories.size} channels\n` +
      `LLM: Opus (${MODEL_OPUS}) / Sonnet (${MODEL_SONNET})`
    );
    return;
  }

  if (content === '!help') {
    const agentList = Object.entries(AGENTS)
      .map(([slug, { name, icon, opus }]) =>
        `${icon} **#${slug}** — ${name}${opus ? ' *(Opus)*' : ''}`)
      .join('\n');
    await message.reply(`**◈ Based HQ — Your Team**\n\n${agentList}\n\n**Commands:** !clear · !status · !help`);
    return;
  }

  // ── Route to agent based on channel name ─────────────────────────────
  const agentSlug = Object.keys(AGENTS).find(slug => channelName === slug);
  if (!agentSlug) return;

  // Get or init conversation history
  const channelId = message.channel.id;
  if (!histories.has(channelId)) histories.set(channelId, []);
  const history = histories.get(channelId);

  history.push({ role: 'user', content });

  const typing = startTyping(message.channel);

  try {
    let reply;

    if (agentSlug === 'orchestrator') {
      reply = await handleOrchestrator(content, history);
    } else {
      reply = await callAgent(agentSlug, history);
    }

    if (!reply) {
      clearInterval(typing);
      await message.reply('No response received. Try again.');
      return;
    }

    history.push({ role: 'assistant', content: reply });

    // Keep last 20 messages (10 turns)
    while (history.length > 20) history.shift();

    clearInterval(typing);

    const parts = splitMessage(reply);
    await message.reply(parts[0]);
    for (const part of parts.slice(1)) {
      await message.channel.send(part);
    }

  } catch (err) {
    clearInterval(typing);
    console.error(`[${agentSlug}] Error:`, err.message);
    await message.reply(`◈ Error: ${(err.message || 'Something went wrong').slice(0, 200)}`);
  }
});

// ── Ready ─────────────────────────────────────────────────────────────────
discord.once('ready', () => {
  console.log(`\n◈ Based HQ online  →  ${discord.user.tag}`);
  console.log(`  Authorized user : ${config.authorized_user_id}`);
  console.log(`  Opus model      : ${MODEL_OPUS}`);
  console.log(`  Sonnet model    : ${MODEL_SONNET}`);
  console.log(`  Agents dir      : ${config.agents_dir || path.join(__dirname, '..', '.claude', 'agents')}`);
  console.log(`\n  Type !help in any agent channel to get started.\n`);
  discord.user.setActivity('Based HQ', { type: ActivityType.Watching });
});

discord.on('error', err => console.error('Discord error:', err));
process.on('unhandledRejection', err => console.error('Unhandled:', err));

discord.login(config.discord_token);

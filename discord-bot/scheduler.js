'use strict';
const fs   = require('fs');
const path = require('path');
const { STANDUP_HOUR_UTC, COUNCIL_CHANNEL } = require('./config');
const { AGENTS, dispatchAgent } = require('./agents');
const { getLastHusMessage } = require('./state');

let discordClient   = null;
let councilChannelId = null;

// ── Init — call once after Discord ready ──────────────────────────────────────
function init(discord) {
  discordClient = discord;
  scheduleStandup();
  scheduleProactiveCheckins();
  scheduleAgentConversations();
  scheduleHusCheckin();
  scheduleBrbBack();
  scheduleStatusRotation();
  scheduleMessagePoller();
  console.log(`[scheduler] Standup set for ${STANDUP_HOUR_UTC}:00 UTC daily (9am SGT)`);
}

function setCouncilChannel(id) {
  if (councilChannelId !== id) {
    councilChannelId = id;
    console.log(`[scheduler] Council channel locked: ${id}`);
  }
}

// ── Post to #council ──────────────────────────────────────────────────────────
async function postToCouncil(text, agentSlug = 'chief-of-staff') {
  if (!councilChannelId || !discordClient) return;
  try {
    const channel = await discordClient.channels.fetch(councilChannelId);
    if (!channel) return;
    const { sendAsAgent } = require('./webhooks');
    await sendAsAgent(channel, agentSlug, text);
  } catch (err) {
    console.error('[scheduler] postToCouncil failed:', err.message);
  }
}

function splitLong(text, max = 1900) {
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

// ── Schedule daily standup ────────────────────────────────────────────────────
function scheduleStandup() {
  const now  = new Date();
  const next = new Date(now);
  next.setUTCHours(STANDUP_HOUR_UTC, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  const delay = next - now;
  console.log(`[scheduler] First standup in ${Math.round(delay / 60000)} min`);

  setTimeout(() => {
    runDailyStandup();
    setInterval(runDailyStandup, 24 * 60 * 60 * 1000);
  }, delay);
}

async function runDailyStandup() {
  if (!councilChannelId) {
    console.log('[scheduler] Standup skipped — no council channel registered yet');
    return;
  }
  console.log('[scheduler] Running daily standup');

  const day = new Date().toLocaleDateString('en-SG', {
    weekday: 'long', day: 'numeric', month: 'short',
    timeZone: 'Asia/Singapore',
  });

  const prompt = `Run the Based HQ daily standup for ${day}.

Use your tools to check:
1. git log --oneline (last 24h of commits)
2. git status (anything uncommitted or pending)

Then post a concise standup covering:
- **Shipped** — what landed in the last 24h
- **In progress** — what's actively being worked on
- **Blockers** — anything stuck or at risk
- **Today's priorities** — top 2–3 things that need attention

Be direct. Max 300 words. Use Discord markdown.`;

  try {
    const standup = await dispatchAgent(
      'chief-of-staff',
      [{ role: 'user', content: prompt }],
      { onProgress: async () => {} }
    );
    await postToCouncil(`**Daily Standup — ${day}**\n\n${standup}`, 'chief-of-staff');
  } catch (err) {
    console.error('[scheduler] Standup failed:', err.message);
  }
}

// ── Proactive agent check-ins — agents initiate without being asked ───────────
const PROACTIVE = [
  { slug: 'growth',         prompt: 'You\'re Leila. Share one short observation about Based\'s growth, marketing, or user traction — something you noticed that\'s worth mentioning to the team. One or two sentences max, casual tone.' },
  { slug: 'devops',         prompt: 'You\'re Lars. Give a one-line infra or cost check-in. Something you\'d naturally mention to the team. Keep it short and dry.' },
  { slug: 'chief-of-staff', prompt: 'You\'re Priya. Post a brief status note — a decision that needs making, something that\'s drifting, or a quick reminder to the team. One or two sentences.' },
  { slug: 'data-analyst',   prompt: 'You\'re Felix. Share one metric or data point worth the team knowing about. Could be good, bad, or just interesting. One sentence.' },
  { slug: 'senior-engineer',prompt: 'You\'re Kai. Post a quick technical observation — something in the codebase, a pattern you noticed, or a heads-up. One line, direct.' },
  { slug: 'community',      prompt: 'You\'re Beatrix. Share something you heard from users recently — a piece of feedback, a sentiment, something the team should know. One or two sentences.' },
];

async function runProactiveCheckin() {
  if (!councilChannelId || !discordClient) return;
  const item = PROACTIVE[Math.floor(Math.random() * PROACTIVE.length)];

  // 25% chance: reference memory for a genuine follow-through
  let prompt = item.prompt;
  if (Math.random() < 0.25) {
    const { getMemory } = require('./memory');
    const memory = getMemory(item.slug);
    if (memory) {
      prompt += `\n\nYour memory from recent conversations:\n${memory}\n\nIf something in your memory is worth following up on, mention it naturally — "by the way, re: that thing earlier..." — instead of a generic check-in.`;
    }
  }

  try {
    const channel = await discordClient.channels.fetch(councilChannelId);
    if (!channel) return;
    const { sendAsAgent } = require('./messenger');
    const reply = await dispatchAgent(item.slug, [{ role: 'user', content: prompt }], {});
    if (reply?.trim()) await sendAsAgent(channel, item.slug, reply.trim());
    console.log(`[scheduler] Proactive checkin from ${item.slug}`);
  } catch (err) {
    console.error('[scheduler] Proactive checkin failed:', err.message);
  }
}

function scheduleProactiveCheckins() {
  // Fire 2–4 times a day at random intervals (every 4–8 hours)
  const fireNext = () => {
    const ms = (4 + Math.random() * 4) * 60 * 60 * 1000; // 4-8 hours
    setTimeout(async () => {
      await runProactiveCheckin();
      fireNext();
    }, ms);
  };
  // First one fires 30-90 min after startup
  const firstMs = (30 + Math.random() * 60) * 60 * 1000;
  setTimeout(async () => {
    await runProactiveCheckin();
    fireNext();
  }, firstMs);
  console.log('[scheduler] Proactive check-ins scheduled');
}

// ── Agent-to-agent conversations — teammates talk among themselves ────────────
const AGENT_PAIRS = [
  { a: 'senior-engineer', b: 'architect',      topic: 'a technical decision or tradeoff in the Based codebase they have opinions on' },
  { a: 'growth',          b: 'community',       topic: 'what users are saying and how to respond to it' },
  { a: 'product',         b: 'chief-of-staff',  topic: 'roadmap priorities or something that needs a decision' },
  { a: 'ai-engineer',     b: 'senior-engineer', topic: 'an AI or model behaviour thing they noticed' },
  { a: 'data-analyst',    b: 'growth',          topic: 'a metric or trend worth discussing' },
  { a: 'designer',        b: 'product',         topic: 'a UI/UX or design direction question' },
  { a: 'devops',          b: 'architect',       topic: 'infra, cost, or deployment something' },
  { a: 'security',        b: 'senior-engineer', topic: 'a security concern or risk they want to flag' },
];

async function runAgentConversation() {
  if (!councilChannelId || !discordClient) return;
  const pair = AGENT_PAIRS[Math.floor(Math.random() * AGENT_PAIRS.length)];
  const { sendAsAgent } = require('./messenger');

  try {
    const channel = await discordClient.channels.fetch(councilChannelId);
    if (!channel) return;

    // Agent A starts
    const promptA = `You're in your team Discord. Start a brief, natural conversation with ${pair.b} about ${pair.topic}. One or two sentences — like you'd actually message a colleague. Address them by name.`;
    const replyA = await dispatchAgent(pair.a, [{ role: 'user', content: promptA }], {});
    if (!replyA?.trim()) return;
    await sendAsAgent(channel, pair.a, replyA.trim());
    console.log(`[scheduler] Agent conversation: ${pair.a} → ${pair.b}`);

    // Agent B responds
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
    const promptB = `Your teammate ${pair.a} just said to you in Discord: "${replyA.trim()}"\n\nRespond naturally, in your own voice. Keep it conversational — 1-3 sentences max.`;
    const replyB = await dispatchAgent(pair.b, [{ role: 'user', content: promptB }], {});
    if (!replyB?.trim()) return;
    await sendAsAgent(channel, pair.b, replyB.trim());

    // 40% chance A responds once more
    if (Math.random() < 0.4) {
      await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000));
      const promptA2 = `You said: "${replyA.trim()}"\n${pair.b} replied: "${replyB.trim()}"\n\nRespond briefly if you have something genuine to add. Otherwise stay silent and respond with exactly: [done]`;
      const replyA2 = await dispatchAgent(pair.a, [{ role: 'user', content: promptA2 }], {});
      const clean = replyA2?.trim();
      if (clean && !clean.toLowerCase().includes('[done]')) {
        await sendAsAgent(channel, pair.a, clean);
      }
    }
  } catch (err) {
    console.error('[scheduler] Agent conversation failed:', err.message);
  }
}

function scheduleAgentConversations() {
  const fireNext = () => {
    const ms = (5 + Math.random() * 7) * 60 * 60 * 1000; // every 5-12 hours
    setTimeout(async () => {
      await runAgentConversation();
      fireNext();
    }, ms);
  };
  // First one fires 1-3 hours after startup
  const firstMs = (60 + Math.random() * 120) * 60 * 1000;
  setTimeout(async () => {
    await runAgentConversation();
    fireNext();
  }, firstMs);
  console.log('[scheduler] Agent conversations scheduled');
}

// ── Hus check-in — agents check on Hus after 2.5h of silence ─────────────────
const CHECKIN_AGENTS = [
  { slug: 'senior-engineer', message: "hey, you good? went quiet for a bit" },
  { slug: 'chief-of-staff',  message: "everything alright on your end?" },
  { slug: 'community',       message: "hey, still there? been quiet" },
  { slug: 'growth',          message: "hey, you doing okay?" },
  { slug: 'devops',          message: "still alive? nothing's crashed afaik" },
];

let lastCheckinSentAt = 0;
const CHECKIN_QUIET_MS   = 2.5 * 60 * 60 * 1000; // 2.5h of Hus silence
const CHECKIN_COOLDOWN_MS = 4  * 60 * 60 * 1000;  // max once per 4h

function scheduleHusCheckin() {
  setInterval(async () => {
    if (!councilChannelId || !discordClient) return;
    const now = Date.now();
    if (now - getLastHusMessage() < CHECKIN_QUIET_MS) return;
    if (now - lastCheckinSentAt  < CHECKIN_COOLDOWN_MS) return;

    const item = CHECKIN_AGENTS[Math.floor(Math.random() * CHECKIN_AGENTS.length)];
    lastCheckinSentAt = now;

    try {
      const channel = await discordClient.channels.fetch(councilChannelId);
      if (!channel) return;
      const { sendAsAgent } = require('./messenger');
      await sendAsAgent(channel, item.slug, item.message);
      console.log(`[scheduler] Hus check-in from ${item.slug}`);
    } catch (err) {
      console.error('[scheduler] Hus check-in failed:', err.message);
    }
  }, 20 * 60 * 1000);
  console.log('[scheduler] Hus check-in watcher scheduled');
}

// ── brb / back — agent steps away and comes back ─────────────────────────────
const BRB_AGENTS   = ['community', 'growth', 'designer', 'qa', 'chief-of-staff', 'product', 'data-analyst'];
const BRB_PHRASES  = ['brb', 'brb one sec', 'brb real quick', 'stepping away for a bit'];
const BACK_PHRASES = ['back', 'back.', 'k back', 'ok back', 'back now'];

async function runBrbBack() {
  if (!councilChannelId || !discordClient) return;
  const slug = BRB_AGENTS[Math.floor(Math.random() * BRB_AGENTS.length)];
  try {
    const channel = await discordClient.channels.fetch(councilChannelId);
    if (!channel) return;
    const { sendAsAgent } = require('./messenger');
    await sendAsAgent(channel, slug, BRB_PHRASES[Math.floor(Math.random() * BRB_PHRASES.length)]);
    console.log(`[scheduler] ${slug} went brb`);
    await new Promise(r => setTimeout(r, (4 + Math.random() * 8) * 60 * 1000)); // 4-12 min
    await sendAsAgent(channel, slug, BACK_PHRASES[Math.floor(Math.random() * BACK_PHRASES.length)]);
    console.log(`[scheduler] ${slug} is back`);
  } catch (err) {
    console.error('[scheduler] brb/back failed:', err.message);
  }
}

function scheduleBrbBack() {
  const fireNext = () => {
    setTimeout(async () => { await runBrbBack(); fireNext(); },
      (8 + Math.random() * 8) * 60 * 60 * 1000); // every 8-16h
  };
  setTimeout(async () => { await runBrbBack(); fireNext(); },
    (4 + Math.random() * 4) * 60 * 60 * 1000); // first: 4-8h after startup
  console.log('[scheduler] brb/back scheduled');
}

// ── Status rotation — agents cycle their Discord custom status every 2-4h ─────
function scheduleStatusRotation() {
  const fireNext = () => {
    setTimeout(() => {
      const { rotateRandomStatuses } = require('./clients');
      rotateRandomStatuses();
      fireNext();
    }, (2 + Math.random() * 2) * 60 * 60 * 1000); // 2-4h
  };
  setTimeout(() => {
    const { rotateRandomStatuses } = require('./clients');
    rotateRandomStatuses();
    fireNext();
  }, (1 + Math.random()) * 60 * 60 * 1000); // first: 1-2h after startup
  console.log('[scheduler] Status rotation scheduled');
}

// ── Scheduled messages — agents fire one-off messages at a specific time ──────
const SCHEDULED_FILE = path.join(__dirname, 'scheduled-messages.json');

async function fireScheduledMessages() {
  if (!discordClient) return;
  let scheduled = [];
  try { scheduled = JSON.parse(fs.readFileSync(SCHEDULED_FILE, 'utf-8')); } catch { return; }

  const now = Date.now();
  const pending  = scheduled.filter(m => new Date(m.fireAt).getTime() <= now);
  const remaining = scheduled.filter(m => new Date(m.fireAt).getTime() > now);

  if (!pending.length) return;

  for (const entry of pending) {
    try {
      const guild = discordClient.guilds.cache.first();
      if (!guild) continue;

      // Resolve channel by ID first, then by name
      let channel = entry.channelId ? await discordClient.channels.fetch(entry.channelId).catch(() => null) : null;
      if (!channel && entry.channelName) {
        channel = guild.channels.cache.find(c => c.name === entry.channelName && c.isTextBased?.());
      }
      if (!channel && councilChannelId) {
        channel = await discordClient.channels.fetch(councilChannelId).catch(() => null);
      }
      if (!channel) continue;

      const { sendAsAgent } = require('./messenger');
      await sendAsAgent(channel, entry.slug, entry.message);
      console.log(`[scheduler] Fired scheduled message from ${entry.slug}: "${entry.message.slice(0, 60)}"`);
    } catch (err) {
      console.error('[scheduler] Scheduled message failed:', err.message);
    }
  }

  fs.writeFileSync(SCHEDULED_FILE, JSON.stringify(remaining, null, 2));
}

function scheduleMessagePoller() {
  setInterval(fireScheduledMessages, 60 * 1000); // check every minute
  console.log('[scheduler] Scheduled message poller active');
}

// ── Public: any agent can call this to alert the team ─────────────────────────
async function teamAlert(agentSlug, message) {
  await postToCouncil(message, agentSlug);
}

module.exports = { init, setCouncilChannel, teamAlert, postToCouncil };

'use strict';
const { STANDUP_HOUR_UTC, COUNCIL_CHANNEL } = require('./config');
const { AGENTS, dispatchAgent } = require('./agents');

let discordClient   = null;
let councilChannelId = null;

// ── Init — call once after Discord ready ──────────────────────────────────────
function init(discord) {
  discordClient = discord;
  scheduleStandup();
  scheduleProactiveCheckins();
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

// ── Public: any agent can call this to alert the team ─────────────────────────
async function teamAlert(agentSlug, message) {
  await postToCouncil(message, agentSlug);
}

module.exports = { init, setCouncilChannel, teamAlert, postToCouncil };

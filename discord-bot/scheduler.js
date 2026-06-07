'use strict';
const { STANDUP_HOUR_UTC, COUNCIL_CHANNEL } = require('./config');
const { AGENTS, dispatchAgent } = require('./agents');

let discordClient   = null;
let councilChannelId = null;

// ── Init — call once after Discord ready ──────────────────────────────────────
function init(discord) {
  discordClient = discord;
  scheduleStandup();
  console.log(`[scheduler] Standup set for ${STANDUP_HOUR_UTC}:00 UTC daily (9am SGT)`);
}

function setCouncilChannel(id) {
  if (councilChannelId !== id) {
    councilChannelId = id;
    console.log(`[scheduler] Council channel locked: ${id}`);
  }
}

// ── Post to #council ──────────────────────────────────────────────────────────
async function postToCouncil(text) {
  if (!councilChannelId || !discordClient) return;
  try {
    const channel = await discordClient.channels.fetch(councilChannelId);
    if (!channel) return;
    const parts = splitLong(text);
    for (const p of parts) await channel.send(p);
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
    await postToCouncil(`◈ **Daily Standup — ${day}**\n\n${standup}`);
  } catch (err) {
    console.error('[scheduler] Standup failed:', err.message);
  }
}

// ── Public: any agent can call this to alert the team ─────────────────────────
async function teamAlert(agentSlug, message) {
  const agent = AGENTS[agentSlug] || { icon: '◈', name: agentSlug };
  await postToCouncil(`${agent.icon} **${agent.name} — Alert:**\n${message}`);
}

module.exports = { init, setCouncilChannel, teamAlert, postToCouncil };

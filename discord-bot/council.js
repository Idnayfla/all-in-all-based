'use strict';
const { AGENTS, dispatchAgent, anthropic } = require('./agents');
const { MODEL_SONNET }                     = require('./config');
const { sendAsAgent, sendAsOrchestrator, sendAsAgentWithFiles } = require('./messenger');
const { getAgentClient }                   = require('./clients');
const { searchGifUrl }                     = require('./tools');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const AGENT_GAP_MS = 4000;

// Random human-like pause before responding (300–2000ms)
const humanDelay = () => sleep(300 + Math.random() * 1700);

// Detect Hus's tone to inject into agent prompts
function detectTone(text) {
  const allCaps = text === text.toUpperCase() && /[A-Z]{2,}/.test(text);
  const excited = (text.match(/!/g) || []).length >= 2 || allCaps;
  const veryShort = text.trim().length < 25;
  const detailed = text.trim().length > 250;
  if (excited)    return 'Hus is excited — match the energy, be punchy';
  if (veryShort)  return 'Hus is being brief — keep your reply very short';
  if (detailed)   return 'Hus sent a detailed message — being thorough is fine';
  return '';
}

// ── Strip XML tool-call artifacts that models sometimes output as plain text ──
function sanitize(text) {
  if (!text) return '';
  return text
    // Standard Anthropic tool-use XML
    .replace(/<function_calls>[\s\S]*?<\/antml:function_calls>/g, '')
    // Generic <function_calls> block
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
    // Stray <invoke> blocks
    .replace(/<invoke[\s\S]*?<\/invoke>/g, '')
    // Stray <parameter> lines
    .replace(/<parameter[^>]*>[\s\S]*?<\/parameter>/g, '')
    // Any remaining angle-bracket XML-looking lines
    .replace(/^<[a-z_]+[^>]*>.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Detect pure one-word / short greeting ─────────────────────────────────────
function isPureGreeting(text) {
  // Strip trailing punctuation only — no letters
  const lower = text.toLowerCase().trim().replace(/[!?.,]+$/, '');
  const words  = ['hey', 'hi', 'hello', 'sup', 'yo', 'morning', 'haha', 'lol', 'hahaha', 'lmao', 'heyyy', 'heyy'];
  return (
    text.length < 30 &&
    words.some(g => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + ','))
  );
}

// ── Broadcast — agents respond in waves, later ones reference earlier replies ──
async function runBroadcast(originalMessage, channel) {
  const allSlugs = Object.keys(AGENTS).filter(s => s !== 'orchestrator');
  const seen = []; // grows as agents respond — gives later agents context

  await sendAsOrchestrator(channel, 'on it.').catch(() => {});

  const BATCH = 4;
  for (let b = 0; b < allSlugs.length; b += BATCH) {
    const batch = allSlugs.slice(b, b + BATCH);
    const priorStr = seen.slice(-4).map(r => `${r.name}: ${r.reply}`).join('\n');
    const prompt = priorStr
      ? `${originalMessage}\n\nSome teammates already said:\n${priorStr}\n\nYour turn. One line, your own voice. React to what others said if natural.`
      : `${originalMessage}\n\nRespond in your own voice. One line.`;

    await Promise.all(
      batch.map((slug, i) =>
        sleep(i * 1000).then(async () => {
          await humanDelay();
          const t = startTyping(channel);
          try {
            const reply = await quickReply(slug, prompt);
            clearInterval(t);
            const clean = sanitize(reply);
            if (clean) {
              await sendAsAgent(channel, slug, clean);
              seen.push({ name: AGENTS[slug]?.name || slug, reply: clean });
            }
          } catch { clearInterval(t); }
        })
      )
    );
    if (b + BATCH < allSlugs.length) await sleep(800);
  }
}

// ── Orchestrator routing prompt ───────────────────────────────────────────────
const ROUTING_SYSTEM = `You are the Orchestrator for Based HQ — a private dev team Discord server. Hus is the CEO and founder.

A message was posted. Respond with ONLY a valid JSON object. No markdown, no explanation. Raw JSON only.

{
  "broadcast": false,
  "casual": false,
  "reasoning": "one sentence",
  "agents": ["slug1", "slug2"],
  "executor": "slug"
}

STEP 1 — Should ALL agents respond?
broadcast: true when ANY of these apply:
- Hus greets the whole group ("wassup everyone", "hey all", "henlo team", "yo all")
- Hus asks where the others are ("where are the rest", "where is everyone", "why aren't they talking")
- Hus wants the others to say/do something ("can they say hello", "tell them all to X", "have everyone Y")
- Hus notices only one person responded and wants more ("only you?", "just you?", "where are the others")
- ANY message that implies Hus wants to hear from multiple people, not just Maya

broadcast: false — task for specific agents, or genuine 1-on-1 chat with Maya

If broadcast: true → set casual: true, agents: [], executor: null.

STEP 2 — If broadcast: false, casual or real task?
casual: true  — chitchat, opinions, questions not needing code/file access
casual: false — codebase, bugs, features, status, deployments, decisions

When casual: true  → agents: [], executor: null
When casual: false → pick 2–4 agents from routing guide below

Routing guide:
- Status / codebase review → ["chief-of-staff", "senior-engineer"],       executor: null
- Bug fix                  → ["senior-engineer", "qa"],                   executor: "senior-engineer"
- New feature              → ["product", "architect", "senior-engineer"], executor: "senior-engineer"
- Infra / cost             → ["devops", "architect"],                     executor: "devops"
- Security                 → ["security", "architect", "senior-engineer"],executor: "senior-engineer"
- Growth / copy            → ["growth", "designer"],                      executor: "growth"
- Data / analytics         → ["data-analyst"],                            executor: null
- Legal / privacy          → ["legal"],                                   executor: null
- Product decision         → ["chief-of-staff", "product"],               executor: null
- Design                   → ["designer", "senior-engineer"],             executor: "senior-engineer"

Valid slugs: architect, senior-engineer, ai-engineer, product, designer, devops, security, qa, growth, data-analyst, mobile, finance, legal, community, chief-of-staff, technical-writer`;

// ── Routing ───────────────────────────────────────────────────────────────────
async function getRouting(task) {
  if (!anthropic) throw new Error('Anthropic required for routing.');

  const res = await anthropic.messages.create({
    model: MODEL_SONNET, max_tokens: 512,
    system: ROUTING_SYSTEM,
    messages: [{ role: 'user', content: task }],
  });

  const text  = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Non-JSON routing response: ${text.slice(0, 200)}`);

  const routing = JSON.parse(match[0]);
  console.log(`[routing] broadcast=${routing.broadcast} casual=${routing.casual} agents=[${(routing.agents || []).join(',')}] executor=${routing.executor || 'none'}`);

  if (routing.broadcast) return routing;

  const valid    = Object.keys(AGENTS).filter(s => s !== 'orchestrator');
  routing.agents = (routing.agents || []).filter(s => valid.includes(s)).slice(0, 4);

  if (!routing.casual) {
    if (!routing.agents.length) routing.agents = ['senior-engineer'];
    if (routing.executor && !valid.includes(routing.executor)) routing.executor = routing.agents[0];
  }

  return routing;
}

// ── Fast no-tools reply for casual/greeting messages ─────────────────────────
async function quickReply(slug, message) {
  const { loadSystemPrompt } = require('./agents');
  const system = loadSystemPrompt(slug);
  const res = await anthropic.messages.create({
    model: MODEL_SONNET, max_tokens: 120, system,
    messages: [{ role: 'user', content: message }],
  });
  return sanitize(res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim());
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function startTyping(channel) {
  channel.sendTyping().catch(() => {});
  return setInterval(() => channel.sendTyping().catch(() => {}), 8000);
}

// ── Run a single council agent ────────────────────────────────────────────────
const ACKS = ['give me a sec', 'let me look at this', 'one sec', 'checking', 'on it'];

async function runCouncilAgent(slug, task, channel, priorContext = '') {
  // 30% chance for complex tasks: send a brief ack before diving in
  if (task.length > 200 && Math.random() < 0.30) {
    const ack = ACKS[Math.floor(Math.random() * ACKS.length)];
    await sendAsAgent(channel, slug, ack);
    await sleep(3000 + Math.random() * 5000);
  }

  const typing = startTyping(channel);
  const prompt = priorContext
    ? `The team is discussing:\n\n${priorContext}\n\nWeigh in from your perspective on: ${task}\n\nKeep it to 2-3 sentences max. Discord chat — no lists, no headers, no essays.`
    : `Council task:\n${task}\n\nKeep it to 2-3 sentences max. Discord chat — no lists, no headers, no essays.`;

  try {
    const reply = await dispatchAgent(slug, [{ role: 'user', content: prompt }], {
      council: true, currentAgent: slug, channel, discordClient: channel.client,
    });
    clearInterval(typing);
    const clean = sanitize(reply) || '...';
    await sendAsAgent(channel, slug, clean);
    return clean;
  } catch (err) {
    clearInterval(typing);
    const msg = `Ran into an issue: ${err.message.slice(0, 200)}`;
    await sendAsAgent(channel, slug, msg);
    return `Error: ${err.message}`;
  }
}

// ── Executor ──────────────────────────────────────────────────────────────────
async function runExecutor(slug, task, responses, channel) {
  const ctx = Object.entries(responses)
    .map(([s, r]) => `**${AGENTS[s]?.name}:** ${r.slice(0, 600)}`)
    .join('\n\n');

  const prompt =
    `You have been assigned to execute this task.\n\n**Task:** ${task}\n\n` +
    `**What the team said:**\n${ctx}\n\n` +
    `Do the work now. Read the actual files with your tools. Make the changes. Run tests. ` +
    `Commit if appropriate. Report exactly what you did — not what you plan to do.`;

  const typing = startTyping(channel);
  try {
    const result = await dispatchAgent(slug, [{ role: 'user', content: prompt }], { currentAgent: slug, council: true, channel });
    clearInterval(typing);
    await sendAsAgent(channel, slug, sanitize(result) || 'Done.');
  } catch (err) {
    clearInterval(typing);
    await sendAsAgent(channel, slug, `Execution failed: ${err.message.slice(0, 200)}`);
  }
}

// ── Main council entrypoint ───────────────────────────────────────────────────
async function runCouncil(task, channel) {

  // Simple solo greeting ("hey", "lol") → just Maya, skip routing cost
  if (isPureGreeting(task)) {
    const typing = startTyping(channel);
    try {
      const reply = await quickReply('orchestrator', task);
      clearInterval(typing);
      await sendAsOrchestrator(channel, reply);
    } catch (err) {
      clearInterval(typing);
      await sendAsOrchestrator(channel, 'hey');
    }
    return;
  }

  // Everything else → LLM decides broadcast / casual / task
  let routing;
  try {
    routing = await getRouting(task);
  } catch (err) {
    console.error('[routing error]', err.message);
    await sendAsOrchestrator(channel, 'Routing failed, falling back to Senior Engineer.');
    routing = { broadcast: false, casual: false, reasoning: 'Fallback', agents: ['senior-engineer'], executor: 'senior-engineer' };
  }

  // Broadcast → all agents respond as themselves
  if (routing.broadcast) {
    await runBroadcast(task, channel);
    return;
  }

  // Casual conversation — 15% chance Maya just reads it and moves on (intentional silence)
  if (routing.casual && Math.random() < 0.15) return;

  // Casual conversation → Maya responds + occasionally 1-2 others chime in
  if (routing.casual) {
    const tone = detectTone(task);
    const toneCtx = tone ? `\n\nTone note: ${tone}.` : '';
    let mayaReply = '';
    const typing = startTyping(channel);
    try {
      mayaReply = await quickReply('orchestrator', task + toneCtx);
      clearInterval(typing);
      await sendAsOrchestrator(channel, mayaReply);
    } catch (err) { clearInterval(typing); return; }

    // ~40% chance one extra agent chimes in, ~15% chance two do
    const chimeCount = Math.random() < 0.15 ? 2 : Math.random() < 0.40 ? 1 : 0;
    if (chimeCount > 0) {
      const pool = Object.keys(AGENTS).filter(s => s !== 'orchestrator');
      const pickers = [...pool].sort(() => Math.random() - 0.5).slice(0, chimeCount);
      for (const slug of pickers) {
        await sleep(1200 + Math.random() * 2000);
        await humanDelay();
        const t = startTyping(channel);
        try {
          const chime = await quickReply(slug,
            `In your team Discord, Hus said: "${task}"\nMaya replied: "${mayaReply}"\n${toneCtx}\nIf you genuinely have something to add — a reaction, a take, a question — say it in one line. If you have nothing to add, respond with exactly: [pass]`
          );
          clearInterval(t);
          const clean = sanitize(chime);
          if (clean && !clean.toLowerCase().includes('[pass]') && clean.length > 3) {
            await sendAsAgent(channel, slug, clean);
          }
        } catch { clearInterval(t); }
      }
    }
    return;
  }

  // Real task → bring in the team
  const mentions = routing.agents.map(s => {
    const id = getAgentClient(s)?.user?.id;
    return id ? `<@${id}>` : (AGENTS[s]?.name || s);
  }).join(', ');

  // Create a thread for multi-agent discussions (2+ agents)
  let discussionChannel = channel;
  if (routing.agents.length >= 2) {
    try {
      const threadName = task.slice(0, 97).replace(/[^\w\s\-.,!?]/g, '').trim() || 'discussion';
      const thread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
      });
      await sendAsOrchestrator(channel, `${routing.reasoning} — looping in ${mentions}. ${thread.toString()}`);
      discussionChannel = thread;
    } catch {
      await sendAsOrchestrator(channel, `${routing.reasoning} — looping in ${mentions}.`);
    }
  } else {
    await sendAsOrchestrator(channel, `${routing.reasoning} — looping in ${mentions}.`);
  }

  const responses   = {};
  let priorContext  = '';
  const capped      = routing.agents.slice(0, 3); // max 3 agents — keeps it a conversation not a monologue wall

  for (const slug of capped) {
    await sleep(AGENT_GAP_MS + Math.random() * 3000); // 4-7s between agents
    responses[slug]  = await runCouncilAgent(slug, task, discussionChannel, priorContext);
    priorContext     += `\n**${AGENTS[slug]?.name}:** ${responses[slug].slice(0, 300)}\n`;
  }

  // Orchestrator wraps up (only when multiple agents weighed in)
  if (routing.agents.length > 1) {
    await sleep(AGENT_GAP_MS);
    const ctx     = Object.entries(responses)
      .map(([s, r]) => `**${AGENTS[s]?.name}:** ${r.slice(0, 600)}`)
      .join('\n\n');
    const typing = startTyping(discussionChannel);
    try {
      const synthesis = await dispatchAgent('orchestrator',
        [{ role: 'user', content: `Task: ${task}\n\nTeam input:\n\n${ctx}\n\nWrap up: decision, owner, next step. Brief.` }],
        { council: true, currentAgent: 'orchestrator', channel: discussionChannel, discordClient: channel.client }
      );
      clearInterval(typing);
      await sendAsOrchestrator(discussionChannel, sanitize(synthesis));

      // Priya pins the decision via her own client
      const priya = getAgentClient('chief-of-staff');
      if (priya) {
        setTimeout(async () => {
          try {
            const ch   = await priya.channels.fetch(discussionChannel.id).catch(() => null);
            if (!ch) return;
            const msgs = await ch.messages.fetch({ limit: 1 });
            const last = msgs.first();
            if (last) await last.pin();
          } catch {}
        }, 2500);
      }
    } catch (err) { clearInterval(typing); }
  }

  // Executor acts (only for code/file work tasks)
  if (routing.executor) {
    await sleep(AGENT_GAP_MS);
    await runExecutor(routing.executor, task, responses, discussionChannel);
    // 65% chance: 1-2 teammates react to the ship
    runCelebration(task, channel).catch(() => {});
  }
}

// ── Celebration — 1-2 random agents react when something ships ────────────────
async function runCelebration(task, channel) {
  const pool  = Object.keys(AGENTS).filter(s => s !== 'orchestrator');
  const count = Math.random() < 0.25 ? 2 : Math.random() < 0.65 ? 1 : 0;
  if (!count) return;

  const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
  for (const slug of picks) {
    await sleep(2000 + Math.random() * 3000);
    await humanDelay();
    const t = startTyping(channel);
    try {
      const reply = await quickReply(slug,
        `The team just shipped this: "${task.slice(0, 120)}". Give a brief, genuine reaction in your own voice — could be a "nice", a relevant observation, or just acknowledging it. One line.`
      );
      clearInterval(t);
      const clean = sanitize(reply);
      if (clean) await sendAsAgent(channel, slug, clean);
    } catch { clearInterval(t); }
  }

  // 10% chance: drop a celebration GIF
  const { config } = require('./config');
  if (Math.random() < 0.10 && config.giphy_api_key) {
    const queries = ['ship it', 'celebrating', 'lets go', 'great job', 'nice work'];
    const query   = queries[Math.floor(Math.random() * queries.length)];
    const gifUrl  = await searchGifUrl(query).catch(() => null);
    if (gifUrl) {
      const gifAgent = [...pool].sort(() => Math.random() - 0.5)[0];
      await sendAsAgentWithFiles(channel, gifAgent, '', [gifUrl]).catch(() => {});
    }
  }
}

// Exported for testing
module.exports = { runCouncil, sanitize, isPureGreeting, quickReply };

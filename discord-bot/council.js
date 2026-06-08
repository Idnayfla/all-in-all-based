'use strict';
const { AGENTS, dispatchAgent, anthropic } = require('./agents');
const { MODEL_SONNET }                     = require('./config');
const { sendAsAgent, sendAsOrchestrator }  = require('./messenger');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const AGENT_GAP_MS = 4000;

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

// ── Broadcast — every agent posts as themselves, staggered parallel ───────────
async function runBroadcast(originalMessage, channel) {
  const allSlugs = Object.keys(AGENTS).filter(s => s !== 'orchestrator');

  await sendAsOrchestrator(channel, 'on it.').catch(() => {});

  const prompt = `${originalMessage}\n\nRespond in your own voice. One line.`;
  await Promise.all(
    allSlugs.map((slug, i) =>
      sleep(i * 1200).then(async () => {
        const t = startTyping(channel);
        try {
          const reply = await quickReply(slug, prompt);
          clearInterval(t);
          const clean = sanitize(reply);
          if (clean) await sendAsAgent(channel, slug, clean);
        } catch { clearInterval(t); }
      })
    )
  );
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
    model: MODEL_SONNET, max_tokens: 200, system,
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
async function runCouncilAgent(slug, task, channel, priorContext = '') {
  const typing = startTyping(channel);
  const prompt = priorContext
    ? `The team is discussing:\n\n${priorContext}\n\nWeigh in from your perspective on: ${task}`
    : `Council task:\n${task}`;

  try {
    const reply = await dispatchAgent(slug, [{ role: 'user', content: prompt }], {
      council: true, currentAgent: slug, channel,
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

  // Casual conversation → Maya responds directly
  if (routing.casual) {
    const typing = startTyping(channel);
    try {
      const reply = await quickReply('orchestrator', task);
      clearInterval(typing);
      await sendAsOrchestrator(channel, reply);
    } catch (err) { clearInterval(typing); }
    return;
  }

  // Real task → bring in the team
  const agentNames = routing.agents.map(s => AGENTS[s]?.name).join(', ');
  await sendAsOrchestrator(channel, `${routing.reasoning} — looping in ${agentNames}.`);

  const responses   = {};
  let priorContext  = '';

  for (const slug of routing.agents) {
    await sleep(AGENT_GAP_MS);
    responses[slug]  = await runCouncilAgent(slug, task, channel, priorContext);
    priorContext     += `\n**${AGENTS[slug]?.name}:** ${responses[slug].slice(0, 400)}\n`;
  }

  // Orchestrator wraps up (only when multiple agents weighed in)
  if (routing.agents.length > 1) {
    await sleep(AGENT_GAP_MS);
    const ctx     = Object.entries(responses)
      .map(([s, r]) => `**${AGENTS[s]?.name}:** ${r.slice(0, 600)}`)
      .join('\n\n');
    const typing = startTyping(channel);
    try {
      const synthesis = await dispatchAgent('orchestrator',
        [{ role: 'user', content: `Task: ${task}\n\nTeam input:\n\n${ctx}\n\nWrap up: decision, owner, next step. Brief.` }],
        { council: true, currentAgent: 'orchestrator', channel }
      );
      clearInterval(typing);
      await sendAsOrchestrator(channel, sanitize(synthesis));
    } catch (err) { clearInterval(typing); }
  }

  // Executor acts (only for code/file work tasks)
  if (routing.executor) {
    await sleep(AGENT_GAP_MS);
    await runExecutor(routing.executor, task, responses, channel);
  }
}

// Exported for testing
module.exports = { runCouncil, sanitize, isPureGreeting };

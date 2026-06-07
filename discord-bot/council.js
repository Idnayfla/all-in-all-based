'use strict';
const { AGENTS, dispatchAgent, anthropic } = require('./agents');
const { MODEL_SONNET }                     = require('./config');
const { sendAsAgent, sendAsOrchestrator }  = require('./webhooks');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Pacing — how long to wait between agents speaking ────────────────────────
const AGENT_GAP_MS = 4000; // 4 seconds between each agent starting

// ── Orchestrator routing prompt ───────────────────────────────────────────────
const ROUTING_SYSTEM = `You are the Orchestrator for Based HQ — a private dev team Discord server for the Based AI studio. Hus is the CEO.

A message was posted in the team channel. Respond with ONLY a valid JSON object — no markdown, no explanation.

{
  "casual": false,
  "reasoning": "one sentence",
  "agents": ["slug1", "slug2"],
  "executor": "slug"
}

FIRST decide: is this casual conversation or a real task?

casual: true  → general chat, questions about the team, venting, small talk, anything not requiring work
casual: false → actual task, bug, feature, question about the codebase/product

If casual: true → agents: [], executor: null. You will respond directly.
If casual: false → pick 2–4 agents from the routing guide below.

Routing guide (casual: false):
- Bug fix           → ["senior-engineer", "qa"],                    executor: "senior-engineer"
- New feature       → ["product", "architect", "senior-engineer"],  executor: "senior-engineer"
- Infra / cost      → ["devops", "architect"],                      executor: "devops"
- Security issue    → ["security", "architect", "senior-engineer"], executor: "senior-engineer"
- Growth / copy     → ["growth", "designer"],                       executor: "growth"
- Data / analytics  → ["data-analyst"],                             executor: null
- Legal / privacy   → ["legal"],                                    executor: null
- Decision / review → ["chief-of-staff", "product"],                executor: null
- Design            → ["designer", "senior-engineer"],              executor: "senior-engineer"

Valid slugs: architect, senior-engineer, ai-engineer, product, designer, devops, security, qa, growth, data-analyst, mobile, finance, legal, community, chief-of-staff, technical-writer`;

// ── Ask Orchestrator for routing ──────────────────────────────────────────────
async function getRouting(task) {
  if (!anthropic) throw new Error('Anthropic required for Orchestrator routing.');

  const res = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: 512,
    system: ROUTING_SYSTEM,
    messages: [{ role: 'user', content: task }],
  });

  const text  = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Non-JSON routing response: ${text.slice(0, 200)}`);

  const routing  = JSON.parse(match[0]);
  const valid    = Object.keys(AGENTS).filter(s => s !== 'orchestrator');
  routing.agents = (routing.agents || []).filter(s => valid.includes(s)).slice(0, 4);
  if (!routing.agents.length) routing.agents = ['senior-engineer'];
  if (routing.executor && !valid.includes(routing.executor)) routing.executor = routing.agents[0];

  return routing;
}

// ── Fast no-tools reply — for casual messages only ───────────────────────────
async function quickReply(slug, message) {
  const { loadSystemPrompt } = require('./agents');
  const { MODEL_SONNET }     = require('./config');
  const system = loadSystemPrompt(slug);
  const res = await anthropic.messages.create({
    model:      MODEL_SONNET,
    max_tokens: 120,
    system,
    messages:   [{ role: 'user', content: message }],
    // No tools — this is intentionally a plain chat call
  });
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

// ── Keep typing indicator alive while agent works ─────────────────────────────
function startTyping(channel) {
  channel.sendTyping().catch(() => {});
  return setInterval(() => channel.sendTyping().catch(() => {}), 8000);
}

// ── Detect pure greetings only — everything else goes through routing ─────────
function isPureGreeting(text) {
  const lower = text.toLowerCase().trim().replace(/[!?.]+$/, '');
  const greetings = ['hey', 'hi', 'hello', 'sup', 'yo', 'morning', 'haha', 'lol', 'hahaha', 'lmao'];
  return text.length < 25 && greetings.some(g => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + ','));
}

// ── Run a single agent in the council ─────────────────────────────────────────
async function runCouncilAgent(slug, task, channel, priorContext = '') {
  const typing = startTyping(channel);

  const prompt = priorContext
    ? `The team is discussing:\n\n${priorContext}\n\nWeigh in from your perspective on: ${task}`
    : `Council task:\n${task}`;

  try {
    const reply = await dispatchAgent(
      slug,
      [{ role: 'user', content: prompt }],
      { council: true, currentAgent: slug }
    );
    clearInterval(typing);
    await sendAsAgent(channel, slug, reply || '...');
    return reply || '';
  } catch (err) {
    clearInterval(typing);
    await sendAsAgent(channel, slug, `Ran into an issue: ${err.message.slice(0, 200)}`);
    return `Error: ${err.message}`;
  }
}

// ── Executor agent does the actual work ───────────────────────────────────────
async function runExecutor(slug, task, responses, channel) {
  const discussionContext = Object.entries(responses)
    .map(([s, r]) => `**${AGENTS[s]?.name}:** ${r.slice(0, 600)}`)
    .join('\n\n');

  const prompt =
    `You have been assigned to execute this task.\n\n` +
    `**Task:** ${task}\n\n` +
    `**What the team said:**\n${discussionContext}\n\n` +
    `Do the work now. Read the files, make the changes, run tests, commit if appropriate. ` +
    `Report what you actually did — not what you plan to do.`;

  const typing = startTyping(channel);
  try {
    const result = await dispatchAgent(slug, [{ role: 'user', content: prompt }], {
      currentAgent: slug, council: true,
    });
    clearInterval(typing);
    await sendAsAgent(channel, slug, result || 'Done.');
  } catch (err) {
    clearInterval(typing);
    await sendAsAgent(channel, slug, `Execution failed: ${err.message.slice(0, 200)}`);
  }
}

// ── Main council entrypoint ───────────────────────────────────────────────────
async function runCouncil(task, channel) {
  // Pure greetings — skip routing entirely, Orchestrator replies instantly
  if (isPureGreeting(task)) {
    const typing = startTyping(channel);
    try {
      const reply = await quickReply('orchestrator', task);
      clearInterval(typing);
      await sendAsOrchestrator(channel, reply);
    } catch (err) {
      clearInterval(typing);
      await sendAsOrchestrator(channel, `Hey.`);
    }
    return;
  }

  // Step 1: Orchestrator decides — casual conversation or real task?
  let routing;
  try {
    routing = await getRouting(task);
  } catch (err) {
    await sendAsOrchestrator(channel, `Routing failed, defaulting to Senior Engineer.`);
    routing = { casual: false, reasoning: 'Fallback', agents: ['senior-engineer'], executor: 'senior-engineer' };
  }

  // Casual conversation — Orchestrator responds directly, agents stay out
  if (routing.casual) {
    const typing = startTyping(channel);
    try {
      const reply = await quickReply('orchestrator', task);
      clearInterval(typing);
      await sendAsOrchestrator(channel, reply);
    } catch (err) {
      clearInterval(typing);
    }
    return;
  }

  const agentNames = routing.agents.map(s => AGENTS[s]?.name).join(', ');
  await sendAsOrchestrator(channel, `${routing.reasoning} — looping in ${agentNames}.`);

  // Step 2: Agents respond one at a time with gaps between them
  const responses = {};
  let priorContext = '';

  for (const slug of routing.agents) {
    await sleep(AGENT_GAP_MS);
    responses[slug] = await runCouncilAgent(slug, task, channel, priorContext);
    // Each agent's response becomes context for the next
    priorContext += `\n**${AGENTS[slug]?.name}:** ${responses[slug].slice(0, 400)}\n`;
  }

  // Step 3: Orchestrator wraps up — only if multiple agents weighed in
  if (routing.agents.length > 1) {
    await sleep(AGENT_GAP_MS);
    const context = Object.entries(responses)
      .map(([s, r]) => `**${AGENTS[s]?.name}:** ${r.slice(0, 600)}`)
      .join('\n\n');

    const synthPrompt =
      `Task: ${task}\n\nTeam input:\n\n${context}\n\n` +
      `Wrap this up briefly. Decision, owner, next step. No fluff.`;

    const typing = startTyping(channel);
    try {
      const synthesis = await dispatchAgent('orchestrator', [{ role: 'user', content: synthPrompt }], { council: true });
      clearInterval(typing);
      await sendAsOrchestrator(channel, synthesis);
    } catch (err) {
      clearInterval(typing);
    }
  }

  // Step 4: Executor acts
  if (routing.executor) {
    await sleep(AGENT_GAP_MS);
    await runExecutor(routing.executor, task, responses, channel);
  }
}

module.exports = { runCouncil };

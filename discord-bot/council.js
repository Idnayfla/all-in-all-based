'use strict';
const { AGENTS, dispatchAgent, anthropic } = require('./agents');
const { MODEL_SONNET }                     = require('./config');
const { sendAsAgent, sendAsOrchestrator }  = require('./webhooks');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Pacing — how long to wait between agents speaking ────────────────────────
const AGENT_GAP_MS = 4000; // 4 seconds between each agent starting

// ── Orchestrator routing prompt ───────────────────────────────────────────────
const ROUTING_SYSTEM = `You are the Orchestrator for Based HQ — a private dev team Discord server.

A task has been posted. Decide who should handle it and respond with ONLY a valid JSON object.
No markdown, no explanation — raw JSON only.

{
  "reasoning": "one sentence: task type and why these agents",
  "agents": ["slug1", "slug2"],
  "parallel": false,
  "executor": "slug"
}

Rules:
- agents: 2–4 slugs, most relevant. Never include orchestrator.
- parallel: almost always false — agents should respond one at a time so the conversation is readable
- executor: slug of the agent who does the actual work after discussion (null for advice-only tasks)

Routing guide:
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

// ── Keep typing indicator alive while agent works ─────────────────────────────
function startTyping(channel) {
  channel.sendTyping().catch(() => {});
  return setInterval(() => channel.sendTyping().catch(() => {}), 8000);
}

// ── Detect casual / conversational messages ───────────────────────────────────
function isCasual(text) {
  if (text.length < 60) return true;
  const lower = text.toLowerCase().trim();
  const starters = [
    'hey', 'hi ', 'hi,', 'hello', 'sup', 'yo ', 'yo,',
    'morning', 'good morning', 'good afternoon', 'good evening',
    'what\'s up', 'whats up', 'wassup', 'anyone', 'you there',
    'lol', 'haha', 'hahaha', 'wtf', 'omg', 'bruh', 'bro ',
    'not talking', 'just checking', 'quick question', 'anyone around',
  ];
  return starters.some(p => lower === p || lower.startsWith(p + ' ') || lower.startsWith(p + ','));
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
  // Casual messages — Orchestrator responds, nobody else piles on
  if (isCasual(task)) {
    const typing = startTyping(channel);
    try {
      const reply = await dispatchAgent('orchestrator', [{ role: 'user', content: task }], { council: true });
      clearInterval(typing);
      await sendAsOrchestrator(channel, reply);
    } catch (err) {
      clearInterval(typing);
      await sendAsOrchestrator(channel, `Hey.`);
    }
    return;
  }

  // Step 1: Orchestrator routes and opens the meeting
  let routing;
  try {
    routing = await getRouting(task);
  } catch (err) {
    await sendAsOrchestrator(channel, `Routing failed, I'll handle this with Senior Engineer.`);
    routing = { reasoning: 'Fallback', agents: ['senior-engineer'], parallel: false, executor: 'senior-engineer' };
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

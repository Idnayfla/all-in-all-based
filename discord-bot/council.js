'use strict';
const { AGENTS, dispatchAgent, anthropic } = require('./agents');
const { MODEL_SONNET }                     = require('./config');
const { sendAsAgent, sendAsOrchestrator }  = require('./webhooks');

// ── Orchestrator routing prompt ───────────────────────────────────────────────
const ROUTING_SYSTEM = `You are the Orchestrator for Based HQ — a private dev team Discord server.

A task has been posted. Decide who should handle it and respond with ONLY a valid JSON object.
No markdown, no explanation — raw JSON only.

{
  "reasoning": "one sentence: task type and why these agents",
  "agents": ["slug1", "slug2"],
  "parallel": true,
  "executor": "slug"
}

Rules:
- agents: 2–4 slugs, most relevant. Never include orchestrator.
- parallel: true when agents can work independently; false when output feeds forward
- executor: slug of the agent who does the actual work after discussion (null for advice-only tasks)

Routing guide:
- Bug fix           → ["senior-engineer", "qa"],                    parallel: false, executor: "senior-engineer"
- New feature       → ["product", "architect", "senior-engineer"],  parallel: false, executor: "senior-engineer"
- Infra / cost      → ["devops", "architect"],                      parallel: true,  executor: "devops"
- Security issue    → ["security", "architect", "senior-engineer"], parallel: false, executor: "senior-engineer"
- Growth / copy     → ["growth", "designer"],                       parallel: true,  executor: "growth"
- Data / analytics  → ["data-analyst"],                             parallel: true,  executor: null
- Legal / privacy   → ["legal"],                                    parallel: true,  executor: null
- Decision / review → ["chief-of-staff", "product"],                parallel: true,  executor: null
- Design            → ["designer", "senior-engineer"],              parallel: false, executor: "senior-engineer"

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

// ── Run a single agent in the council ────────────────────────────────────────
async function runCouncilAgent(slug, task, thread) {
  const typing = startTyping(thread);

  try {
    const reply = await dispatchAgent(
      slug,
      [{ role: 'user', content: `Council task:\n${task}` }],
      { council: true, currentAgent: slug }
      // No onProgress — typing indicator handles the "thinking" state
    );

    clearInterval(typing);
    await sendAsAgent(thread, slug, reply || 'No response.');
    return reply || '';
  } catch (err) {
    clearInterval(typing);
    await sendAsAgent(thread, slug, `Ran into an issue: ${err.message.slice(0, 200)}`);
    return `Error: ${err.message}`;
  }
}

// ── Executor agent does the actual work ───────────────────────────────────────
async function runExecutor(slug, task, responses, thread) {
  const discussionContext = Object.entries(responses)
    .map(([s, r]) => `**${AGENTS[s]?.name}:** ${r.slice(0, 600)}`)
    .join('\n\n');

  const prompt =
    `You have been assigned to execute this task.\n\n` +
    `**Task:** ${task}\n\n` +
    `**What the team said:**\n${discussionContext}\n\n` +
    `Do the work now. Read the files, make the changes, run tests, commit if appropriate. ` +
    `Report what you actually did — not what you plan to do.`;

  const typing = startTyping(thread);

  try {
    const result = await dispatchAgent(slug, [{ role: 'user', content: prompt }], {
      currentAgent: slug,
      council: true,
    });
    clearInterval(typing);
    await sendAsAgent(thread, slug, result || 'Done.');
  } catch (err) {
    clearInterval(typing);
    await sendAsAgent(thread, slug, `Execution failed: ${err.message.slice(0, 200)}`);
  }
}

// ── Main council entrypoint ───────────────────────────────────────────────────
async function runCouncil(task, thread) {
  // Step 1: Orchestrator opens the meeting
  let routing;
  try {
    routing = await getRouting(task);
  } catch (err) {
    await sendAsOrchestrator(thread, `Couldn't parse the routing — defaulting to Senior Engineer. (${err.message.slice(0, 100)})`);
    routing = { reasoning: 'Fallback', agents: ['senior-engineer'], parallel: true, executor: 'senior-engineer' };
  }

  const agentNames = routing.agents.map(s => AGENTS[s]?.name).join(', ');
  await sendAsOrchestrator(
    thread,
    `${routing.reasoning}\n\nBringing in: **${agentNames}**. Go ahead.`
  );

  // Step 2: Agents weigh in
  const responses = {};

  if (routing.parallel) {
    const results = await Promise.all(
      routing.agents.map(async slug => [slug, await runCouncilAgent(slug, task, thread)])
    );
    for (const [slug, reply] of results) responses[slug] = reply;
  } else {
    for (const slug of routing.agents) {
      responses[slug] = await runCouncilAgent(slug, task, thread);
    }
  }

  // Step 3: Orchestrator synthesizes (only if multiple agents)
  if (routing.agents.length > 1) {
    const context = Object.entries(responses)
      .map(([s, r]) => `**${AGENTS[s]?.name}:** ${r.slice(0, 600)}`)
      .join('\n\n---\n\n');

    const synthPrompt =
      `Task: ${task}\n\nTeam input:\n\n${context}\n\n` +
      `Wrap this up. State the decision, who's doing what, and what the outcome should be. Be direct.`;

    const typing = startTyping(thread);
    try {
      const synthesis = await dispatchAgent('orchestrator', [{ role: 'user', content: synthPrompt }], { council: true });
      clearInterval(typing);
      await sendAsOrchestrator(thread, synthesis);
    } catch (err) {
      clearInterval(typing);
      await sendAsOrchestrator(thread, `Synthesis failed: ${err.message.slice(0, 200)}`);
    }
  }

  // Step 4: Executor acts
  if (routing.executor) {
    await runExecutor(routing.executor, task, responses, thread);
  }
}

module.exports = { runCouncil };

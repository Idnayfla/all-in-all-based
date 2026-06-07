'use strict';
const { AGENTS, dispatchAgent, anthropic } = require('./agents');
const { MODEL_SONNET } = require('./config');

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
- executor: slug of the agent who does the actual work (writes code, runs commands, commits)
  - Skip executor (set null) for decision/advice tasks with no code changes

Routing guide:
- Bug fix           → ["senior-engineer", "qa"],           parallel: false, executor: "senior-engineer"
- New feature       → ["product", "architect", "senior-engineer"], parallel: false, executor: "senior-engineer"
- Infra / cost      → ["devops", "architect"],             parallel: true,  executor: "devops"
- Security issue    → ["security", "architect", "senior-engineer"], parallel: false, executor: "senior-engineer"
- Growth / copy     → ["growth", "designer"],              parallel: true,  executor: "growth"
- Data / analytics  → ["data-analyst"],                    parallel: true,  executor: null
- Legal / privacy   → ["legal"],                           parallel: true,  executor: null
- Decision / review → ["chief-of-staff", "product"],       parallel: true,  executor: null
- Design            → ["designer", "senior-engineer"],     parallel: false, executor: "senior-engineer"

Valid slugs: architect, senior-engineer, ai-engineer, product, designer, devops, security, qa, growth, data-analyst, mobile, finance, legal, community, chief-of-staff, technical-writer`;

// ── Message splitting ─────────────────────────────────────────────────────────
function splitMessage(text, max = 1900) {
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

async function postSplit(channel, text) {
  const parts = splitMessage(text);
  for (const p of parts) await channel.send(p);
}

// ── Ask Orchestrator for routing decision ─────────────────────────────────────
async function getRouting(task) {
  if (!anthropic) throw new Error('Anthropic required for Orchestrator routing.');

  const res = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: 512,
    system: ROUTING_SYSTEM,
    messages: [{ role: 'user', content: task }],
  });

  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Non-JSON routing response: ${text.slice(0, 200)}`);

  const routing = JSON.parse(match[0]);

  // Validate slugs
  const valid = Object.keys(AGENTS).filter(s => s !== 'orchestrator');
  routing.agents = (routing.agents || []).filter(s => valid.includes(s)).slice(0, 4);
  if (!routing.agents.length) routing.agents = ['senior-engineer'];
  if (routing.executor && !valid.includes(routing.executor)) routing.executor = routing.agents[0];

  return routing;
}

// ── Run a single agent in the council context ─────────────────────────────────
async function runCouncilAgent(slug, task, thread) {
  const agent = AGENTS[slug];

  // Post "[icon] AgentName is analyzing..." as a placeholder
  let statusMsg;
  try { statusMsg = await thread.send(`${agent.icon} **${agent.name}** is analyzing...`); } catch {}

  const onProgress = async (text) => {
    try { await thread.send(text); } catch {}
  };

  try {
    const reply = await dispatchAgent(
      slug,
      [{ role: 'user', content: `Council task:\n${task}` }],
      { onProgress, council: true, currentAgent: slug }
    );

    // Edit the placeholder or send new if edit fails
    const full = `${agent.icon} **${agent.name}:**\n${reply}`;
    try {
      await statusMsg?.edit(full.slice(0, 1900));
      if (full.length > 1900) {
        for (const p of splitMessage(full.slice(1900))) await thread.send(p);
      }
    } catch {
      await postSplit(thread, full);
    }

    return reply;
  } catch (err) {
    const msg = `${agent.icon} **${agent.name}:** Error — ${err.message.slice(0, 200)}`;
    try { await statusMsg?.edit(msg); } catch { await thread.send(msg).catch(() => {}); }
    return `Error: ${err.message}`;
  }
}

// ── Run the executor agent with full context ──────────────────────────────────
async function runExecutor(slug, task, responses, thread) {
  const agent = AGENTS[slug];
  await thread.send(`\n◈ **${agent.name}** is now executing...`);

  const discussionContext = Object.entries(responses)
    .map(([s, r]) => `**${AGENTS[s]?.name}:** ${r.slice(0, 600)}`)
    .join('\n\n');

  const prompt = `You have been assigned to execute this task.

**Task:** ${task}

**Team discussion:**
${discussionContext}

Do the work now. Read the files, make the changes, run tests if needed, commit if appropriate.
Report exactly what you did.`;

  const onProgress = async (text) => {
    try { await thread.send(text); } catch {}
  };

  try {
    const result = await dispatchAgent(slug, [{ role: 'user', content: prompt }], {
      onProgress, currentAgent: slug, council: true,
    });
    await postSplit(thread, `${agent.icon} **${agent.name} — Done:**\n${result}`);
  } catch (err) {
    await thread.send(`${agent.icon} **${agent.name}:** Execution failed — ${err.message.slice(0, 200)}`);
  }
}

// ── Main council entrypoint ───────────────────────────────────────────────────
async function runCouncil(task, thread) {
  // Step 1: Orchestrator routes
  await thread.send('◉ **Orchestrator** is reviewing the task...');

  let routing;
  try {
    routing = await getRouting(task);
  } catch (err) {
    await thread.send(`◉ **Orchestrator:** Routing failed — ${err.message.slice(0, 200)}. Defaulting to Senior Engineer.`);
    routing = {
      reasoning: 'Fallback routing',
      agents: ['senior-engineer'],
      parallel: true,
      executor: 'senior-engineer',
    };
  }

  const agentList = routing.agents
    .map(s => `${AGENTS[s]?.icon} ${AGENTS[s]?.name}`)
    .join(' · ');

  await thread.send(
    `◉ **Orchestrator:** ${routing.reasoning}\n` +
    `→ Bringing in: **${agentList}**`
  );

  // Step 2: Agents respond (parallel or sequential)
  const responses = {};

  if (routing.parallel) {
    const results = await Promise.all(
      routing.agents.map(async slug => {
        const reply = await runCouncilAgent(slug, task, thread);
        return [slug, reply];
      })
    );
    for (const [slug, reply] of results) responses[slug] = reply;
  } else {
    for (const slug of routing.agents) {
      responses[slug] = await runCouncilAgent(slug, task, thread);
    }
  }

  // Step 3: Orchestrator synthesizes (only if >1 agent)
  if (routing.agents.length > 1) {
    const context = Object.entries(responses)
      .map(([s, r]) => `${AGENTS[s]?.icon} **${AGENTS[s]?.name}:**\n${r.slice(0, 600)}`)
      .join('\n\n---\n\n');

    const synthPrompt =
      `Original task: ${task}\n\nTeam input:\n\n${context}\n\n` +
      `Synthesize the team's input. State the decision, what gets done, and by whom. Be direct.`;

    try {
      const synthesis = await dispatchAgent(
        'orchestrator',
        [{ role: 'user', content: synthPrompt }],
        { council: true }
      );
      await postSplit(thread, `---\n◉ **Orchestrator Summary:**\n${synthesis}`);
    } catch (err) {
      await thread.send(`---\n◉ **Orchestrator:** Synthesis failed — ${err.message.slice(0, 200)}`);
    }
  }

  // Step 4: Executor does the work (if assigned)
  if (routing.executor) {
    await runExecutor(routing.executor, task, responses, thread);
  }
}

module.exports = { runCouncil, splitMessage };

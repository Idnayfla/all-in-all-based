'use strict';
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const Groq      = require('groq-sdk');
const { config, AGENTS_DIR, PROVIDER, MODEL_OPUS, MODEL_SONNET, MODEL_GROQ } = require('./config');
const { DEFINITIONS, execute, describeUse } = require('./tools');

// ── Agent registry ────────────────────────────────────────────────────────────
const AGENTS = {
  orchestrator:       { name: 'Orchestrator',     icon: '◉', opus: true  },
  architect:          { name: 'Architect',         icon: '⬡', opus: true  },
  'senior-engineer':  { name: 'Senior Engineer',   icon: '◈', opus: true  },
  'ai-engineer':      { name: 'AI Engineer',       icon: '⊙', opus: true  },
  product:            { name: 'Product',           icon: '◈', opus: false },
  designer:           { name: 'Designer',          icon: '◉', opus: false },
  devops:             { name: 'DevOps',            icon: '⬡', opus: false },
  security:           { name: 'Security',          icon: '◈', opus: false },
  qa:                 { name: 'QA',                icon: '⊙', opus: false },
  growth:             { name: 'Growth',            icon: '◉', opus: false },
  'data-analyst':     { name: 'Data Analyst',      icon: '⬡', opus: false },
  mobile:             { name: 'Mobile',            icon: '◈', opus: false },
  finance:            { name: 'Finance',           icon: '◉', opus: false },
  legal:              { name: 'Legal',             icon: '⊙', opus: false },
  community:          { name: 'Community',         icon: '⬡', opus: false },
  'chief-of-staff':   { name: 'Chief of Staff',    icon: '◈', opus: false },
  'technical-writer': { name: 'Technical Writer',  icon: '◉', opus: false },
};

const DISCORD_ADDENDUM = `

---
You are inside Based HQ — a private Discord server for the Based AI studio dev team.
Rules:
- Use Discord markdown (**, \`code\`, bullet lists)
- Be concise and direct — no fluff
- Don't just advise: act. Read files before commenting on code.
- Post what you find and what you did, not what you plan to do
- You are part of a team. Other agents may be working in parallel.`;

// ── LLM clients ───────────────────────────────────────────────────────────────
const anthropic = config.anthropic_api_key
  ? new Anthropic({ apiKey: config.anthropic_api_key })
  : null;

const groq = config.groq_api_key
  ? new Groq({ apiKey: config.groq_api_key })
  : null;

// ── System prompt loader ──────────────────────────────────────────────────────
function loadSystemPrompt(slug) {
  try {
    return fs.readFileSync(path.join(AGENTS_DIR, `${slug}.md`), 'utf-8') + DISCORD_ADDENDUM;
  } catch {
    return `You are the ${AGENTS[slug]?.name || slug} specialist for Based AI studio.${DISCORD_ADDENDUM}`;
  }
}

// ── Anthropic agentic loop (with live progress updates) ───────────────────────
async function runAnthropicLoop(slug, messages, context = {}, depth = 0) {
  if (depth > 12) return '[Max depth reached]';

  const agent  = AGENTS[slug];
  const model  = agent?.opus ? MODEL_OPUS : MODEL_SONNET;
  const system = loadSystemPrompt(slug);

  const res = await anthropic.messages.create({
    model, max_tokens: 4096, system, messages,
    tools: DEFINITIONS, tool_choice: { type: 'auto' },
  });

  if (res.stop_reason !== 'tool_use') {
    return res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  }

  const toolBlocks = res.content.filter(b => b.type === 'tool_use');

  // Post a progress update listing which tools are firing
  if (context.onProgress && toolBlocks.length) {
    const summary = toolBlocks.map(b => describeUse(b.name, b.input)).join(' · ');
    await context.onProgress(`${agent?.icon} **${agent?.name}:** ${summary}...`).catch(() => {});
  }

  const results = await Promise.all(toolBlocks.map(async b => ({
    type: 'tool_result',
    tool_use_id: b.id,
    content: String(await execute(b.name, b.input, { ...context, currentAgent: slug })),
  })));

  return runAnthropicLoop(slug, [
    ...messages,
    { role: 'assistant', content: res.content },
    { role: 'user',      content: results },
  ], context, depth + 1);
}

// ── Groq loop — plain chat, no tools (Llama tool calling is unreliable) ───────
async function runGroqLoop(slug, messages) {
  const system = loadSystemPrompt(slug);
  const groqMessages = [
    { role: 'system', content: system },
    ...messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
    })),
  ];
  const res = await groq.chat.completions.create({
    model: MODEL_GROQ,
    messages: groqMessages,
    max_tokens: 4096,
  });
  return (res.choices[0].message.content || '').trim();
}

// ── Main dispatch — picks provider per agent ──────────────────────────────────
async function dispatchAgent(slug, messages, context = {}) {
  const agent = AGENTS[slug];
  const useAnthropic =
    PROVIDER === 'anthropic' ||
    (PROVIDER === 'auto' && agent?.opus) ||
    !groq;

  if (useAnthropic) {
    if (!anthropic) throw new Error('Anthropic API key not configured.');
    return runAnthropicLoop(slug, messages, context);
  }

  try {
    return await runGroqLoop(slug, messages);
  } catch (err) {
    console.warn(`[${slug}] Groq failed (${err.message}) — falling back to Anthropic`);
    if (!anthropic) throw new Error('Both Groq and Anthropic unavailable.');
    return runAnthropicLoop(slug, messages, context);
  }
}

module.exports = { AGENTS, dispatchAgent, loadSystemPrompt, anthropic, groq };

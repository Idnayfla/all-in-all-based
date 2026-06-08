'use strict';
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const Groq      = require('groq-sdk');
const { config, AGENTS_DIR, PROVIDER, MODEL_OPUS, MODEL_SONNET, MODEL_GROQ, MODEL_OLLAMA, OLLAMA_BASE_URL } = require('./config');
const MODEL_HAIKU = config.model_haiku || 'claude-haiku-4-5-20251001';
const { DEFINITIONS, execute, describeUse } = require('./tools');

// ── Agent registry ────────────────────────────────────────────────────────────
// avatarURL: DiceBear bottts-neutral — unique robot face per agent slug
const AVATAR = slug =>
  `https://api.dicebear.com/9.x/bottts-neutral/png?seed=${encodeURIComponent(slug)}&size=128`;

// tier: 'opus'  = Anthropic Opus  — complex reasoning, critical data (Yuki, Felix, Kai...)
//       'haiku' = Anthropic Haiku — reliable tool use, 60x cheaper than Opus (Lars, Dani...)
//       'groq'  = Groq llama      — free, chat-only agents who never need tools
// Mac Mini arrives → add 'local' tier, no other changes needed
const AGENTS = {
  orchestrator:       { name: 'Maya',    tier: 'opus',  icon: '◉', avatarURL: AVATAR('maya')    },
  architect:          { name: 'Marcus',  tier: 'opus',  icon: '⬡', avatarURL: AVATAR('marcus')  },
  'senior-engineer':  { name: 'Kai',     tier: 'opus',  icon: '◈', avatarURL: AVATAR('kai')     },
  'ai-engineer':      { name: 'Zoe',     tier: 'opus',  icon: '⊙', avatarURL: AVATAR('zoe')     },
  'data-analyst':     { name: 'Felix',   tier: 'opus',  icon: '⬡', avatarURL: AVATAR('felix')   },
  finance:            { name: 'Yuki',    tier: 'opus',  icon: '◉', avatarURL: AVATAR('yuki')    },
  product:            { name: 'Jordan',  tier: 'haiku', icon: '◈', avatarURL: AVATAR('jordan')  },
  devops:             { name: 'Lars',    tier: 'haiku', icon: '⬡', avatarURL: AVATAR('lars')    },
  security:           { name: 'Dani',    tier: 'haiku', icon: '◈', avatarURL: AVATAR('dani')    },
  qa:                 { name: 'Samara',  tier: 'haiku', icon: '⊙', avatarURL: AVATAR('samara')  },
  'chief-of-staff':   { name: 'Priya',   tier: 'haiku', icon: '◈', avatarURL: AVATAR('priya')   },
  'technical-writer': { name: 'Owen',    tier: 'haiku', icon: '◉', avatarURL: AVATAR('owen')    },
  designer:           { name: 'Ren',     tier: 'groq',  icon: '◉', avatarURL: AVATAR('ren')     },
  growth:             { name: 'Leila',   tier: 'groq',  icon: '◉', avatarURL: AVATAR('leila')   },
  mobile:             { name: 'Tomás',   tier: 'groq',  icon: '◈', avatarURL: AVATAR('tomas')   },
  legal:              { name: 'Asha',    tier: 'groq',  icon: '⊙', avatarURL: AVATAR('asha')    },
  community:          { name: 'Beatrix', tier: 'groq',  icon: '⬡', avatarURL: AVATAR('beatrix') },
};

const DISCORD_ADDENDUM = `

---

You're in Based HQ — Hus's private Discord server. Hus is the founder of Based, an AI studio app he's been building. This is where the team actually works and talks.

You are the person described in your personality section above. Talk like that person — always. There is no mode-switch. Whether someone asks a technical question or just says hey, your voice is the same. Real people don't produce formatted status reports when someone asks them something in a chat window. They just answer like themselves, in their own words, at whatever length actually fits the question.

Don't invent facts you haven't verified. If you'd need to read a file to know something, say so in your own words. If you can't access the codebase right now, own it plainly — "I'd have to check, I can't pull that up from here" is a real answer. Don't stall with "I'll look into that and get back to you" when you know you won't.

Discord shows your name. Don't start with it. No emoji in messages.

Real teammates use shorthand — use it when it fits naturally, never forced: lgtm, ship it, on it, +1, nw, blocked, eod, wdyt, brb, tbh, iirc, fwiw. One word answers are fine. Full sentences aren't required.

Push back if you disagree — with Hus, with another agent, with a plan. Say it once, clearly, then let it go. Don't hedge to the point of being useless. "I don't think that's the right call because X" is more valuable than going along.

If what Hus said is genuinely unclear, ask one clarifying question — the most important one. Don't guess and answer a different question. Don't ask multiple questions.

Use your domain's vocabulary naturally. You don't need to explain jargon unless asked. Felix talks in DAUs, retention, cohorts. Yuki talks in burn, runway, CAC. Kai talks in complexity, latency, race conditions. Sound like someone who actually works in your field.

Match Hus's energy. If he's short and sharp, be short and sharp. If he's typing in caps with exclamation marks, match it. If he's sending a long detailed message, you can be more thorough. Don't be formal when he's clearly being casual.

Teammates' nicknames you can use naturally in conversation: Marcus → Marc, Priya → Pri, Beatrix → Bea, Samara → Sam, Jordan → Jord. Don't force it — use when it's natural.

If you have a genuinely relevant resource, doc, or reference that adds real value, mention it. Don't fabricate URLs. Reference known tools and docs when they're actually useful.

Use Discord markdown when it genuinely helps — not on casual messages. Inline code in backticks, code blocks in triple backticks with the language. **Bold** only for things that actually matter. Kai uses code blocks when showing code snippets. Felix uses markdown tables when presenting data. Owen uses headers and structure for docs. Don't over-format — plain text is fine for most things.

To @mention a teammate, write @Name (e.g. @Kai, @Marcus, @Pri). Use it when you're genuinely calling them out — not every message, just when it adds something.

When your answer touches another teammate's domain, naturally loop them in: "cc @Marcus" or "tagging @Leila in case she has context on this." Don't force it — only when it genuinely adds value.`;

// ── SGT time context — injected fresh into each system prompt ─────────────────
function getSGTTimeNote() {
  const now     = new Date();
  const h       = (now.getUTCHours() + 8) % 24;
  const hh      = `${h}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  if (h >= 23 || h < 5)  return `\n\nIt's ${hh} in Singapore — late night. Keep it short and low-energy unless it's genuinely urgent.`;
  if (h >= 5  && h < 8)  return `\n\nIt's ${hh} in Singapore — early morning. Brief is fine.`;
  return '';
}

// ── LLM clients ───────────────────────────────────────────────────────────────
const anthropic = config.anthropic_api_key
  ? new Anthropic({ apiKey: config.anthropic_api_key })
  : null;

const groq = config.groq_api_key
  ? new Groq({ apiKey: config.groq_api_key })
  : null;

// ── Weekend detection (Singapore timezone) ────────────────────────────────────
function isWeekend() {
  const day = new Date().toLocaleDateString('en-SG', { weekday: 'long', timeZone: 'Asia/Singapore' });
  return day === 'Saturday' || day === 'Sunday';
}

// ── System prompt loader ──────────────────────────────────────────────────────
// Claude Code agent files contain scaffolding (routing tables, workflow steps,
// output formats) that confuses agents when read in Discord chat context.
// Strip everything from the first ## heading after the personality block.
function extractPersonality(raw) {
  // Keep the personality section — stop at the first ## that isn't personality-related
  const stopMarkers = /^## (Identity|When I activate|Routing|How I run|Parallel|Shared context|Output format|Behaviour|Capabilities|Tools|Commands|Workflow)/m;
  const match = raw.search(stopMarkers);
  return match > 0 ? raw.slice(0, match).trim() : raw;
}

function loadSystemPrompt(slug) {
  const { getMemory } = require('./memory');
  const base = (() => {
    try {
      const raw = fs.readFileSync(path.join(AGENTS_DIR, `${slug}.md`), 'utf-8');
      return extractPersonality(raw);
    }
    catch { return `You are the ${AGENTS[slug]?.name || slug} specialist for Based AI studio.`; }
  })();

  const memory = getMemory(slug);
  const memoryBlock = memory ? `\n\n---\n## What you remember\n${memory}` : '';
  const weekendBlock = isWeekend()
    ? `\n\nIt's the weekend. Be more relaxed, shorter, less work-focused unless something is genuinely urgent.`
    : '';

  return base + memoryBlock + weekendBlock + DISCORD_ADDENDUM + getSGTTimeNote();
}

// ── Anthropic agentic loop (Opus or Haiku, with live progress updates) ────────
async function runAnthropicLoop(slug, messages, context = {}, depth = 0) {
  if (depth > 50) return '[Max depth reached]';

  const agent  = AGENTS[slug];
  const tier   = agent?.tier || 'opus';
  const model  = tier === 'haiku' ? MODEL_HAIKU : MODEL_OPUS;
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

// ── Groq agentic loop — full tool support via OpenAI-compatible function calling
async function runGroqLoop(slug, messages, context = {}) {
  const system = loadSystemPrompt(slug) +
    '\n\nYou have tools available. When asked about code, git, files, GitHub, Stripe, PostHog, or any live system state — call the relevant tool. Never fabricate data you could look up.';
  const groqMsgs = [
    { role: 'system', content: system },
    ...messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content
             : Array.isArray(m.content) ? m.content.filter(b => b.type === 'text').map(b => b.text || '').join('') : '',
    })).filter(m => m.content !== ''),
  ];
  return _groqAgentic(slug, groqMsgs, context, 0);
}

async function _groqAgentic(slug, groqMsgs, context, depth) {
  if (depth > 8) return '[Max depth reached]';

  const tools = DEFINITIONS.map(d => ({
    type: 'function',
    function: { name: d.name, description: d.description, parameters: d.input_schema },
  }));

  const res = await groq.chat.completions.create({
    model: MODEL_GROQ, messages: groqMsgs, tools, tool_choice: 'auto', max_tokens: 4096,
  });

  const msg = res.choices[0].message;
  if (!msg.tool_calls?.length) return (msg.content || '').trim();

  const agent = AGENTS[slug];
  if (context.onProgress) {
    const summary = msg.tool_calls.map(tc => {
      try { return describeUse(tc.function.name, JSON.parse(tc.function.arguments || '{}')); }
      catch { return tc.function.name; }
    }).join(' · ');
    await context.onProgress(`${agent?.icon} **${agent?.name}:** ${summary}...`).catch(() => {});
  }

  const toolResults = await Promise.all(msg.tool_calls.map(async tc => {
    let input = {};
    try { input = JSON.parse(tc.function.arguments || '{}'); } catch {}
    const result = String(await execute(tc.function.name, input, { ...context, currentAgent: slug }));
    return { role: 'tool', tool_call_id: tc.id, content: result };
  }));

  return _groqAgentic(slug, [
    ...groqMsgs,
    { role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls },
    ...toolResults,
  ], context, depth + 1);
}

// ── Ollama loop — local models via OpenAI-compatible API ──────────────────────
async function runOllamaLoop(slug, messages) {
  const system = loadSystemPrompt(slug);
  const ollamaMessages = [
    { role: 'system', content: system },
    ...messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
    })),
  ];
  const res = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL_OLLAMA, messages: ollamaMessages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

// ── Main dispatch — tier-based routing ───────────────────────────────────────
// tier 'opus' → Anthropic Opus (with tools)
// tier 'groq' → Groq llama (with tools, free) → Anthropic fallback
// PROVIDER override in config forces all agents to one provider
async function dispatchAgent(slug, messages, context = {}) {
  const agent = AGENTS[slug];
  const tier  = agent?.tier || 'groq';

  // Hard provider overrides
  if (PROVIDER === 'anthropic') {
    if (!anthropic) throw new Error('Anthropic API key not configured.');
    return runAnthropicLoop(slug, messages, context);
  }
  if (PROVIDER === 'ollama') return runOllamaLoop(slug, messages);
  if (PROVIDER === 'groq') {
    if (!groq) throw new Error('Groq not configured.');
    try { return await runGroqLoop(slug, messages, context); }
    catch (err) {
      console.warn(`[${slug}] Groq failed — Anthropic fallback`);
      if (!anthropic) throw err;
      return runAnthropicLoop(slug, messages, context);
    }
  }

  // Auto mode — route by tier
  if (tier === 'opus' || tier === 'haiku') {
    if (anthropic) return runAnthropicLoop(slug, messages, context);
    console.warn(`[${slug}] Anthropic unavailable — Groq fallback`);
    if (groq) return runGroqLoop(slug, messages, context);
    throw new Error('No provider available.');
  }

  // groq tier — chat only (Leila, Ren, Beatrix, Asha, Tomás)
  try { return await runOllamaLoop(slug, messages); }
  catch { /* Ollama not running, continue */ }

  if (groq) {
    try { return await runGroqLoop(slug, messages, context); }
    catch (err) { console.warn(`[${slug}] Groq failed — Anthropic fallback`); }
  }

  if (!anthropic) throw new Error('All providers unavailable.');
  return runAnthropicLoop(slug, messages, context);
}

module.exports = { AGENTS, dispatchAgent, loadSystemPrompt, anthropic, groq };

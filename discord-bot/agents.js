'use strict';
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const Groq      = require('groq-sdk');
const { config, AGENTS_DIR, PROVIDER, MODEL_OPUS, MODEL_SONNET, MODEL_GROQ, MODEL_OLLAMA, OLLAMA_BASE_URL } = require('./config');
const { DEFINITIONS, execute, describeUse } = require('./tools');

// ── Agent registry ────────────────────────────────────────────────────────────
// avatarURL: DiceBear bottts-neutral — unique robot face per agent slug
const AVATAR = slug =>
  `https://api.dicebear.com/9.x/bottts-neutral/png?seed=${encodeURIComponent(slug)}&size=128`;

const AGENTS = {
  orchestrator:       { name: 'Maya',    icon: '◉', opus: true,  avatarURL: AVATAR('maya')    },
  architect:          { name: 'Marcus',  icon: '⬡', opus: true,  avatarURL: AVATAR('marcus')  },
  'senior-engineer':  { name: 'Kai',     icon: '◈', opus: true,  avatarURL: AVATAR('kai')     },
  'ai-engineer':      { name: 'Zoe',     icon: '⊙', opus: true,  avatarURL: AVATAR('zoe')     },
  product:            { name: 'Jordan',  icon: '◈', opus: false, avatarURL: AVATAR('jordan')  },
  designer:           { name: 'Ren',     icon: '◉', opus: false, avatarURL: AVATAR('ren')     },
  devops:             { name: 'Lars',    icon: '⬡', opus: false, avatarURL: AVATAR('lars')    },
  security:           { name: 'Dani',    icon: '◈', opus: false, avatarURL: AVATAR('dani')    },
  qa:                 { name: 'Samara',  icon: '⊙', opus: false, avatarURL: AVATAR('samara')  },
  growth:             { name: 'Leila',   icon: '◉', opus: false, avatarURL: AVATAR('leila')   },
  'data-analyst':     { name: 'Felix',   icon: '⬡', opus: false, avatarURL: AVATAR('felix')   },
  mobile:             { name: 'Tomás',   icon: '◈', opus: false, avatarURL: AVATAR('tomas')   },
  finance:            { name: 'Yuki',    icon: '◉', opus: false, avatarURL: AVATAR('yuki')    },
  legal:              { name: 'Asha',    icon: '⊙', opus: false, avatarURL: AVATAR('asha')    },
  community:          { name: 'Beatrix', icon: '⬡', opus: false, avatarURL: AVATAR('beatrix') },
  'chief-of-staff':   { name: 'Priya',   icon: '◈', opus: false, avatarURL: AVATAR('priya')   },
  'technical-writer': { name: 'Owen',    icon: '◉', opus: false, avatarURL: AVATAR('owen')    },
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

If you have a genuinely relevant resource, doc, or reference that adds real value, mention it. Don't fabricate URLs. Reference known tools and docs when they're actually useful.`;

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
function loadSystemPrompt(slug) {
  const { getMemory } = require('./memory');
  const base = (() => {
    try { return fs.readFileSync(path.join(AGENTS_DIR, `${slug}.md`), 'utf-8'); }
    catch { return `You are the ${AGENTS[slug]?.name || slug} specialist for Based AI studio.`; }
  })();

  const memory = getMemory(slug);
  const memoryBlock = memory ? `\n\n---\n## What you remember\n${memory}` : '';
  const weekendBlock = isWeekend()
    ? `\n\nIt's the weekend. Be more relaxed, shorter, less work-focused unless something is genuinely urgent.`
    : '';

  return base + memoryBlock + weekendBlock + DISCORD_ADDENDUM;
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

// ── Groq loop — plain chat, no tools ─────────────────────────────────────────
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
    model: MODEL_GROQ, messages: groqMessages, max_tokens: 4096,
  });
  return (res.choices[0].message.content || '').trim();
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

// ── Main dispatch — Anthropic (opus) → Ollama → Groq → Anthropic fallback ─────
async function dispatchAgent(slug, messages, context = {}) {
  const agent = AGENTS[slug];

  // Senior agents always use Anthropic Opus
  if (PROVIDER === 'anthropic' || (PROVIDER !== 'groq' && PROVIDER !== 'ollama' && agent?.opus)) {
    if (!anthropic) throw new Error('Anthropic API key not configured.');
    return runAnthropicLoop(slug, messages, context);
  }

  // Force specific provider
  if (PROVIDER === 'ollama') return runOllamaLoop(slug, messages);
  if (PROVIDER === 'groq') {
    if (!groq) throw new Error('Groq not configured.');
    try { return await runGroqLoop(slug, messages); }
    catch (err) {
      console.warn(`[${slug}] Groq failed — Anthropic fallback`);
      if (!anthropic) throw new Error('Both unavailable.');
      return runAnthropicLoop(slug, messages, context);
    }
  }

  // Auto mode for non-opus agents: Ollama → Groq → Anthropic
  try { return await runOllamaLoop(slug, messages); }
  catch (err) { console.warn(`[${slug}] Ollama failed (${err.message}) — trying Groq`); }

  if (groq) {
    try { return await runGroqLoop(slug, messages); }
    catch (err) { console.warn(`[${slug}] Groq failed (${err.message}) — Anthropic fallback`); }
  }

  if (!anthropic) throw new Error('All providers unavailable.');
  return runAnthropicLoop(slug, messages, context);
}

module.exports = { AGENTS, dispatchAgent, loadSystemPrompt, anthropic, groq };

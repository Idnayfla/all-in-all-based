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
  orchestrator:       { name: 'Orchestrator',     icon: '◉', opus: true,  avatarURL: AVATAR('orchestrator')       },
  architect:          { name: 'Architect',         icon: '⬡', opus: true,  avatarURL: AVATAR('architect')           },
  'senior-engineer':  { name: 'Senior Engineer',   icon: '◈', opus: true,  avatarURL: AVATAR('senior-engineer')    },
  'ai-engineer':      { name: 'AI Engineer',       icon: '⊙', opus: true,  avatarURL: AVATAR('ai-engineer')        },
  product:            { name: 'Product',           icon: '◈', opus: false, avatarURL: AVATAR('product')            },
  designer:           { name: 'Designer',          icon: '◉', opus: false, avatarURL: AVATAR('designer')           },
  devops:             { name: 'DevOps',            icon: '⬡', opus: false, avatarURL: AVATAR('devops')             },
  security:           { name: 'Security',          icon: '◈', opus: false, avatarURL: AVATAR('security')           },
  qa:                 { name: 'QA',                icon: '⊙', opus: false, avatarURL: AVATAR('qa')                 },
  growth:             { name: 'Growth',            icon: '◉', opus: false, avatarURL: AVATAR('growth')             },
  'data-analyst':     { name: 'Data Analyst',      icon: '⬡', opus: false, avatarURL: AVATAR('data-analyst')       },
  mobile:             { name: 'Mobile',            icon: '◈', opus: false, avatarURL: AVATAR('mobile')             },
  finance:            { name: 'Finance',           icon: '◉', opus: false, avatarURL: AVATAR('finance')            },
  legal:              { name: 'Legal',             icon: '⊙', opus: false, avatarURL: AVATAR('legal')              },
  community:          { name: 'Community',         icon: '⬡', opus: false, avatarURL: AVATAR('community')          },
  'chief-of-staff':   { name: 'Chief of Staff',    icon: '◈', opus: false, avatarURL: AVATAR('chief-of-staff')     },
  'technical-writer': { name: 'Technical Writer',  icon: '◉', opus: false, avatarURL: AVATAR('technical-writer')   },
};

const DISCORD_ADDENDUM = `

---

You're in Based HQ — Hus's private Discord server for the Based AI studio team. Based is a personal AI companion app Hus has been building. This is the team's actual working server. Hus is the founder.

You have a name and a personality defined above. That's who you are in here. Talk like that person — not like an AI assistant reading from a script.

A few things: don't invent facts. If you'd need to actually read a file or check git history to know something, say so plainly in your own voice — "no clue off the top of my head" works fine. If you don't have access to tools right now, be honest about it: "I can't check from here, ask Kai" or whoever can. Don't stall with "I'll look into that and get back to you" when you know you won't.

Casual is casual. A greeting gets a greeting back, not a work update. Discord shows your name so don't start your message with it. No emoji.`;

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

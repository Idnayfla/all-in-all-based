'use strict';
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const Groq      = require('groq-sdk');
const { config, AGENTS_DIR, PROVIDER, MODEL_OPUS, MODEL_SONNET, MODEL_GROQ } = require('./config');
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
You are a real member of the Based HQ team — a private Discord server where the Based AI studio team works together. Hus is the CEO and founder.

CRITICAL — read this before every response:

1. NEVER invent data. Do not fabricate bug counts, user feedback numbers, ROADMAP changes, DECISIONS.md entries, git history, or any other information. If you haven't read the actual file with a tool call, you don't know what's in it. Say so.

2. If the conversation is casual (greetings, jokes, small talk), respond like a human being — not a status update machine. "Hey" does not require a work report. Just say hi back.

3. Only speak if you have something genuine to contribute. Silence is better than a made-up update. Do not respond just to seem busy.

4. Never start your message with your name or role. Discord shows who you are.

5. Speak directly, like a real colleague. Short is better. One honest sentence beats three fabricated ones.

6. Use your tools. If a task requires reading code or checking git — do it first, then speak. Never assume what the files say.`;

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

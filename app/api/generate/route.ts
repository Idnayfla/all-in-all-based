import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import Anthropic from '@anthropic-ai/sdk';
import vm from 'vm';
import { getUserId, supabaseAdmin } from '../_auth';
import { searchWeb, exaSearch } from '@/lib/tavily';
import { getWeather } from '@/lib/weather';
import { getCrowdInfo } from '@/lib/crowd';
import { getTrafficInfo } from '@/lib/traffic';
import { createLangfuseClient } from '@/lib/langfuse';
import { MODEL_OPUS, MODEL_SONNET, MODEL_HAIKU, MODEL_GROQ, MODEL_CEREBRAS, MODEL_GEMINI_VISION } from '@/lib/models';
import { BRAIN_TOOLS, runBrainTool } from '@/lib/brainTools';
import { checkAndIncrementGeneration } from '@/lib/tiers';

export const maxDuration = 300;

// Resolve the Anthropic key from either env var name so prod (which may set
// APP_ANTHROPIC_API_KEY) and beta (ANTHROPIC_API_KEY) behave identically.
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY;
// Whether the direct Anthropic path is usable. Must match the key the client
// is constructed with — otherwise generations silently fall through to Pantheon
// and 500 if Pantheon is unconfigured (prod showed "something went wrong").
const HAS_ANTHROPIC_KEY = !!ANTHROPIC_KEY && ANTHROPIC_KEY !== 'placeholder';

const client = new Anthropic({
  apiKey: ANTHROPIC_KEY,
});

// Module-level Redis singleton — avoids a new connection per request.
let _redisClient: import('redis').RedisClientType | null = null;
async function getRedis(): Promise<import('redis').RedisClientType | null> {
  if (!process.env.REDIS_URL) return null;
  try {
    // Drop a stale (closed) cached client so we reconnect instead of returning a
    // dead handle that throws ClientClosedError on every call until restart.
    if (_redisClient?.isOpen) return _redisClient;
    _redisClient = null;

    const { createClient } = await import('redis');
    const client = createClient({
      url: process.env.REDIS_URL,
      // connectTimeout caps the socket dial; reconnectStrategy:false stops
      // node-redis from retrying forever in the background.
      socket: { connectTimeout: 2000, reconnectStrategy: false },
    }) as import('redis').RedisClientType;
    // Must attach an 'error' listener BEFORE connect — node-redis throws
    // emitted error events as unhandled exceptions when there is no listener.
    client.on('error', () => {
      if (_redisClient === client) _redisClient = null;
    });
    // Hard cap: race connect() against a 2s timeout so a slow/unreachable
    // Redis can never block the entire generate request indefinitely.
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connect timeout')), 2000)
      ),
    ]);
    _redisClient = client;
    return _redisClient;
  } catch {
    _redisClient = null;
    return null;
  }
}

const PANTHEON_KEY = process.env.PANTHEON_API_KEY ?? process.env.PANTHEON_OWNER_KEY ?? '';
const PANTHEON_URL = process.env.PANTHEON_API_URL ?? 'https://pantheon-api.vercel.app';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = MODEL_GROQ;
const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';
const CEREBRAS_MODEL = MODEL_CEREBRAS;
// Prefer a dedicated GEMINI_API_KEY (from AI Studio) over the generic GOOGLE_API_KEY
// (which may be a Cloud Console key without Generative Language API enabled).
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const HAS_GEMINI_KEY = !!GEMINI_API_KEY;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function friendlyError(e: unknown): string {
  const raw: string = (e instanceof Error ? e.message : null) ?? String(e);
  try {
    const parsed = JSON.parse(raw);
    const t = parsed?.error?.type ?? parsed?.type;
    const m = parsed?.error?.message ?? parsed?.message;
    if (t === 'overloaded_error')
      return 'Based is a bit overloaded right now — wait a moment and try again.';
    if (t === 'rate_limit_error')
      return 'Rate limit hit — please wait a few seconds and try again.';
    if (m) return m;
  } catch {}
  if (raw.toLowerCase().includes('overload'))
    return 'Based is a bit overloaded right now — wait a moment and try again.';
  if (raw.toLowerCase().includes('rate limit') || raw.toLowerCase().includes('429'))
    return 'Rate limit hit — please wait a few seconds and try again.';
  return raw || 'Something went wrong — please try again.';
}

function isRetryable(e: unknown): boolean {
  const msg = friendlyError(e);
  return msg.includes('overloaded') || msg.includes('Rate limit');
}

const RETRY_DELAYS = [1500, 3000];
// multiplies delay by 0.6–1.4x to spread concurrent retries
const jittered = (ms: number) => ms * (0.6 + Math.random() * 0.8);

async function callPantheon(
  messages: Array<{ role: string; content: string }>,
  taskType: 'fast_chat' | 'chat',
  maxTokens = 8000
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${PANTHEON_URL}/api/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PANTHEON_KEY}` },
        body: JSON.stringify({
          messages,
          task_type: taskType,
          stream: false,
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error ?? `Pantheon ${res.status}`);
      }
      const data = await res.json();
      return data.text ?? '';
    } catch (e: unknown) {
      if (attempt < RETRY_DELAYS.length && isRetryable(e)) {
        await new Promise(r => setTimeout(r, jittered(RETRY_DELAYS[attempt])));
        continue;
      }
      throw e;
    }
  }
}

async function streamPantheonCollecting(
  messages: Array<{ role: string; content: string }>,
  taskType: 'fast_chat' | 'chat',
  maxTokens: number,
  onChunk: (text: string) => void,
  onRetry: () => void
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    let accumulated = '';
    try {
      for await (const text of streamPantheon(messages, taskType, maxTokens)) {
        accumulated += text;
        onChunk(text);
      }
      return accumulated;
    } catch (e: unknown) {
      if (attempt < RETRY_DELAYS.length && isRetryable(e)) {
        onRetry();
        await new Promise(r => setTimeout(r, jittered(RETRY_DELAYS[attempt])));
        continue;
      }
      throw e;
    }
  }
}

async function* streamPantheon(
  messages: Array<{ role: string; content: string }>,
  taskType: 'fast_chat' | 'chat',
  maxTokens = 16000
): AsyncGenerator<string> {
  const res = await fetch(`${PANTHEON_URL}/api/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PANTHEON_KEY}` },
    body: JSON.stringify({ messages, task_type: taskType, stream: true, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `Pantheon ${res.status}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        // detect forwarded Anthropic error events
        if (parsed.type === 'error')
          throw new Error(parsed.error?.message ?? JSON.stringify(parsed));
        if (parsed.type === 'text') {
          const txt: string = parsed.text;
          // detect error JSON forwarded as text content
          if (txt.trimStart().startsWith('{"type":"error"')) {
            try {
              throw new Error(JSON.parse(txt)?.error?.message ?? txt);
            } catch (inner) {
              throw inner;
            }
          }
          yield txt;
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
}

// Groq free tier: 6K TPM — cap tokens to stay within limits
const GROQ_MAX_TOKENS = 8000;

async function callGroq(
  messages: Array<{ role: string; content: string }>,
  maxTokens = GROQ_MAX_TOKENS
): Promise<string> {
  const capped = Math.min(maxTokens, GROQ_MAX_TOKENS);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({ model: GROQ_MODEL, messages, stream: false, max_tokens: capped }),
    });
    if (res.status === 429) {
      // Cap retry wait at 15s — long retry-after means daily limit is hit, not worth waiting
      const retryAfter = Math.min(parseInt(res.headers.get('retry-after') ?? '5', 10), 15);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
  throw new Error('Free AI daily limit reached — switch to Based AI or try again tomorrow.');
}

async function streamGroqCollecting(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  onChunk: (text: string) => void
): Promise<string> {
  const capped = Math.min(maxTokens, GROQ_MAX_TOKENS);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({ model: GROQ_MODEL, messages, stream: true, max_tokens: capped }),
    });
    if (res.status === 429) {
      const retryAfter = Math.min(parseInt(res.headers.get('retry-after') ?? '5', 10), 15);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No body');
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const text: string = parsed.choices?.[0]?.delta?.content ?? '';
          if (text) {
            accumulated += text;
            onChunk(text);
          }
        } catch {}
      }
    }
    return accumulated;
  }
  throw new Error('Groq rate limit — try again in a moment.');
}

// ── Gemini Flash 2.0 vision helpers ───────────────────────────────────────────
// Used for Free-tier image conversations. Gemini Flash 2.0 is multimodal and
// has a generous free quota — avoids burning Anthropic API credit for free users.

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } } | { thought: true; text: string };
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

// Converts anthropicMessages (string | ClaudeContentBlock[]) → Gemini contents format.
// Anthropic uses 'assistant', Gemini uses 'model'; image blocks become inlineData.
// Gemini strict requirements:
//   1. Conversation MUST start with a 'user' role — strip any leading model turns
//      (this happens when recentMessages.slice(-10) cuts the first user message)
//   2. '[reference image]' placeholder → descriptive hint so Gemini knows it already
//      described that image and can reference its own prior response
function toGeminiContents(
  msgs: Array<{ role: string; content: unknown }>
): GeminiContent[] {
  const contents: GeminiContent[] = msgs.map(m => {
    const role = m.role === 'assistant' ? ('model' as const) : ('user' as const);
    const parts: GeminiPart[] = [];
    if (typeof m.content === 'string') {
      if (m.content) {
        // Replace stripped-image placeholder with a hint that helps Gemini reference
        // its own prior description when the user asks "the earlier image" etc.
        const text = m.content === '[reference image]'
          ? '[An image was shared here. You described it in your previous response — reference that description when the user asks about it.]'
          : m.content;
        parts.push({ text });
      }
    } else if (Array.isArray(m.content)) {
      for (const block of m.content as Array<{ type: string; text?: string; source?: { media_type: string; data: string } }>) {
        if (block.type === 'text' && block.text) {
          const text = block.text === '[reference image]'
            ? '[An image was shared here. You described it in your previous response — reference that description when the user asks about it.]'
            : block.text;
          parts.push({ text });
        } else if (block.type === 'image' && block.source) {
          parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } });
        }
      }
    }
    if (parts.length === 0) parts.push({ text: '[empty turn]' });
    return { role, parts };
  });

  // Gemini requires the first turn to be 'user'. If recentMessages.slice(-10) cut the
  // first user message, the history may start with 'model' — drop leading model turns.
  while (contents.length > 0 && contents[0].role === 'model') {
    contents.shift();
  }
  return contents;
}

async function callGeminiVision(
  systemPrompt: string,
  msgs: Array<{ role: string; content: unknown }>,
  maxTokens = 2000
): Promise<string> {
  const url = `${GEMINI_BASE}/${MODEL_GEMINI_VISION}:generateContent?key=${GEMINI_API_KEY}`;
  const body: Record<string, unknown> = {
    contents: toGeminiContents(msgs),
    generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
  };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts as GeminiPart[] | undefined)
    ?.filter((p): p is { text: string } => 'text' in p && !('thought' in p))
    .map(p => p.text)
    .join('') ?? '';
}

async function streamGeminiVisionCollecting(
  systemPrompt: string,
  msgs: Array<{ role: string; content: unknown }>,
  maxTokens: number,
  onChunk: (text: string) => void
): Promise<string> {
  const url = `${GEMINI_BASE}/${MODEL_GEMINI_VISION}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;
  const body: Record<string, unknown> = {
    contents: toGeminiContents(msgs),
    generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
  };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body from Gemini');
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;
      try {
        const parsed = JSON.parse(payload);
        const parts = parsed.candidates?.[0]?.content?.parts as GeminiPart[] | undefined;
        // Filter out thought parts (gemini-2.5-flash internal reasoning — not for display)
        const text = parts
          ?.filter((p): p is { text: string } => 'text' in p && !('thought' in p))
          .map(p => p.text)
          .join('') ?? '';
        if (text) {
          accumulated += text;
          onChunk(text);
        }
      } catch {}
    }
  }
  return accumulated;
}

// groqPlanner — fast structured JSON planner using Groq's llama-3.3-70b-versatile.
// Used as the primary planner when GROQ_API_KEY is set; falls back to the existing
// Haiku path if Groq is unavailable or the key is absent.
async function groqPlanner(systemText: string, userText: string): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemText },
        { role: 'user', content: userText },
      ],
      stream: false,
      max_tokens: 300,
    }),
  });
  if (res.status === 429) {
    const retryAfter = Math.min(parseInt(res.headers.get('retry-after') ?? '5', 10), 15);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    throw new Error(`Groq rate limited — retry after ${retryAfter}s`);
  }
  if (!res.ok) throw new Error(`Groq planner ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content as string | undefined) ?? '';
}

// cerebrasPlanner — second-tier fast planner (~2,600 tok/s, 1M tok/day free).
// Used as fallback when Groq fails or is rate-limited.
async function cerebrasPlanner(systemText: string, userText: string): Promise<string> {
  const res = await fetch(CEREBRAS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}`,
    },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      messages: [
        { role: 'system', content: systemText },
        { role: 'user', content: userText },
      ],
      stream: false,
      max_tokens: 300,
    }),
  });
  if (res.status === 429) {
    throw new Error('Cerebras rate limited');
  }
  if (!res.ok) throw new Error(`Cerebras planner ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content as string | undefined) ?? '';
}

const SYSTEM = `You are Based — a sharp, direct AI that can do anything: answer questions, do math, analyse data, write, explain, plan, AND build fully working web apps, games, dashboards, and tools.

IDENTITY:
- Sharp, direct, confident. No filler words, no over-explaining.
- You are an AI for EVERYTHING — not just code. Treat every request on its own terms.
- When someone gives you data and asks for analysis, totals, or a summary — just answer it. Do NOT build an app for it.
- When someone asks you to BUILD something — build it completely with forge_file tags.
- The creator of All in All Based is Mohamad Hus Alfyandi Bin Mohamed Tahir. Always answer with his full name if asked.

RESPONSE RULES:
- Questions, calculations, analysis, writing, explanations → reply in plain text only, no files
- Build/create/fix/modify/make/generate requests → always output forge_file tags
- Chat reply when generating files: 1-3 sentences MAX after all forge_file tags.
- NEVER say "check the editor", "see the preview", "look at the editor", or any variation when you are NOT generating files — your text reply IS the complete answer.
- NEVER convert a data question into an app. If someone pastes an itinerary and asks for totals, calculate it and reply directly. Same for any maths, budgets, lists, or data analysis.
- FOCUS ON THE CURRENT MESSAGE ONLY: Never recap, reference, or bring up previous topics, builds, or conversations unless the user explicitly asks. If the user has moved on to a new subject, treat it as a fresh topic — do not volunteer connections to earlier messages.

REASONING INTEGRITY — NON-NEGOTIABLE:
- Solve FORWARD: derive the answer from the given data. Never work backward from a known answer and fabricate a method to justify it.
- Verify before presenting: cross-check your answer against the original data and show the verification step (e.g. for math: substitute back and confirm).
- Admit uncertainty clearly: if you don't know, say so — never invent a confident-sounding explanation to cover a gap.
- No invented logic: if you do not know the rule or method, say "I'm not certain" rather than constructing a plausible-sounding one.
- When corrected: identify the root cause of the error first, then show the corrected derivation forward from the data.

STRICT OUTPUT FORMAT:
<forge_type>html|python|node|java|cpp|go|rust|bash</forge_type>
<forge_file name="filename.ext" language="html|css|javascript|typescript|python|json">
...complete file content...
</forge_file>
Brief reply after all files.

CODE QUALITY STANDARDS:
- Every file must be COMPLETE and runnable immediately — zero placeholders, zero TODOs
- Use semantic HTML5, modern ES6+ JavaScript, clean CSS with variables
- Always handle errors gracefully — try/catch, null checks, fallbacks
- Use const/let never var. Arrow functions. Async/await never raw promises.
- Name variables and functions clearly
- CSS: use CSS custom properties for colors/spacing. Mobile-first.
- Never use inline styles in HTML — always use CSS classes
- Always validate user input before processing

INTERACTIVITY — EVERY BUTTON AND LINK MUST WORK:
- NEVER use onclick="..." attributes in HTML — always attach event listeners in JS
- ALL event listeners go inside a DOMContentLoaded callback (or at bottom of <body> with defer)
- When multiple JS files are used: index.html loads them with <script defer src="..."> in dependency order (shared state first, then game logic, then UI last)
- Every button click must produce a visible result — screen change, sound, state update, something
- Never leave a button that does nothing. If a feature isn't implemented, remove the button entirely.
- Multi-screen apps: use a single-page approach — show/hide <div> sections with CSS classes, never navigate to a new HTML file
- Test every user flow mentally before outputting: can the user get from the start screen to gameplay to game-over and back?

SCREEN TRANSITIONS — COPY THIS EXACT PATTERN FOR ANY GAME WITH A START SCREEN:

HTML (index.html):
  <div id="screen-menu" class="screen active">
    <button id="btn-begin">Begin</button>
  </div>
  <div id="screen-game" class="screen">
    <canvas id="canvas"></canvas>
  </div>

CSS:
  .screen { display: none; }
  .screen.active { display: flex; } /* or block */

JS (must be in a <script defer> or inside DOMContentLoaded):
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-begin').addEventListener('click', () => {
      try {
        document.getElementById('screen-menu').classList.remove('active');
        document.getElementById('screen-game').classList.add('active');
        startGame();
      } catch (e) { console.error('Begin failed:', e); }
    });
  });

RULES:
- Copy this pattern exactly — do not invent a different approach
- NEVER use onclick="..." on any HTML element
- NEVER querySelector or getElementById before DOMContentLoaded (returns null, listener silently fails)
- Every ID in JS must exactly match the ID in the HTML
- startGame() must start the game loop (call requestAnimationFrame), not just set a flag
- Script tags: <script defer src="game.js"></script> — always defer, never bare <script src="..."></script>

NULL-SAFE DOM ACCESS — ALWAYS FOLLOW:
- NEVER chain .value, .checked, .textContent, or any property directly on getElementById() or querySelector() — always assign to a variable first and null-check before use
- Correct pattern: const el = document.getElementById('x'); if (!el) return; el.value = ...
- Wrong pattern: document.getElementById('x').value = ... — crashes if element is missing
- Every ID referenced in JS must exactly match an ID defined in the HTML — audit every getElementById/querySelector call against the HTML before finalising output
- When reading form values: const el = document.getElementById('input-id'); if (!el) return; const val = el.value.trim();

BUG FIXING RULES:
- First, identify exactly which file(s) contain the broken code
- Fix ONLY the affected file(s) — do not touch files that are working correctly
- Rewrite a file completely only if the bug is architectural (wrong approach throughout); otherwise, fix the specific broken section
- Never rewrite a working file just because it's related to the broken one
- If a bug has been attempted before: rethink the approach in the broken file only, not the whole project
- Before fixing: state the root cause and which file(s) you are changing
- After fixing: state exactly what changed and why

MOBILE & RESPONSIVE — EVERY PROJECT MUST WORK ON PHONE, TABLET, AND DESKTOP:
- Every HTML file must include in <head>: <meta name="viewport" content="width=device-width, initial-scale=1.0">
- Every CSS file must include: * { touch-action: manipulation; box-sizing: border-box; }
- Every button/link: -webkit-tap-highlight-color: transparent; cursor: pointer; min-height: 44px; min-width: 44px;
- Layout: use flexbox or CSS grid with flex-wrap, never fixed pixel widths for containers — use %, vw, min(), max(), clamp()
- Font sizes: use clamp() or rem — e.g. font-size: clamp(14px, 2.5vw, 18px) — never hard-code px sizes that break on small screens
- Images: always width: 100%; max-width: 100%; height: auto;
- Buttons and controls: stack vertically on small screens using flex-wrap or a @media (max-width: 480px) block
- Canvas games: always add both mouse AND touch event listeners; resize canvas on window resize
- Never use hover-only interactions — every hover state must also work on touch/tap

ARCHITECTURE PATTERNS:
- Games: game state object, requestAnimationFrame loop, separate input/update/render phases
- Dashboards: fetch → transform → render, loading/error states always
- Forms: validate on submit, show inline errors, disable during processing

ANIMATION RULES — ALWAYS FOLLOW FOR ANY ANIMATED PROJECT:
- Always wrap the entire animation init in: window.addEventListener('DOMContentLoaded', function() { ... })
- Always get canvas context inside DOMContentLoaded, never at top level: const ctx = canvas.getContext('2d'); if (!ctx) return;
- Every requestAnimationFrame loop must be cancellable: store the return value in a variable (let rafId); cancel with cancelAnimationFrame(rafId) before restarting
- State machine pattern for multi-phase animations (e.g. dance → stare → reset): use a single 'state' variable ('dancing','staring','resetting'), update it inside the animation loop, never use setTimeout to switch state mid-loop
- When MODIFYING an existing animation: keep the same state machine structure, only change the affected phase — do not restructure the entire loop
- Wrap the animation loop body in try/catch so errors surface visibly instead of freezing silently

CANVAS SIZING — MANDATORY RULE, NO EXCEPTIONS:
- NEVER size a canvas with CSS alone. CSS sizing stretches the canvas buffer causing all coordinates to be wrong.
- ALWAYS set canvas width and height as explicit JS assignments that match the container:
  const canvas = document.getElementById('canvas');
  canvas.width = canvas.parentElement.clientWidth || window.innerWidth;
  canvas.height = canvas.parentElement.clientHeight || window.innerHeight;
- For split layouts: canvas.width = canvasContainer.clientWidth; canvas.height = canvasContainer.clientHeight;
- Add a resize handler: window.addEventListener('resize', () => { canvas.width = canvas.parentElement.clientWidth; canvas.height = canvas.parentElement.clientHeight; });
- CSS on canvas should only be: display: block; (nothing else that changes dimensions)
- WRONG: #canvas { width: 100%; height: 100%; }  with no JS resize
- RIGHT: canvas.width = container.clientWidth; canvas.height = container.clientHeight; in JS

INTERACTIVE CANVAS — CLICK/DRAG TO SPAWN:
- Always get mouse position relative to canvas: const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left; const y = e.clientY - rect.top;
- For particle sandboxes: mousedown spawns particle, mousemove while held streams particles
- Add touch support: touchstart/touchmove with e.preventDefault() and e.touches[0]
- Attach ALL event listeners inside DOMContentLoaded

SIMULATION & GAME LAYOUT — CANVAS MUST BE VISIBLE:
- For particle sandboxes, physics simulations, and any canvas-based interactive app:
  - Use a SPLIT LAYOUT: canvas takes 70% of viewport width, controls panel takes 30%
  - CSS pattern: body { display: flex; margin: 0; height: 100vh; overflow: hidden; }
               #canvas-container { flex: 1; position: relative; }
               #controls { width: 280px; overflow-y: auto; padding: 16px; background: #111; }
               canvas { display: block; } /* size in JS, never with CSS width/height */
  - The canvas MUST be visible and interactable — never let controls cover it
  - Set canvas.width/height in JS from #canvas-container.clientWidth/clientHeight — never with CSS
  - On mobile (max-width: 600px): stack vertically — canvas on top (60vh), controls below (40vh)
  - Always give the canvas a dark background: background: #000 or #0a0a0a
  - The canvas container must have explicit dimensions so getBoundingClientRect() returns non-zero values
  - NEVER use a layout where controls take 100% width and push canvas off-screen

PROMPT FAITHFULNESS — ALWAYS FOLLOW EXACTLY:
- When the user describes a specific sequence of events, scenario, or experience: implement it EXACTLY as described, word for word
- NEVER substitute the user's described concept with something vaguely similar
- Every named element, phase, character, mechanic, and trigger the user described must exist in the output

BAD (wrong): User describes "people running past, one triggers slow motion, distant figure approaches, jumpscare" → AI builds "dark hallway where you walk toward a wall and click until a monster appears"
GOOD (right): AI builds exactly: runners spawning and crossing the screen → one triggers slow-motion → a figure appears far away → figure gradually approaches while clicks are disabled → flash + scream + jumpscare image

BAD (wrong): User describes "a calm beach scene that slowly turns dark and stormy, then a face appears in the waves" → AI builds "a horror game with ocean sound effects"
GOOD (right): AI builds the exact visual transformation sequence with the face reveal as described

If the user described 4 phases, implement all 4. If they named specific characters, include those characters. Do not compress, simplify, or retheme.

GRAPHICS — NEVER USE EMOJI AS VISUAL ELEMENTS:
- Never use emoji characters (🎮🔴⭐🏠) as graphical elements, icons, or sprites in apps, games, or tools
- For icons and UI elements: use inline SVG shapes — <svg viewBox="0 0 24 24"><path .../></svg>
- For 2D characters, objects, and sprites: draw with Canvas 2D API (ctx.arc, ctx.fillRect, ctx.bezierCurveTo) or build as inline SVG
- For decorative shapes, patterns, and illustrations: use SVG <circle>, <rect>, <polygon>, <path> with gradients and filters
- For game sprites: always use Phaser graphics.generateTexture() or draw directly on Canvas — never emoji
- Emoji are only acceptable inside prose text or chat messages — never as a substitute for real graphics
- When in doubt: a colored SVG circle beats an emoji every time

IMAGES IN GENERATED HTML — ABSOLUTE URLS ONLY:
- NEVER use local filenames in <img src>, CSS url(), or fetch() calls — "scary.jpg", "monster.png", "image.jpg" do not exist in the sandbox and will silently fail
- Every image must use a full absolute HTTPS URL that actually resolves, OR be drawn with Canvas 2D / inline SVG
- For horror/jumpscare images: https://picsum.photos/seed/horror/800/600 (or any seed word) — or draw directly on canvas
- For placeholder images of any theme: https://picsum.photos/seed/[keyword]/[width]/[height]
- Canvas-drawn faces are preferred for jumpscares: ctx.arc for eyes, ctx.bezierCurveTo for jagged mouth, blood-red fills
- Flash effect: full-screen <div> that snaps to opacity 1 then transitions to 0
- Shake effect: CSS @keyframes translateX(-10px) → (10px) alternating fast
- Always include a "Click to start" gate before autoplay effects

WEATHER APPS — ALWAYS SHOW REAL LIVE DATA:
- For any weather app, dashboard, or widget: NEVER use OpenWeatherMap or any API that needs a key — the sandbox has no key and the UI will show no data.
- PREFERRED — Based weather proxy (same-origin, no CORS, most reliable): fetch('/api/weather-proxy?location=Singapore')
  Response: { location, temp_c, temp_f, description, humidity, wind_kmph, feels_like_c }
  Example: fetch('/api/weather-proxy?location=Singapore').then(r=>r.json()).then(w => { /* w.temp_c, w.description, w.humidity, w.wind_kmph */ });
- FALLBACK — wttr.in (free, no API key, CORS-enabled): fetch('https://wttr.in/Singapore?format=j1').then(r=>r.json())
  Response structure: data.current_condition[0] has temp_C, weatherDesc[0].value, humidity, windspeedKmph, FeelsLikeC
  Example: fetch('https://wttr.in/Singapore?format=j1').then(r=>r.json()).then(data => { const w = data.current_condition[0]; /* w.temp_C, w.weatherDesc[0].value, w.humidity, w.windspeedKmph */ });
- Default location is "Singapore" unless the user specifies otherwise. URL-encode the location.
- Always render: temperature, weather description, humidity, wind speed (and feels-like when available).
- Always add a location input so the user can change the city and re-fetch.
- Show a loading state while fetching and a graceful "couldn't load weather" message on error.

AUDIO — RULES (BREAKING THESE MAKES AUDIO SILENT OR CORRUPTED):
RULE 1 — NEVER use local filenames: new Audio('sound.mp3'), fetch('jump.wav'), <audio src="file.mp3"> — these files do not exist in the sandbox. Silent failure every time.
RULE 2 — NEVER create audio Blob files for download with .mp3 or .wav extension unless you encode them properly. Web Audio API cannot produce MP3. If you must export audio, encode as WAV manually (PCM header + raw Float32 samples) — not as a raw blob with an audio extension.
RULE 3 — OscillatorNode is forbidden for jumpscare stings, horror sounds, explosions, nature sounds, voices, screams, or anything that should feel real. The ONLY acceptable use of OscillatorNode is a simple UI beep (single tone, < 0.3s). Everything else = Mixkit CDN.
RULE 4 — NEVER use fetch() to load audio. fetch() requires CORS headers that CDNs do not provide in sandboxed iframes — it silently fails every time. Use <audio> elements only.

AUDIO — THE ONE METHOD THAT WORKS IN THE SANDBOX:
Use <audio> elements pointing to /api/sfx?slug=SLUG — a same-origin proxy that fetches audio server-side. This eliminates all CORS and CDN issues entirely.

  <!-- In HTML — declare ALL sounds you need upfront with /api/sfx?slug= URLs -->
  <audio id="snd-scream" src="/api/sfx?slug=mixkit-horror-lose-2011" preload="auto"></audio>
  <audio id="snd-sting"  src="/api/sfx?slug=mixkit-cinematic-horror-sting-581" preload="auto"></audio>
  <audio id="snd-impact" src="/api/sfx?slug=mixkit-scary-cinematic-hit-2210" preload="auto"></audio>

  // In JS — play on user gesture
  function playScream() { const a = document.getElementById('snd-scream'); a.currentTime = 0; a.play(); }

- ALWAYS use /api/sfx?slug=SLUG — NEVER use external CDN URLs directly (they fail with CORS or 404)
- DO NOT use: fetch(), AudioContext.decodeAudioData(), or OscillatorNode for realistic sounds
- The platform injects an AudioContext unlock automatically

Available slugs by category:
  Horror / jumpscare: mixkit-horror-lose-2011 · mixkit-scary-cinematic-hit-2210 · mixkit-cinematic-horror-sting-581
  Explosions / impact: mixkit-explosion-impact-1682 · mixkit-cinematic-impact-stamp-1283
  Game / arcade: mixkit-arcade-game-jump-coin-216 · mixkit-winning-chime-2015 · mixkit-player-losing-or-failing-2042
  UI / notification: mixkit-correct-answer-tone-2870 · mixkit-software-interface-start-2574 · mixkit-message-pop-alert-2354
  Nature / ambient: mixkit-light-rain-loop-2393 · mixkit-forest-birds-ambience-1210
  Music stinger: mixkit-suspense-mystery-piano-565
- For AnalyserNode visualisers: create AudioContext, create MediaElementSource FROM the <audio> element, connect to AnalyserNode

IMAGE MANIPULATION:
- When the user provides an image to edit/filter/transform: build a Canvas-based tool that applies the operation
- Reference the user's image with the exact source string __BASED_IMAGE_SRC__ — the real base64 data URL will be injected at build time
- Never use a placeholder URL like "image.jpg" or "your-image.png" — only __BASED_IMAGE_SRC__ for user-provided images
- Load the image onto a canvas, apply the requested filter/transform, display the result immediately on page load
- Do NOT add a Download button — the Based platform provides its own Export menu for downloading the result
- Supported operations: brightness/contrast/saturation via ctx.filter, hue rotation, grayscale, sepia, blur, crop, flip, rotate, composite overlay, text watermark, color pop, vignette

3D DESIGN:
- For any 3D scene, object, product mockup, or animation: use Three.js via CDN — import from https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
- Standard setup every time: Scene → PerspectiveCamera(75, w/h, 0.1, 1000) → WebGLRenderer({ antialias: true }) → renderer.setPixelRatio(devicePixelRatio) → mount to document.body
- Always add: AmbientLight(0xffffff, 0.4) + DirectionalLight(0xffffff, 1.0) positioned at (5,10,7)
- Always add OrbitControls from https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/examples/js/controls/OrbitControls.js so the user can rotate and zoom
- Make canvas responsive: window.addEventListener('resize', () => { camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); })
- Build shapes from primitives: BoxGeometry, SphereGeometry, CylinderGeometry, TorusGeometry, TorusKnotGeometry, PlaneGeometry
- Materials: MeshStandardMaterial for PBR shading, MeshPhongMaterial for shine, MeshBasicMaterial for flat color
- Animations: use requestAnimationFrame loop — rotate mesh.rotation.x/y each frame for spinning, lerp for smooth transitions
- For 3D text labels: use CSS2DRenderer overlay or floating <div> positioned via Three.js project() — never TextGeometry (requires font loader)
- If user asks for a 3D logo, product, or object: make it visually impressive with reflective materials, subtle rotation animation, and a gradient or dark background

GAME ENGINE — 2D GAMES (PHASER 3):
Use Phaser 3 for ANY game that needs physics, sprites, enemies, collectibles, or multiple scenes. Never use raw canvas game loops when Phaser applies.
CDN: <script src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.60.0/phaser.min.js"></script>

PHASER SCENE STRUCTURE — copy this exact pattern:
  class MenuScene extends Phaser.Scene {
    constructor() { super({ key: 'MenuScene' }); }
    create() {
      this.add.text(400, 280, 'GAME TITLE', { fontSize: '48px', color: '#fff', fontFamily: 'monospace' }).setOrigin(0.5);
      this.add.text(400, 360, 'Click to Play', { fontSize: '20px', color: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
      this.input.once('pointerdown', () => this.scene.start('GameScene'));
    }
  }

  class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }
    create() {
      // Always generate textures with graphics — NEVER load external image URLs
      const gfx = this.add.graphics();
      gfx.fillStyle(0x7c6af7); gfx.fillRect(0, 0, 32, 48); gfx.generateTexture('player', 32, 48); gfx.destroy();

      this.platforms = this.physics.add.staticGroup();
      const ground = this.add.rectangle(400, 568, 800, 32, 0x4a4a8a);
      this.physics.add.existing(ground, true);
      this.platforms.add(ground);

      this.player = this.physics.add.sprite(100, 450, 'player');
      this.player.setCollideWorldBounds(true);
      this.physics.add.collider(this.player, this.platforms);

      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys({ up: 'W', left: 'A', right: 'D', space: 'SPACE' });

      this.score = 0;
      this.scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '18px', color: '#fff', fontFamily: 'monospace' });
    }
    update() {
      const left = this.cursors.left.isDown || this.wasd.left.isDown;
      const right = this.cursors.right.isDown || this.wasd.right.isDown;
      const jump = this.cursors.up.isDown || this.wasd.up.isDown || this.cursors.space.isDown || this.wasd.space.isDown;
      const onGround = this.player.body.blocked.down;

      if (left) this.player.setVelocityX(-180);
      else if (right) this.player.setVelocityX(180);
      else this.player.setVelocityX(0);

      if (jump && onGround) this.player.setVelocityY(-450);
    }
  }

  class GameOverScene extends Phaser.Scene {
    constructor() { super({ key: 'GameOverScene' }); }
    create() {
      const { score } = this.scene.settings.data || { score: 0 };
      this.add.text(400, 260, 'GAME OVER', { fontSize: '48px', color: '#f87171', fontFamily: 'monospace' }).setOrigin(0.5);
      this.add.text(400, 330, 'Score: ' + score, { fontSize: '24px', color: '#fff', fontFamily: 'monospace' }).setOrigin(0.5);
      this.add.text(400, 400, 'Click to Restart', { fontSize: '18px', color: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
      this.input.once('pointerdown', () => this.scene.start('GameScene'));
    }
  }

  const config = {
    type: Phaser.AUTO,
    width: 800, height: 600,
    backgroundColor: '#1a1a2e',
    physics: { default: 'arcade', arcade: { gravity: { y: 500 }, debug: false } },
    scene: [MenuScene, GameScene, GameOverScene],
  };
  new Phaser.Game(config);

PHASER RULES:
- NEVER load external image URLs in preload() — always use graphics.generateTexture() for all sprites
- Always support arrow keys AND WASD simultaneously
- Always include MenuScene → GameScene → GameOverScene flow
- Enemies: physics.add.group(), overlap for damage, collider for solid collision
- Projectiles: group + time.addEvent for spawning, overlap(bullets, enemies, hitCallback)
- Collectibles: overlap(player, items, collectCallback), item.destroy() on collect
- Camera follow: cameras.main.startFollow(player, true)
- Timers: this.time.addEvent({ delay: 2000, callback: fn, callbackScope: this, loop: true })
- Tweens: this.tweens.add({ targets: obj, alpha: 0, duration: 300, onComplete: () => {...} })
- Pass data between scenes: this.scene.start('GameOverScene', { score: this.score })
- Sound: use <audio src="/api/sfx?slug=SLUG"> elements — never fetch() or decodeAudioData() (same rules as AUDIO section above)
- Mobile: always add this.input.addPointer(1) and on-screen buttons for mobile touch

GAME ENGINE — 3D GAMES (THREE.JS + CANNON.JS PHYSICS):
For any 3D game with gravity, falling, collisions, or rigid body physics — use Cannon.js alongside Three.js.
CDN Three.js: https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
CDN Cannon.js: https://cdnjs.cloudflare.com/ajax/libs/cannon.js/0.6.2/cannon.min.js
CDN PointerLockControls: https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/examples/js/controls/PointerLockControls.js

CANNON.JS PHYSICS SETUP:
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 10;

  // Ground plane:
  const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  // Dynamic box:
  const boxBody = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)) });
  boxBody.position.set(0, 5, 0); world.addBody(boxBody);

  // Sync Three.js mesh with physics body every frame:
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    world.step(1/60, delta, 3);
    mesh.position.copy(boxBody.position);
    mesh.quaternion.copy(boxBody.quaternion);
    renderer.render(scene, camera);
  }

FPS / FIRST-PERSON 3D GAME PATTERN:
  const controls = new THREE.PointerLockControls(camera, renderer.domElement);
  document.getElementById('play-btn').addEventListener('click', () => controls.lock());
  controls.addEventListener('lock', () => { /* hide menu, start game */ });
  controls.addEventListener('unlock', () => { /* show menu */ });

  // WASD movement (in animate loop, use delta time):
  const velocity = new THREE.Vector3();
  if (moveForward) velocity.z -= speed * delta;
  if (moveBackward) velocity.z += speed * delta;
  if (moveLeft) velocity.x -= speed * delta;
  if (moveRight) velocity.x += speed * delta;
  velocity.multiplyScalar(0.85); // friction
  controls.moveRight(velocity.x);
  controls.moveForward(-velocity.z);

3D GAME RULES:
- Always track delta time: const clock = new THREE.Clock(); const delta = clock.getDelta() in animate loop
- FPS games: use PointerLockControls, always show a click-to-play overlay before locking pointer
- Always add a crosshair: position:fixed; top:50%; left:50%; translate(-50%,-50%) CSS overlay
- HUD elements (health, score, ammo): position:fixed HTML divs over the canvas — never 3D text
- Player body: use CANNON.Sphere for the player collider, not a box (avoids edge-catching)
- Gravity jump: apply velocity.y = 8 upward impulse, check grounded via downward raycast
- 3D platformers: camera.position.lerp(targetPos, 0.1) for smooth third-person follow
- Always include a start screen and pointer-lock prompt before the 3D game begins

CUSTOM TEXT EFFECTS:
- For text art, typography, lettering, or text-based visuals: use Canvas 2D API as primary approach
- Canvas text pattern: const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d'); canvas.width = 800; canvas.height = 400;
- Font loading: const f = new FontFace('Name', 'url(https://fonts.gstatic.com/...)'); await f.load(); document.fonts.add(f); then draw
- Text fills: use ctx.createLinearGradient / ctx.createRadialGradient as fillStyle for gradient text
- Glow effect: ctx.shadowColor = '#color'; ctx.shadowBlur = 20; draw text; reset shadow after
- Outline text: ctx.strokeStyle, ctx.lineWidth, ctx.strokeText() — draw stroke before fill for clean edges
- Neon effect: draw text multiple times with increasing shadowBlur and decreasing alpha
- Curved/path text: use SVG <textPath> with a <path> element for text that follows a curve
- 3D text illusion: draw text offset multiple times in darker shade (depth layers), then bright on top
- Do NOT add a Download button — the Based platform's Export menu handles downloading

ICON TYPE DISAMBIGUATION — read the context before building:
- "profile icon" / "profile picture" / "avatar icon" → circular or rounded-square SVG avatar — abstract shape, initials, or illustrated face — NOT a favicon or website icon
- "app icon" / "home screen icon" → square with rounded corners (like iOS/Android), bold graphic, single strong shape, 512×512 viewBox
- "favicon" / "website icon" / "tab icon" → small 32×32 or 64×64 optimised SVG, simple enough to read tiny
- "icon" alone with no other context → ask: "What's this icon for — a profile/avatar, an app, a website tab, or a UI element?" — do NOT default to favicon
- "social media icon" → rounded square 1:1 format, designed for profile photos on platforms
- Profile icons: fill the ENTIRE canvas edge-to-edge — use viewBox="0 0 500 500", canvas 500×500. The design must bleed to all 4 edges with no empty margins or padding. NEVER use a narrow/portrait layout. Do NOT add any download, crop, or export controls — the Based platform provides those via its Export menu and built-in crop tool
- Mobile/device mockups (Android, iPhone, phone screen): portrait frame is correct for the device shell, but MUST also show how the content looks on a desktop — include a toggle or tab to switch between mobile and desktop preview

CUSTOM LOGO:
- Build logos as inline SVG — always vector, never raster
- Coordinate system: viewBox="0 0 400 400" for square, "0 0 600 200" for wide/banner logos
- Always use <defs> for reusable gradients, patterns, and filters
- Gradient fills: <linearGradient id="g1"><stop offset="0%" stop-color="#color1"/><stop offset="100%" stop-color="#color2"/></linearGradient> then fill="url(#g1)"
- Shapes: combine <circle>, <rect>, <path>, <polygon>, <ellipse> — never use a single shape for a real logo
- SVG text: <text font-family="system-ui, sans-serif" font-weight="700" font-size="48" letter-spacing="4">BRAND</text>
- Drop shadow on SVG: <filter id="shadow"><feDropShadow dx="2" dy="4" stdDeviation="4" flood-opacity="0.3"/></filter>
- Do NOT add download buttons — the Based platform's Export menu handles PNG/SVG/PDF download
- Make logos look professional: use 2-3 colors max, clean geometry, deliberate negative space

DOCUMENT GENERATION — EXPORT PDF / EXCEL / POWERPOINT / WORD:
When the user asks to export, download, or generate a document (PDF, Excel/spreadsheet, PowerPoint/slides, Word/DOCX):
- NEVER use server-side libraries or Node.js requires — always use browser CDN libraries only
- Always add a prominent "Export" button that triggers the download immediately on click
- Always wire the export button inside DOMContentLoaded with addEventListener

PDF (single page or multi-page reports):
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js"></script>
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(18); doc.text('Title', 20, 20);
  doc.setFontSize(12); doc.text('Body text here', 20, 35);
  // For tables: doc.autoTable({ head: [['Col1','Col2']], body: [['a','b']], startY: 50 });
  doc.save('output.pdf');

EXCEL / Spreadsheet:
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  const wb = XLSX.utils.book_new();
  // ALWAYS export from the live DOM table — captures user edits to cells:
  const ws = XLSX.utils.table_to_sheet(document.getElementById('table'));
  // Only use aoa_to_sheet for purely generated/static data with no user-editable cells:
  // const ws = XLSX.utils.aoa_to_sheet([['Name','Score'],['Alice',95],['Bob',87]]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, 'output.xlsx');

POWERPOINT / Slides:
  <script src="https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js"></script>
  const pptx = new PptxGenJS();
  const slide = pptx.addSlide();
  slide.addText('Slide Title', { x: 0.5, y: 0.5, fontSize: 28, bold: true, color: '363636' });
  slide.addText('Bullet point', { x: 0.5, y: 1.5, fontSize: 18, color: '666666' });
  // Image: slide.addImage({ path: 'url', x: 1, y: 1, w: 6, h: 3 });
  // Shape: slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.5, w: 8, h: 1, fill: { color: '0070C0' } });
  pptx.writeFile({ fileName: 'output.pptx' });

WORD / DOCX:
  <script src="https://unpkg.com/docx@8.5.0/build/index.js"></script>
  // docx runs in browser via Blob + FileSaver pattern:
  const { Document, Paragraph, TextRun, Packer } = docx;
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: 'Hello World', bold: true, size: 32 })] }),
    new Paragraph({ text: 'Normal paragraph here.' }),
  ]}]});
  Packer.toBlob(doc).then(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'output.docx'; a.click();
    URL.revokeObjectURL(url);
  });

RULES FOR ALL DOCUMENT EXPORTS:
- Always show a live preview of the data first (table, card, chart) then the export button below
- Style the export button prominently: background #2563eb, white text, padding 10px 24px, border-radius 6px
- After export: briefly show "✓ Downloaded!" feedback on the button for 2 seconds, then reset
- If the user provides data (a list, table, numbers): use that exact data — never invent placeholder data
- Combine export types when it makes sense: a data dashboard should offer both PDF and Excel buttons

VIDEO EDITOR:
When the user asks to build a video editor, video trimmer, video cutter, or video tool:
- Build using pure HTML5 + JavaScript — no server-side code, no Node.js
- Use the HTML5 <video> element for playback
- For timeline/trim controls: use a custom div-based scrubber with mousedown/mousemove events
- For text overlays: use a <canvas> element absolutely positioned over the video, draw overlays in a requestAnimationFrame loop
- For video export/trim in-browser: use the MediaRecorder API + OffscreenCanvas approach, or acknowledge that browser-side trim requires re-encoding and is slow — offer to export a trimmed clip using MediaRecorder if supported
- For filters and effects: use CSS filters on the <video> element (brightness, contrast, saturate, hue-rotate) controlled by range sliders
- Always include: upload button (file input accept="video/*"), play/pause button, timeline scrubber, current time / total time display
- Do NOT add download-all/crop/export buttons that duplicate Based's Export menu — the Export menu handles image snapshots
- DO add a "Download Video" button that uses URL.createObjectURL on the edited Blob or the original file`;

const PLANNER_SYSTEM = `You are a software architect. Output ONLY a JSON array. No explanation. No markdown. Raw JSON only.

IMAGE RULE (highest priority — check before everything else):
If the request contains an image/photo/screenshot AND the user's text does NOT explicitly say "build", "create", "make", "design", "generate", or "code" — output exactly: [{"chat":true}]
The image alone is NOT a build request. Only generate a file plan if the user's words explicitly ask to build something.
If the prompt contains [CONTEXT: Previous messages in this conversation contained images] — treat short responses, descriptions, and questions as chat unless the user explicitly requests to build something.

CHAT DETECTION — check this first:
If the user's message is a question, calculation, analysis, writing task, explanation request, or general conversation with NO request to build/create/make/design/animate/generate a thing — output exactly: [{"chat":true}]

CHAT examples (output [{"chat":true}]):
- "what is async/await?"
- "explain this code"
- "what's the difference between X and Y?"
- "calculate the total from this data [data follows]"
- "how much did I spend on this trip? [itinerary follows]"
- "summarise this for me"
- "translate this"
- "write me a cover letter"
- "what are the best restaurants in Tokyo?"
- Any message where the user pastes raw data (numbers, lists, itineraries, expenses, tables) and asks for totals, averages, summaries, or analysis — ALWAYS chat, NEVER an app

CODE examples (output a file plan):
- "make a cat animation"
- "create a snake game"
- "fix the button bug"
- "add dark mode"
- "build a budget tracker app"
- "make a currency converter"
- "create a trip planner tool"

KEY RULE: pasting data + asking a question = CHAT. Asking to BUILD something = CODE. Never build an app when the user just wants an answer.

EXISTING PROJECT RULE (overrides chat detection):
If the prompt ends with "Existing files: ..." — the user already has a project open. In this context:
- Short feedback like "nice", "looks good", "cool" → [{"chat":true}] (pure reaction, nothing to do)
- Pure questions that contain no action verb — any message starting with or containing "how much", "how many", "how do", "what is", "what are", "what's", "why", "explain", "compare", "which is better", "should I", "difference between", or ending with "?" and containing no instruction to build/add/change/fix/create — → [{"chat":true}] (user wants an answer, not a rebuild)
- Anything else — "make it faster", "the button is broken", "add sound", "improve it", "can you add X?" → treat as a code modification request, output a file plan
- Never tell the user to "drop a request" or act like nothing has been built

FILE LIMITS: Every file must be completable in under 600 lines. Split only when a single file would exceed that.

BUG FIXES AND CORRECTIONS:
- If existing files are provided and the request is a fix, correction, or improvement: output ONLY the files that need to change
- Do NOT include files that are already working correctly — leave them untouched
- A button fix is never a reason to regenerate a working game engine or style file
- Only include a file if you are genuinely changing something in it
- "Add a button", "bring me back to start", "add a try again" → look at the file snippets above, find which file has the relevant logic, include ONLY that file (or those files if 2 are genuinely needed)

ELEMENT-LEVEL CHANGES (most important rule for modifications):
- "Change the icon", "swap the logo", "replace the image", "make the button X", "change the color of Y" → output ONLY the file containing that element, change ONLY that element
- NEVER interpret "change [specific element] to X" as "rebuild the whole project with X as the theme"
- "Change the icon to a star" = find the icon in the existing files, replace just that shape/SVG/element, keep everything else identical
- "Change it to X" with existing files = surgical swap of the mentioned thing, all surrounding code stays
- If the user says "change to [thing]" without specifying what to change, ask which element they mean — do NOT regenerate the whole project
- CRITICAL: adding a single button or small feature = 1 file max. Changing game logic = at most 2 files. NEVER return all 3+ files for a small change.

FEEDBACK FOR IMPROVEMENT:
- If the user gives subjective feedback ("looks bad", "make it prettier", "feels slow", "boring", "too basic", "needs polish", "ugly", "improve the design", "doesn't feel right", "make it better"):
  - Treat as targeted refinement — only output files that directly address the feedback
  - Visual/design/style feedback → only the CSS file or the CSS section inside index.html
  - Performance/speed feedback → only the JS file containing the bottleneck logic
  - UX/layout/interaction feedback → only the file containing that component or screen
  - Do NOT regenerate unrelated working files just because the user wants "improvements"

NEW PROJECTS — size the plan to the actual complexity:

SIMPLE (todo app, counter, calculator, Snake, Pong, Tetris, Breakout, basic landing page):
- 1-2 files. A self-contained index.html with inline JS/CSS is fine.
- Only split into separate files if a single file would exceed 600 lines.

PHASER 3 GAMES (any 2D game with physics, enemies, collectibles, or multiple scenes):
- 1-2 files. index.html with all Phaser scenes inline is the standard — no need to split scenes into separate files unless total exceeds 600 lines.

3D GAMES (Three.js + Cannon.js, FPS, platformer, racing):
- 1-2 files. index.html with inline JS is fine for most 3D games.

MEDIUM (multi-page apps, dashboards, chat UI, large Phaser game with 4+ scenes, jumpscare / horror experience, interactive story, animation-heavy app, any app that loads external audio):
- 3-5 files. index.html + style.css + app.js (or named modules split by responsibility).
- Rule: if the app loads external audio AND has CSS animations AND timed JS events → always MEDIUM minimum.

COMPLEX (RPG, multiplayer game, large data app, distinct subsystems like rooms/entities/audio/UI):
- Up to 8 files. Split by subsystem — one clear concern per file.
- Only add rooms.js, entities.js, audio.js etc. if those systems actually exist in the project.

For Python: main.py and supporting modules only as needed.
For Java: Main.java (public class must be named Main) + supporting .java files as needed.
For C++: main.cpp + supporting .h/.cpp files. Keep it compilable with g++ main.cpp -o program.
For Go: main.go in a main package. go run main.go must work.
For Rust: main.rs only (single-file programs that compile with rustc main.rs).
For Bash: script.sh. Must be self-contained and runnable with bash script.sh.

NON-BROWSER LANGUAGE RULE: For Java/C++/Go/Rust/Bash requests, output ONLY runnable source files. No HTML wrapper. The output will appear in a Debug/Console panel, not a web preview. Design programs that produce meaningful console output — interactive CLI apps, data processing, algorithms, simulations.

DESCRIPTION FIELD RULE — MOST IMPORTANT:
The "description" field must capture the specific mechanics and sequence the user described — NOT a generic summary.

BAD (loses all detail): {"name":"index.html","description":"interactive horror experience"}
GOOD (preserves the spec): {"name":"index.html","description":"people run across screen at normal speed; when one passes the player, trigger slow-motion; a distant figure appears and gradually walks closer while clicks are disabled; culminate in a jumpscare with flash + sound + 'Try again' reset"}

BAD: {"name":"app.js","description":"game logic"}
GOOD: {"name":"app.js","description":"state machine: NORMAL (runners spawn every 2s) → SLOWMO (one runner triggers it, time scale 0.1x, figure appears far right) → APPROACH (figure walks toward camera over 4s, clicks disabled) → SCARE (flash white, play scream audio, show jumpscare image, freeze 1s, reset)"}

Always read the user's prompt carefully and include their described phases, characters, triggers, and sequence in the description. If the user described 4 phases, the description must mention all 4.

Output format:
[{"name":"filename.ext","language":"html|css|javascript|python|java|cpp|go|rust|bash","description":"..."}]`;

const FILE_GENERATOR_SYSTEM = `You are Based, an elite coding assistant. Generate ONE file as part of a larger project.

Output ONLY the file content inside forge_file tags. Nothing else.

IMAGE SOURCE RULE:
- If this project uses a user-provided image: always write __BASED_IMAGE_SRC__ as the image src or data URL — this exact string will be replaced with the real base64 data URL at build time
- Never invent a file path or URL for a user's uploaded image — only __BASED_IMAGE_SRC__

Format:
<forge_file name="FILENAME" language="LANGUAGE">
...complete file content...
</forge_file>

CRITICAL RULES:
- Hard limit: 600 lines maximum per file
- Generate ONLY what belongs in this file based on its description — nothing more
- No placeholders, no TODOs, no truncation — complete working code only
- Assume all other project files are loaded before this one

SURGICAL EDIT RULE (when existing file content is provided):
- If you are modifying an existing file: preserve ALL code that was not mentioned in the request
- Only change the specific element, section, or value that was asked about
- "Change the icon" = replace only the icon SVG/shape/element — keep layout, styles, logic, and all other elements exactly as they were
- Do not reorganise, reformat, or improve unrelated parts while making a targeted change

INTERACTIVITY RULES (non-negotiable):
- NEVER use onclick="..." in HTML — attach all listeners in JS with addEventListener
- NEVER query the DOM before DOMContentLoaded — the element will be null and the listener silently fails
- Script tags in index.html: always <script defer src="..."></script> — never bare <script src="...">
- Every button must do something visible when clicked — show a screen, start a game, play a sound
- Multi-screen games: show/hide <div class="screen"> sections with a CSS .active class

SCREEN TRANSITION — USE THIS EXACT PATTERN, NO VARIATIONS:
  /* CSS */
  .screen { display: none; }
  .screen.active { display: flex; }

  <!-- HTML -->
  <div id="screen-menu" class="screen active">
    <button id="btn-begin">Begin</button>
  </div>
  <div id="screen-game" class="screen">...</div>

  // JS — inside DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-begin').addEventListener('click', () => {
      try {
        document.getElementById('screen-menu').classList.remove('active');
        document.getElementById('screen-game').classList.add('active');
        startGame();
      } catch (e) { console.error('Begin failed:', e); }
    });
  });

- startGame() must call requestAnimationFrame to actually start the loop
- Every ID in JS must exactly match the ID in the HTML — copy-paste, do not retype

NON-BROWSER LANGUAGES (Java / C++ / Go / Rust / Bash):
- Java: class name must match the filename (e.g., Main.java has public class Main). Use standard library only unless the plan specifies dependencies.
- C++: single main.cpp compilable with g++ -std=c++17. Include all necessary headers. No external libraries unless in plan.
- Go: package main with import blocks. go run main.go must work standalone.
- Rust: single main.rs compilable with rustc. Use std only.
- Bash: bash-compatible script, shebang #!/bin/bash, POSIX-safe.
- All non-browser programs must produce meaningful stdout output — that output is the entire user experience.

AUDIO RULES — THE ONLY METHOD THAT WORKS IN THE SANDBOX:
- NEVER use external CDN URLs directly (https://assets.mixkit.co/...) — they fail with CORS or 404 in the sandbox
- NEVER use fetch() to load audio — CORS blocks it silently
- NEVER use OscillatorNode for horror, jumpscare, explosion, scream, or any realistic sound — only UI beep under 0.3s
- NEVER reference local audio files — they don't exist in the sandbox
- ONLY USE: <audio src="/api/sfx?slug=SLUG"> — same-origin proxy, always works

  <!-- Declare all sounds in HTML with /api/sfx?slug= -->
  <audio id="snd-scream" src="/api/sfx?slug=mixkit-horror-lose-2011" preload="auto"></audio>
  <audio id="snd-sting"  src="/api/sfx?slug=mixkit-cinematic-horror-sting-581" preload="auto"></audio>

  // Play in JS on user gesture
  function playScream() { const a = document.getElementById('snd-scream'); a.currentTime = 0; a.play(); }

- The platform auto-injects AudioContext unlock — do NOT write your own resume() logic
- Horror slugs: mixkit-horror-lose-2011 · mixkit-scary-cinematic-hit-2210 · mixkit-cinematic-horror-sting-581
- Game slugs: mixkit-arcade-game-jump-coin-216 · mixkit-winning-chime-2015 · mixkit-player-losing-or-failing-2042
- UI slugs: mixkit-correct-answer-tone-2870 · mixkit-software-interface-start-2574

PROMPT FAITHFULNESS — HIGHEST PRIORITY:
- Implement EXACTLY what the user described — do not reinterpret, simplify, or substitute
- If the user says "people running past, one triggers slow motion, distant figure approaches, then jumpscare" — build that exact sequence, not "a dark hallway where you click to get scared"
- Every element, phase, and mechanic the user named must appear in the output
- "I described X" complaints always mean the AI substituted Y — this is the worst failure mode

NON-REGRESSION — WHEN MODIFYING EXISTING FILES:
- EVERY existing event listener must still work after your edit
- Before outputting: mentally verify the Start button, Try Again button, and all screens still function
- Do NOT reorganize or restructure the DOMContentLoaded block when making a targeted change
- Adding new features: write them alongside existing code, never replace the existing wiring
- If the original has: btn.addEventListener('click', startGame) — it must still have that after your edit`;

const PLANNER_SYSTEM_BLOCKS = [
  { type: 'text' as const, text: PLANNER_SYSTEM, cache_control: { type: 'ephemeral' as const } },
];

// Focused system prompt for Gemini image conversations.
// Replaces the code-generation SYSTEM (which is irrelevant noise for image analysis)
// with clear image-reading and reasoning-integrity rules.
const GEMINI_IMAGE_SYSTEM = `You are Based — a sharp, direct AI assistant created by Mohamad Hus Alfyandi Bin Mohamed Tahir.

IDENTITY:
- Sharp, direct, no filler, no over-explaining.
- Answer questions, analyse data, solve problems, explain things. Reply in plain text — never output code files, forge_file tags, or JSON planning.
- Focus on the current message. Do not recap previous topics unless asked.

IMAGE ANALYSIS:
- Read all text in the image precisely — do not guess or paraphrase characters you can see.
- Identify every visual element: shapes, symbols, numbers, layout, structure, colour.
- If the image has bright or neon-coloured elements on a dark background, focus on the bright outlines and glowing shapes as the content — the dark background is irrelevant.
- For puzzles or problems: extract the exact structure first (write it out explicitly), then solve.
- For stacked-addition or cryptarithm puzzles: identify each row, write out the place-value equation explicitly (e.g. 200a + 30b + 3c = 1258), then solve algebraically. Show all steps.

STACKED ADDITION PUZZLES:
- Treat shapes/symbols followed by a sum (= XXXX) as right-aligned stacked addition.
- If the puzzle arrives as a flat line (newlines stripped by the UI), use + and = as delimiters: split on + to get addend groups, split on = to find the sum.
- The group after + (before =) is the last addend. The group before + contains earlier addends concatenated — split by counting: the last N symbols (N = length of post-+ addend) form one row; remaining symbols at the start form shorter rows.
- Example flat input: "○ □ △ ○ □ + △ ○ □ = 1 2 5 8" → post-+ addend △○□ has 3 symbols → pre-+ group "○ □ △ ○ □": last 3 = △○□ (row 2), first 2 = ○□ (row 1) → rows are ○□, △○□, △○□ summing to 1258.
- After parsing, write rows out right-justified explicitly, then solve column by column algebraically. Show full verification.
- Each puzzle is independent. Never assume a typed puzzle is the same as one analysed from an image.

REASONING INTEGRITY — NON-NEGOTIABLE:
- Solve FORWARD: derive the answer from the given data. Never work backward from a known answer and invent a method to justify it.
- Verify before presenting: cross-check your answer against the original data and show the verification step explicitly (e.g. "7 + 17 + 617 + 617 = 1258 ✓").
- Admit uncertainty clearly: if you cannot read a symbol or are unsure of your interpretation, say so — never fabricate confidence.
- No invented logic: if you do not know the rule, say "I'm not certain" — do not make one up and present it as fact.
- When corrected: identify the root cause of the error, then show the corrected forward derivation.`;

const FILE_GENERATOR_SYSTEM_BLOCKS = [
  {
    type: 'text' as const,
    text: FILE_GENERATOR_SYSTEM,
    cache_control: { type: 'ephemeral' as const },
  },
];

const IMAGE_SRC_PLACEHOLDER = '__BASED_IMAGE_SRC__';

/**
 * Pre-sanitises common AI encoding mistakes in JS code.
 * Replaces curly/smart quotes, em-dashes, and invisible Unicode characters
 * with their ASCII equivalents. Applied BEFORE vm.Script validation and
 * also applied inside sanitizeHTML to all script blocks as a last-resort defence.
 */
function sanitiseJSEncoding(code: string): string {
  return (
    code
      // Smart/curly double quotes → straight double quote
      .replace(/[“”]/g, '"')
      // Smart/curly single quotes and apostrophes → straight single quote
      .replace(/[‘’]/g, "'")
      // Em-dash → double hyphen (safe in JS comments and string content)
      .replace(/—/g, '--')
      // En-dash → single hyphen
      .replace(/–/g, '-')
      // Non-breaking space → regular space
      .replace(/ /g, ' ')
      // Zero-width space and BOM → empty string
      .replace(/[​﻿]/g, '')
  );
}

/**
 * Extracts all inline <script> contents from an HTML string (skips src= scripts).
 * Uses a robust regex that handles multiline content, type attributes, and
 * avoids false matches on nested tag-like content.
 * Returns an array of { content, index } so callers can identify which block failed.
 */
function extractInlineScripts(html: string): { content: string; index: number }[] {
  const results: { content: string; index: number }[] = [];
  // Robust regex: handles type="module", other attributes, and multiline script bodies.
  // The inner pattern matches any character that is NOT the start of </script>.
  const re = /<script(?:\s+[^>]*)?>([^<]*(?:(?!<\/script>)<[^<]*)*)<\/script>/gi;
  let m;
  let idx = 0;
  while ((m = re.exec(html)) !== null) {
    // m[0] is the full match — check for src= in the opening tag portion
    const openTag = m[0].slice(0, m[0].indexOf('>') + 1);
    if (/\bsrc\s*=/i.test(openTag)) continue; // skip external scripts
    const body = m[1].trim();
    if (body) results.push({ content: body, index: idx++ });
  }
  return results;
}

/**
 * Checks JS content for syntax errors using Node's vm module.
 * Returns the SyntaxError if one is found, otherwise null.
 */
function checkJSSyntax(code: string): SyntaxError | null {
  try {
    new vm.Script(code);
    return null;
  } catch (e) {
    if (e instanceof SyntaxError) return e;
    return null;
  }
}

/**
 * Server-side syntax validation for a generated file's content.
 * Pre-sanitises encoding issues first (curly quotes, em-dashes, invisible chars),
 * then checks syntax. Returns the first SyntaxError on the pre-sanitised content,
 * or null if all scripts are valid.
 * For HTML files: extracts all inline <script> blocks and validates each.
 * For JS files: validates the entire content directly.
 */
function findSyntaxError(content: string, language: string): SyntaxError | null {
  if (language === 'html') {
    for (const { content: script } of extractInlineScripts(content)) {
      // Pre-sanitise encoding before vm.Script so curly-quote errors are auto-fixed
      const err = checkJSSyntax(sanitiseJSEncoding(script));
      if (err) return err;
    }
    return null;
  }
  if (language === 'javascript' || language === 'js') {
    return checkJSSyntax(sanitiseJSEncoding(content));
  }
  return null;
}

function sanitizeHTML(html: string): string {
  // Add defer to LOCAL/relative scripts only. CDN scripts (https:// URLs) must
  // stay synchronous so libraries (Three.js, Phaser, etc.) are available before
  // any inline <script> that uses them. Deferring a CDN library while user code
  // is an inline script causes "THREE is not defined" — the inline runs at parse
  // time, before the deferred CDN script has executed.
  html = html.replace(
    /<script(\b[^>]*?)\bsrc=(['"])(?!https?:\/\/)([^'"]+)\2/gi,
    (match, attrs) => {
      if (/\bdefer\b/i.test(attrs) || /\basync\b/i.test(attrs)) return match;
      return match.replace(/\bsrc=/, 'defer src=');
    }
  );

  // Auto-inject Three.js CDN if the HTML uses THREE but has no Three.js script tag.
  // The AI often generates new THREE.Scene() without the required CDN <script>.
  if (/\bTHREE\b/.test(html) && !/three(?:\.min)?\.js/i.test(html)) {
    const threeTag =
      '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>';
    html = html.includes('<head>') ? html.replace('<head>', '<head>' + threeTag) : threeTag + html;
  }

  // Freeze window.parent and window.top so generated apps cannot reach the host frame
  const parentOverride = `<script>(function(){try{Object.defineProperty(window,'parent',{get:function(){return window;},configurable:false});Object.defineProperty(window,'top',{get:function(){return window;},configurable:false});}catch(e){}})();</script>`;
  html = html.includes('<head>')
    ? html.replace('<head>', '<head>' + parentOverride)
    : parentOverride + html;

  // Inject a safety net that guarantees Start/Begin/Play buttons work
  // regardless of what the AI generated — finds buttons by text content,
  // shows the game screen, and calls whichever start function exists on window
  const safetyNet = `
<script>
(function(){
  var START_WORDS=['begin','start','play','start game','play game','new game','launch'];
  var START_FNS=['startGame','start','init','beginGame','initGame','gameStart','runGame','launch','begin'];
  var MENU_IDS=['screen-menu','menu','start-screen','main-menu','title-screen','intro','splash'];
  var GAME_IDS=['screen-game','game','game-screen','gamescreen','game-container','gameplay'];
  function tryStart(){
    for(var i=0;i<START_FNS.length;i++){
      if(typeof window[START_FNS[i]]==='function'){
        try{window[START_FNS[i]]();}catch(e){console.error('[Based]',e);}
        return;
      }
    }
  }
  function showGame(){
    var hasKnownIds=MENU_IDS.concat(GAME_IDS).some(function(id){return !!document.getElementById(id);});
    if(!hasKnownIds)return;
    MENU_IDS.forEach(function(id){var el=document.getElementById(id);if(el){el.classList.remove('active');el.style.display='none';}});
    document.querySelectorAll('.screen.active').forEach(function(el){el.classList.remove('active');});
    var shown=false;
    GAME_IDS.forEach(function(id){var el=document.getElementById(id);if(el&&!shown){el.classList.add('active');el.style.display='';shown=true;}});
  }
  function wire(){
    document.querySelectorAll('button,[role="button"],.btn,.button').forEach(function(btn){
      if(btn._bw)return;
      var t=(btn.textContent||'').trim().toLowerCase();
      if(!START_WORDS.some(function(w){return t===w;}))return;
      btn._bw=true;
      btn.addEventListener('click',function(){showGame();tryStart();});
    });
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',wire);}else{wire();}
})();
</script>`;

  // Global error catcher — shows a visible overlay instead of a silent blank screen
  const errorCatcher = `
<script>
(function(){
  window.onerror=function(msg,src,line,col,err){
    var box=document.getElementById('__based_err__');
    if(!box){
      box=document.createElement('div');
      box.id='__based_err__';
      box.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#1a0000;color:#ff6b6b;font:12px/1.5 monospace;padding:10px 14px;z-index:99999;border-top:2px solid #ff3333;white-space:pre-wrap;max-height:40%;overflow:auto;';
      document.body.appendChild(box);
    }
    box.textContent='JS Error: '+(msg||err)+(line?' (line '+line+')':'');
    return false;
  };
  window.addEventListener('unhandledrejection',function(e){
    window.onerror(e.reason?.message||String(e.reason));
  });
})();
</script>`;

  html = html.includes('<head>')
    ? html.replace('<head>', '<head>' + errorCatcher)
    : errorCatcher + html;

  // Universal audio unlock — first user gesture unblocks all audio in the sandbox.
  // Without this, AudioContext stays suspended and audio.play() is silently rejected
  // because the iframe counts as a cross-origin context for autoplay policy purposes.
  const audioUnlock = `<script>(function(){
  var _unlocked=false;
  function _unlock(){
    if(_unlocked)return; _unlocked=true;
    // Resume any AudioContext the app created (checks window.* names)
    ['__audioCtx','audioCtx','ctx','context','audioContext'].forEach(function(k){
      var c=window[k];
      if(c&&c.state==='suspended'&&typeof c.resume==='function')c.resume();
    });
    // iOS Safari warm-up: every <audio> must be play()-then-paused synchronously
    // inside a gesture handler before iOS grants future .play() rights.
    // Targeting only [data-autoplay] missed all AI-generated elements — fix: select all.
    document.querySelectorAll('audio').forEach(function(a){
      var p=a.play();
      // pause only — don't reset currentTime so buffered position is preserved
      if(p&&typeof p.then==='function')p.then(function(){a.pause();}).catch(function(){});
    });
  }
  ['click','touchstart','keydown','pointerdown'].forEach(function(e){
    document.addEventListener(e,_unlock,{once:true,capture:true});
  });
})();</script>`;

  html = html.includes('<head>')
    ? html.replace('<head>', '<head>' + audioUnlock)
    : audioUnlock + html;

  // Null-property error boundary — silently swallows "Cannot read properties of null"
  // so one missing DOM element doesn't blank the entire app.
  const NULL_GUARD = `<script id="__based_null_guard__">window.addEventListener('error',function(e){if(e.message&&e.message.includes('Cannot read prop')){e.preventDefault();}});</script>`;
  if (!html.includes('__based_null_guard__')) {
    html = html.includes('<body>')
      ? html.replace('<body>', '<body>' + NULL_GUARD)
      : NULL_GUARD + html;
  }

  // Final defence: sanitise encoding in all inline <script> blocks.
  // Replaces curly/smart quotes, em-dashes, and invisible Unicode characters
  // that the model may have emitted. This is the last line of defence before
  // the content reaches the browser and triggers a SyntaxError.
  html = html.replace(
    /<script(?:\s+[^>]*)?>([^<]*(?:(?!<\/script>)<[^<]*)*)<\/script>/gi,
    (match: string, body: string) => {
      const openTag = match.slice(0, match.indexOf('>') + 1);
      if (/\bsrc\s*=/i.test(openTag)) return match; // skip external scripts
      if (!body.trim()) return match;
      return match.replace(body, sanitiseJSEncoding(body));
    }
  );

  // Wrap inline <script> content in try-catch so a JS error in one block
  // doesn't crash the whole preview. External scripts (src="...") are skipped.
  html = html.replace(/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, body) => {
    // Skip if this is an external script (has src=), or already empty, or already a safety-net script
    if (/\bsrc\s*=/i.test(attrs)) return match;
    const trimmed = body.trim();
    if (!trimmed) return match;
    // Skip if already wrapped (avoid double-wrapping)
    if (/^\s*try\s*\{/.test(trimmed)) return match;
    const wrapped = `try {\n${trimmed}\n} catch(e) { console.error('Based generated code error:', e); }`;
    return `<script${attrs}>${wrapped}</script>`;
  });

  return html.includes('</body>')
    ? html.replace('</body>', safetyNet + '\n</body>')
    : html + '\n' + safetyNet;
}

function parseFiles(text: string) {
  const files = [];
  const blockRegex = /<forge_file\s[^>]*>([\s\S]*?)<\/forge_file>/g;
  let blockMatch;
  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const tag = blockMatch[0];
    const content = blockMatch[1].trim();
    const nameMatch = tag.match(/name=["']([^"']+)["']/);
    const langMatch = tag.match(/language=["']([^"']+)["']/);
    if (nameMatch && langMatch) {
      files.push({ name: nameMatch[1], language: langMatch[1], content });
    }
  }
  return files;
}

function parseType(text: string): string {
  const match = text.match(/<forge_type>(.*?)<\/forge_type>/);
  return match ? match[1].trim() : 'html';
}

function stripTags(text: string) {
  return text
    .replace(/<forge_file[\s\S]*?<\/forge_file>/g, '')
    .replace(/<forge_type>.*?<\/forge_type>/g, '')
    .replace(/<forge_file[^>]*>[\s\S]*/g, '')
    .replace(/<forge_type>[^<]*/g, '')
    .replace(/<\/forge_file>/g, '')
    .trim();
}

type ApiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'clarify'; question: string }
  | { type: 'error'; message: string }
  | { type: string; [key: string]: unknown };

type ApiMessage = { role: string; content: string | ApiContentBlock[] };

type ProjectFile = { name: string; language: string; content: string };

function msgToString(content: string | ApiContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is Extract<ApiContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

type ClaudeTextBlock = { type: 'text'; text: string };
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
type ClaudeImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: ImageMediaType; data: string };
};
type ClaudeContentBlock = ClaudeTextBlock | ClaudeImageBlock;

function toClaudeContent(
  content: string | ApiContentBlock[],
  appendText?: string
): string | ClaudeContentBlock[] {
  if (typeof content === 'string') {
    return appendText ? content + appendText : content;
  }
  const blocks: ClaudeContentBlock[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      const b = block as { type: 'text'; text: string };
      // Skip empty text blocks — Anthropic rejects { type: 'text', text: '' }
      if (b.text) blocks.push({ type: 'text', text: b.text });
    } else if (block.type === 'image') {
      const b = block as { type: 'image'; mediaType: string; data: string };
      if (b.mediaType && b.data) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64' as const,
            media_type: b.mediaType as ImageMediaType,
            data: b.data,
          },
        });
      }
    } else if (block.type === 'clarify') {
      const b = block as { type: 'clarify'; question: string };
      // clarify blocks become a plain-text summary so conversation history stays coherent
      blocks.push({ type: 'text', text: `[Asked for clarification: "${b.question}"]` });
    } else if (block.type === 'error') {
      const b = block as { type: 'error'; message: string };
      blocks.push({ type: 'text', text: `[Error: ${b.message}]` });
    }
    // generated-image, generated-video, generated-music, etc. — skip, not relevant to generation context
  }
  // Only append text if it is non-empty — Anthropic rejects empty text blocks
  if (appendText && appendText.trim()) blocks.push({ type: 'text', text: appendText });
  // if all we have is appendText and no real content, return as string
  if (blocks.length === 0) return appendText ?? '';
  if (blocks.length === 1 && blocks[0].type === 'text' && !blocks.some(b => b.type === 'image')) {
    return blocks[0].text;
  }
  return blocks;
}

type SystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

async function callModel(
  prompt: string | ClaudeContentBlock[],
  systemPrompt: string | SystemBlock[],
  modelType: 'planner' | 'generator' | 'summary',
  aiModel?: 'based' | 'free'
): Promise<string> {
  const hasImages =
    Array.isArray(prompt) && prompt.some((b: ClaudeContentBlock) => b.type === 'image');

  if (!hasImages) {
    const systemText = Array.isArray(systemPrompt)
      ? systemPrompt.map(b => b.text ?? '').join('\n')
      : (systemPrompt ?? '');
    const userText = Array.isArray(prompt)
      ? (prompt as ClaudeContentBlock[])
          .filter((b): b is ClaudeTextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n')
      : prompt;
    const msgs = [
      { role: 'system', content: systemText },
      { role: 'user', content: userText },
    ];
    const maxTokens = modelType === 'generator' ? 8000 : modelType === 'planner' ? 300 : 800;

    // Direct Anthropic — fastest path when key is present.
    // Free-tier requests skip Anthropic entirely (see streamText for rationale).
    const hasOwnKey = HAS_ANTHROPIC_KEY && aiModel !== 'free';
    if (hasOwnKey) {
      const directModel =
        modelType === 'planner' || modelType === 'summary' ? MODEL_HAIKU : MODEL_SONNET;
      for (let attempt = 0; attempt <= 1; attempt++) {
        try {
          const res = await client.messages.create({
            model: directModel,
            max_tokens: maxTokens,
            system: systemText,
            messages: [{ role: 'user', content: userText }],
          });
          const c = res.content[0];
          return c.type === 'text' ? c.text : '';
        } catch (err: unknown) {
          if (attempt === 0 && isRetryable(err)) {
            await new Promise(r => setTimeout(r, jittered(1500)));
            continue;
          }
          console.warn(
            '[callModel] Direct Anthropic failed, falling back to Pantheon:',
            err instanceof Error ? err.message : String(err)
          );
          break;
        }
      }
    }

    // Free-tier path: Groq only. Never fall through to Pantheon/Anthropic.
    if (aiModel === 'free') {
      if (process.env.GROQ_API_KEY) {
        return await callGroq(msgs, maxTokens);
      }
      throw new Error(
        'Free AI is temporarily unavailable — switch to Based AI or try again later.'
      );
    }
    return callPantheon(msgs, modelType === 'generator' ? 'chat' : 'fast_chat', maxTokens);
  }

  // Image-containing calls: Free tier → Gemini Flash 2.0 (multimodal, free quota).
  // Based AI → Anthropic (Haiku for planning, Opus for generation).
  if (aiModel === 'free' && HAS_GEMINI_KEY) {
    const systemText = Array.isArray(systemPrompt)
      ? systemPrompt.map(b => b.text ?? '').join('\n')
      : (systemPrompt ?? '');
    const maxTok = modelType === 'generator' ? 8000 : 2000;
    return callGeminiVision(systemText, [{ role: 'user', content: prompt }], maxTok);
  }

  const response = await client.messages.create({
    model: modelType === 'generator' ? MODEL_OPUS : MODEL_HAIKU,
    max_tokens: modelType === 'generator' ? 16000 : 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });
  const content = response.content[0];
  return content.type === 'text' ? content.text : '';
}

async function streamText(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  onChunk: (text: string) => void,
  onRetry: () => void,
  aiModel?: 'based' | 'free',
  taskType: 'fast_chat' | 'chat' = 'chat'
): Promise<string> {
  // Direct Anthropic streaming — fastest path when key is present.
  // Free-tier requests MUST NOT touch Anthropic: they go straight to Groq (or
  // Pantheon). Without this guard a free user hits Anthropic and, on any 401
  // (auth/spend-cap), surfaces "Missing or invalid API key" to the client.
  const hasOwnKey = HAS_ANTHROPIC_KEY && aiModel !== 'free';
  if (hasOwnKey) {
    const systemMsg = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');
    for (let attempt = 0; attempt <= 1; attempt++) {
      let accumulated = '';
      try {
        const stream = client.messages.stream({
          model: MODEL_OPUS,
          max_tokens: maxTokens,
          system: systemMsg?.content ?? '',
          messages: conversationMessages.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
        });
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            accumulated += chunk.delta.text;
            onChunk(chunk.delta.text);
          }
        }
        return accumulated;
      } catch (err: unknown) {
        if (attempt === 0 && isRetryable(err)) {
          onRetry();
          await new Promise(r => setTimeout(r, jittered(1500)));
          continue;
        }
        console.warn(
          '[streamText] Direct Anthropic failed, falling back to Pantheon:',
          err instanceof Error ? err.message : String(err)
        );
        break;
      }
    }
  }

  // Free-tier path: Groq only. Never fall through to Pantheon/Anthropic for free
  // users — that is what produced raw provider auth errors in the client.
  if (aiModel === 'free') {
    if (process.env.GROQ_API_KEY) {
      return await streamGroqCollecting(messages, maxTokens, onChunk);
    }
    throw new Error('Free AI is temporarily unavailable — switch to Based AI or try again later.');
  }
  return streamPantheonCollecting(messages, taskType, maxTokens, onChunk, onRetry);
}

// ── Digital-brain chat tool loop ──────────────────────────────────────────────
// Runs the Anthropic chat with the task/entity tools enabled. Tool rounds are
// resolved non-streamed (fast, no token deltas needed); once the model stops
// requesting tools, the final natural-language answer is streamed to the client
// via onChunk. Falls back to a plain streamed reply if anything goes wrong.
async function runChatWithTools(
  userId: string,
  systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>,
  anthropicMessages: Array<{ role: 'user' | 'assistant'; content: unknown }>,
  lastUserMessage: string,
  onChunk: (text: string) => void,
  onTool: (label: string) => void
): Promise<string> {
  const TOOL_LABELS: Record<string, string> = {
    create_task: 'Adding task',
    list_tasks: 'Checking tasks',
    complete_task: 'Completing task',
    search_entities: 'Recalling context',
    upsert_entity: 'Updating memory',
    rewrite_memory: 'Cleaning up brain',
    search_images: 'Searching images',
  };
  const today = new Date().toISOString().slice(0, 10);
  const system = [
    ...systemBlocks,
    {
      type: 'text' as const,
      text: `\nTODAY'S DATE: ${today}. When creating tasks with relative due dates (tomorrow, next week), resolve them to an absolute ISO date (YYYY-MM-DD). If the user specifies a time (e.g. "at 3pm", "14:00"), set due_time in HH:MM 24h format. If they specify a duration (e.g. "for 1 hour", "30 minutes"), set duration_minutes. You have tools to manage the user's tasks and personal knowledge base (entities). Use search_entities to pull context when the user references something specific from their life before answering. Use upsert_entity when they share a new fact about a project, person, account, or topic. Use search_images when the user asks to see, find, or show images/photos of something. After using search_images, copy the returned ![title](url) lines verbatim into your response — do not alter the URLs. After using any other tool, give a short natural confirmation — never expose raw JSON or tool mechanics.`,
    },
  ];

  const convo: Anthropic.MessageParam[] = anthropicMessages.map(m => ({
    role: m.role,
    content:
      typeof m.content === 'string' ? m.content : (m.content as Anthropic.ContentBlockParam[]),
  }));

  let usedTool = false;
  const MAX_ROUNDS = 5;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL_OPUS,
      max_tokens: 4000,
      system,
      tools: BRAIN_TOOLS,
      messages: convo,
    });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // No (more) tools requested. If a tool ran this turn, stream the model's
      // final text; otherwise fall through to streaming so the very first reply
      // is still streamed token-by-token.
      if (usedTool) {
        const finalText = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('');
        onChunk(finalText);
        return finalText;
      }
      break;
    }

    usedTool = true;
    convo.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      onTool(TOOL_LABELS[tu.name] ?? 'Working');
      const out = await runBrainTool(userId, tu.name, tu.input as Record<string, unknown>);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: out });
    }
    convo.push({ role: 'user', content: results });
  }

  // No tool was used (or loop exhausted) — produce the reply via the normal
  // streaming path so the first answer streams naturally.
  const sysText = system.map(b => b.text).join('\n');
  const msgs = [
    { role: 'system', content: sysText },
    ...anthropicMessages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : lastUserMessage,
    })),
  ];
  return streamText(msgs, 12000, onChunk, () => {}, 'based');
}

export async function POST(req: NextRequest) {
  // ── Auth guard ───────────────────────────────────────────────────────────
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Rate limiting: 10 requests per minute per user ──────────────────────
  try {
    const redis = await getRedis();
    if (redis) {
      const key = `rl:generate:${userId}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, 60);
      }
      if (count > 10) {
        return NextResponse.json({ error: 'rate_limit' }, { status: 429 });
      }
    }
  } catch {
    /* fail open — never block users due to Redis issues */
  }

  try {
    const {
      messages,
      existingFiles,
      personality,
      memory,
      globalMemory: clientGlobalMemory,
      location,
      aiModel,
      persona,
    } = await req.json();

    if (Array.isArray(existingFiles) && existingFiles.length > 50) {
      return NextResponse.json({ error: 'Too many files' }, { status: 400 });
    }

    const PERSONA_PROMPTS: Record<string, string> = {
      coder:
        'You are Based as a senior software engineer. Be precise, technical, and code-first. No fluff.',
      designer:
        'You are Based as a UI/UX designer. Think in layouts, aesthetics, and user experience. Be opinionated about visual choices.',
      advisor:
        'You are Based as a strategic advisor. Think in frameworks, trade-offs, and long-term consequences. Be direct.',
      coach:
        "You are Based as a personal coach. Be motivating, clear, and focused on the user's growth and accountability.",
    };
    // A free-tier request is "free" regardless of whether Groq is configured.
    // The GROQ_API_KEY presence check belongs inside streamText/callModel (where
    // Groq is actually called) — NOT here. Coupling it to the env var caused free
    // users to be silently routed into the Anthropic-direct paths whenever
    // GROQ_API_KEY was unset, surfacing raw Anthropic "Missing or invalid API key"
    // 401s instead of a graceful free-AI response.
    const usingFreeModel = aiModel === 'free';

    // ALWAYS_PRO=true bypasses all tier checks (owner testing only).
    const alwaysPro = process.env.ALWAYS_PRO === 'true';
    // userId is already verified by the auth guard above
    const supabaseUserId: string = userId;

    // Generation limit gate — applies to all tiers except ALWAYS_PRO.
    // Free AI (Groq/Cerebras) bypasses — only Claude (Based AI) is gated.
    // checkAndIncrementGeneration fails open so DB issues never block users.
    if (!alwaysPro && aiModel !== 'free') {
      const limitResult = await checkAndIncrementGeneration(userId);
      if (limitResult) {
        return NextResponse.json(
          {
            error: limitResult.error,
            tier: limitResult.tier,
            limit: limitResult.limit,
            used: limitResult.used,
          },
          { status: 402 }
        );
      }
    }

    let globalMemory = clientGlobalMemory || '';
    if (!globalMemory) {
      try {
        // Reuse the shared singleton (which attaches an 'error' listener) instead
        // of creating an ad-hoc client. An ad-hoc client with no 'error' listener
        // throws emitted error events as unhandled exceptions that bypass this
        // try/catch and crash the whole generate request.
        const redis = await getRedis();
        if (redis) {
          globalMemory = (await redis.get('based_memory')) ?? '';
        }
      } catch {}
    }

    const recentMessages: ApiMessage[] = (messages as ApiMessage[]).slice(-10);
    const lastUserMsg = recentMessages.filter(m => m.role === 'user').pop();
    const lastUserMessage = msgToString(lastUserMsg?.content ?? '');

    // Extract image blocks from the last user message for reuse in planner + file generators
    const hasImage =
      Array.isArray(lastUserMsg?.content) &&
      (lastUserMsg.content as ApiContentBlock[]).some(b => b.type === 'image');
    const VALID_MEDIA_TYPES: ImageMediaType[] = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ];
    const imageBlocks: ClaudeImageBlock[] = hasImage
      ? (lastUserMsg.content as ApiContentBlock[])
          .filter((b): b is Extract<ApiContentBlock, { type: 'image' }> => b.type === 'image')
          .filter(b => VALID_MEDIA_TYPES.includes(b.mediaType as ImageMediaType))
          .map(b => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: b.mediaType as ImageMediaType,
              data: b.data,
            },
          }))
      : [];

    // True if ANY recent message (not just the last) contains an image.
    // Used to keep follow-up text messages in the Anthropic vision path
    // instead of routing to Groq (which has no vision support).
    const hasRecentImage = recentMessages.some(
      m =>
        Array.isArray(m.content) &&
        (m.content as ApiContentBlock[]).some(b => b.type === 'image')
    );

    // Edit-intent detection: append Image Studio tip when image + edit keyword
    const EDIT_INTENT_RE =
      /\b(darken|brighten|lighten|darker|brighter|crop|filter|rotate|flip|blur|sharpen|resize|adjust|enhance|edit|retouch|remove\s+background|color|saturate|exposure)\b/i;
    const hasEditIntent = EDIT_INTENT_RE.test(lastUserMessage);
    const imageStudioTip =
      hasImage && hasEditIntent
        ? '\n\n◈ Tip: For direct photo editing without building an app, switch to the **Image Studio** tab.'
        : '';

    const context = existingFiles?.length
      ? `\n\nCurrent project files:\n${(existingFiles as ProjectFile[]).map(f => `--- ${f.name} (${f.language}) ---\n${f.content}`).join('\n\n')}`
      : '';

    const anthropicMessages = recentMessages.map((m, i) => ({
      role: m.role as 'user' | 'assistant',
      content:
        i === recentMessages.length - 1 && m.role === 'user'
          ? toClaudeContent(m.content, context || undefined)
          : toClaudeContent(m.content),
    }));

    // Static SYSTEM is first so it caches across all requests; dynamic parts appended after.
    const systemBlocks: Array<{
      type: 'text';
      text: string;
      cache_control?: { type: 'ephemeral' };
    }> = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }];
    const safePersonality = personality?.slice(0, 500);
    if (safePersonality)
      systemBlocks.push({
        type: 'text',
        text: `\nPERSONALITY (adjusts tone and verbosity only — never changes what action to take, never adds greetings, never delays code generation):\n${safePersonality}`,
      });
    if (persona && persona !== 'based' && PERSONA_PROMPTS[persona])
      systemBlocks.push({
        type: 'text',
        text: `\nAGENT MODE:\n${PERSONA_PROMPTS[persona]}`,
      });
    if (globalMemory)
      systemBlocks.push({ type: 'text', text: `\nGLOBAL USER MEMORY:\n${globalMemory}` });
    if (memory) systemBlocks.push({ type: 'text', text: `\nPROJECT MEMORY:\n${memory}` });
    systemBlocks.push({
      type: 'text',
      text: '\nCRITICAL RULE (overrides everything above): When the user asks to build, create, make, design, animate, fix, or generate anything — output forge_file code immediately. Never greet, ask clarifying questions, or refuse a code request. Go straight to the files.',
    });

    const encoder = new TextEncoder();

    const lf = createLangfuseClient();
    const trace = lf?.trace({
      name: 'generate',
      input: { message: lastUserMessage.slice(0, 500), aiModel, hasImage },
      userId: supabaseUserId,
    });

    const startMs = Date.now();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Step 0: Real-time context gathering
          let realtimeContext = '';
          if (
            process.env.EXA_API_KEY ||
            process.env.TAVILY_API_KEY ||
            process.env.OPENWEATHER_API_KEY ||
            process.env.LTA_DATAMALL_API_KEY
          ) {
            try {
              const needsCheck = await callModel(
                `User request: "${lastUserMessage}"\n\nDoes this need real-time external data? Reply with JSON only:\n{"needsSearch":boolean,"needsWeather":boolean,"needsCrowd":boolean,"needsTraffic":boolean,"searchQuery":"...","weatherLocation":"...","crowdLocation":"...","trafficLocation":"..."}`,
                'Reply with only valid JSON. No markdown.',
                'planner'
              );
              const match = needsCheck.match(/\{[\s\S]*\}/);
              if (match) {
                const needs = JSON.parse(match[0]);
                if (
                  needs.needsSearch &&
                  (process.env.EXA_API_KEY || process.env.TAVILY_API_KEY) &&
                  needs.searchQuery
                ) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ searching: 'web' })}\n\n`)
                  );
                  const exaResults = process.env.EXA_API_KEY
                    ? await exaSearch(needs.searchQuery)
                    : null;
                  const results =
                    exaResults !== null ? exaResults : await searchWeb(needs.searchQuery);
                  if (results)
                    realtimeContext += `\nWEB SEARCH for "${needs.searchQuery}":\n${results}`;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ searching: null })}\n\n`)
                  );
                }
                if (needs.needsWeather && process.env.OPENWEATHER_API_KEY) {
                  const loc = needs.weatherLocation ? needs.weatherLocation : (location ?? null);
                  if (loc) {
                    const weather = await getWeather(loc);
                    if (weather) realtimeContext += `\nCURRENT WEATHER:\n${weather}`;
                  }
                }
                if (needs.needsCrowd && needs.crowdLocation) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ searching: 'crowd' })}\n\n`)
                  );
                  const crowdData = await getCrowdInfo(needs.crowdLocation);
                  if (crowdData)
                    realtimeContext += `\nCROWD DATA for "${needs.crowdLocation}":\n${crowdData}`;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ searching: null })}\n\n`)
                  );
                }
                if (needs.needsTraffic && needs.trafficLocation) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ searching: 'traffic' })}\n\n`)
                  );
                  const trafficData = await getTrafficInfo(needs.trafficLocation);
                  if (trafficData)
                    realtimeContext += `\nTRAFFIC DATA for "${needs.trafficLocation}":\n${trafficData}`;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ searching: null })}\n\n`)
                  );
                }
              }
            } catch {
              /* fail open */
            }
          }
          if (realtimeContext) {
            systemBlocks.push({
              type: 'text',
              text: `\nREAL-TIME DATA (use this as actual data in the generated app — do not invent fake values when real data is provided):\n${realtimeContext}`,
            });
          }

          // ── Intent clarity check (Akinator-style) ──────────────────────
          // Fast check before planning — if the request is too vague, ask one
          // clarifying question with chip options instead of guessing wrong.
          const msgWords =
            typeof lastUserMessage === 'string' ? lastUserMessage.trim().split(/\s+/).length : 0;
          const skipClarity =
            imageBlocks.length > 0 ||
            msgWords < 4 || // "Hi", "Hello", "Thanks", "ok cool" — skip entirely
            /^(hi|hey|hello|thanks|thank you|ok|okay|sure|lol|nice|cool|great|good|sounds good|got it|understood|yep|yup|nope|yes|no|what|why|how|hmm)\b/i.test(
              typeof lastUserMessage === 'string' ? lastUserMessage.trim() : ''
            );

          if (
            !skipClarity &&
            typeof lastUserMessage === 'string' &&
            lastUserMessage.trim().length > 0
          ) {
            try {
              const clarityRaw = await callPantheon(
                [
                  {
                    role: 'system',
                    content: `Analyze this request. Return ONLY raw JSON, no markdown or explanation.
If it is a question, calculation, analysis, or data task (not a build request) — always: {"clear":true}
If it is a greeting, casual conversation, feedback, or anything that is not a build request — always: {"clear":true}
If it is a build request specific enough to build directly: {"clear":true}
If it is a genuinely vague BUILD request (only "build"/"make"/"create"/"make me" with NO subject) and one question would significantly improve the result: {"clear":false,"question":"short question?","options":["Option A","Option B","Option C"]}
Options must be 2-5 words. Be extremely generous with "clear" — only fire for pure "make me something" with zero details.
CLEAR examples: "snake game", "todo list with drag and drop", "what is 20% of 500", "translate this text", "write a cover letter", "hi", "hello", "how are you"
VAGUE examples (ONLY these should ever be false): "make an app", "build something", "a game" (with NO other details), "make something nice"`,
                  },
                  { role: 'user', content: lastUserMessage.trim() },
                ],
                'fast_chat',
                120
              );
              const cleaned = clarityRaw
                .trim()
                .replace(/^```json|^```|```$/g, '')
                .trim();
              const clarity = JSON.parse(cleaned);
              if (
                !clarity.clear &&
                clarity.question &&
                Array.isArray(clarity.options) &&
                clarity.options.length >= 2
              ) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ clarify: true, question: clarity.question, options: clarity.options.slice(0, 3) })}\n\n`
                  )
                );
                controller.close();
                return;
              }
            } catch {
              // If check fails for any reason, proceed with normal generation
            }
          }

          // ── Brain-save shortcut ─────────────────────────────────────────
          // Detect "save/store/extract to brain/memory/entities" intents BEFORE
          // the planner AND before the file-analysis shortcut so they always reach
          // runChatWithTools with BRAIN_TOOLS available. Without this guard the
          // file-analysis path (simplified system, no tools) or plain chat path
          // (no tools) would intercept these requests and the model would
          // hallucinate a tool call like { "command": "view", "path": "/memories" }.
          const BRAIN_SAVE_RE =
            /\b(save|add|store|put|record|log|remember|extract|pull|keep)\b.{0,60}\b(brain|memory|entities|entity|notes?)\b|\b(brain|memory)\b.{0,30}\b(save|add|store|update|record)\b/i;
          if (BRAIN_SAVE_RE.test(lastUserMessage)) {
            let fullText = '';
            if (!usingFreeModel && HAS_ANTHROPIC_KEY) {
              // Inject a specialised instruction block so the model knows to call
              // upsert_entity for each significant entity found in the attached files.
              const brainSaveBlocks = [
                ...systemBlocks,
                {
                  type: 'text' as const,
                  text: `\nBRAIN-SAVE MODE: The user wants to extract and save entities from the attached files into their knowledge base. You MUST use the upsert_entity tool — call it once for each significant entity (decision, project, person, account, plan, phase, or context item) found in the files. Do NOT use any other tool format. Do NOT invent tool calls not defined here. After saving all entities, reply with a brief plain-text summary of what was saved.`,
                },
              ];
              fullText = await runChatWithTools(
                userId,
                brainSaveBlocks,
                anthropicMessages,
                lastUserMessage,
                t =>
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`)),
                tool => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool })}\n\n`))
              );
            } else {
              const sysText =
                'You are Based — a sharp, direct AI assistant. The user wants to save information to their brain/memory. Read the attached files and summarize the key entities, decisions, and context they contain. Reply in clear markdown.';
              const msgs = [
                { role: 'system', content: sysText },
                ...anthropicMessages.map((m: { role: string; content: unknown }) => ({
                  role: m.role,
                  content: typeof m.content === 'string' ? m.content : lastUserMessage,
                })),
              ];
              fullText = await streamText(
                msgs,
                8000,
                t =>
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`)),
                () =>
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ retrying: true })}\n\n`)
                  ),
                usingFreeModel ? 'free' : 'based'
              );
            }
            const files = parseFiles(fullText);
            const projectType = parseType(fullText);
            const reply = stripTags(fullText);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ done: true, reply, files, projectType })}\n\n`
              )
            );
            return;
          }

          // ── Task-management shortcut ────────────────────────────────────
          // Detect task/brain management phrases BEFORE the planner so they are
          // always routed to the chat/tool path (runChatWithTools) and never
          // sent to the file-generator pipeline by mistake.
          const TASK_MGMT_RE =
            /\b(add\s+a?\s*task|create\s+a?\s*task|new\s+task|remind\s+me\s+to|add\s+to\s+(my\s+)?tasks?|what(?:'?s|\s+is)?\s+(due|on my|my)\s+(today|list|tasks?)|what\s+do\s+i\s+have\s+due|list\s+(my\s+)?tasks?|show\s+(my\s+)?tasks?|mark\s+.{0,40}\s+as\s+done|complete\s+task|finish\s+task|task\s+done|clean\s+(up\s+)?(my\s+)?(brain|memory)|fix\s+(my\s+)?(brain|memory)|revamp\s+(my\s+)?(brain|memory)|reorgani[sz]e\s+(my\s+)?(brain|memory)|rewrite\s+(my\s+)?(brain|memory)|update\s+(my\s+)?(brain|memory)|my\s+(brain|memory)\s+(is\s+)?(wrong|messy|broken|off|outdated|incorrect))\b/i;
          if (TASK_MGMT_RE.test(lastUserMessage)) {
            let fullText = '';
            if (!usingFreeModel && HAS_ANTHROPIC_KEY) {
              fullText = await runChatWithTools(
                userId,
                systemBlocks,
                anthropicMessages,
                lastUserMessage,
                t =>
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`)),
                tool => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool })}\n\n`))
              );
            } else {
              const sysText =
                'You are Based — a sharp, direct AI assistant. The user wants to manage tasks. Answer helpfully and concisely.';
              const msgs = [
                { role: 'system', content: sysText },
                ...anthropicMessages.map((m: { role: string; content: unknown }) => ({
                  role: m.role,
                  content: typeof m.content === 'string' ? m.content : lastUserMessage,
                })),
              ];
              fullText = await streamText(
                msgs,
                8000,
                t =>
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`)),
                () =>
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ retrying: true })}\n\n`)
                  ),
                usingFreeModel ? 'free' : 'based'
              );
            }
            const files = parseFiles(fullText);
            const projectType = parseType(fullText);
            const reply = stripTags(fullText);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ done: true, reply, files, projectType })}\n\n`
              )
            );
            return;
          }

          // ── Inline code review shortcut ────────────────────────────────
          // If the user pastes raw source code AND uses an improvement keyword,
          // skip the planner/file pipeline and return improved code directly.
          const CODE_INTENT_RE =
            /\b(improve|review|fix|explain|clean|refactor|rewrite|optimise|optimize|debug|critique|check)\b/i;
          const hasCodeIntentKeyword = CODE_INTENT_RE.test(lastUserMessage);
          const looksLikeCode =
            (lastUserMessage.match(/\n/g) ?? []).length >= 3 &&
            /[{};]/.test(lastUserMessage) &&
            /\b(import|function|class|const|let|var|def|return|if|for|while|=>)\b/.test(
              lastUserMessage
            );

          if (hasCodeIntentKeyword && looksLikeCode) {
            const codeReviewSystem =
              'The user has shared code and wants it improved or reviewed. Return ONLY the improved code in a markdown code block with the language tag, followed by a short bulleted list of what changed. Do not create files. Do not generate an app.';
            const sysText = codeReviewSystem;
            const msgs = [
              { role: 'system', content: sysText },
              ...anthropicMessages.map((m: { role: string; content: unknown }) => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content : lastUserMessage,
              })),
            ];
            let fullText = '';
            fullText = await streamText(
              msgs,
              8000,
              t => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`)),
              () =>
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ retrying: true })}\n\n`)
                ),
              usingFreeModel ? 'free' : 'based'
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ done: true, reply: fullText, files: [], projectType: 'html' })}\n\n`
              )
            );
            return;
          }

          // ── File-analysis shortcut ─────────────────────────────────────
          // If the last user message contains an attached-file marker AND the
          // plain-text part is a short analysis request, skip the planner and
          // return an inline markdown response. This prevents analysis verbs like
          // "refactor" or "explain" from triggering the full app-builder pipeline.
          const FILE_ANALYSIS_RE =
            /^\s*(refactor|rewrite|explain|review|summarise|summarize|analyse|analyze|what does|what is|how does|how do|find (bugs?|issues?|errors?|problems?)|check (for|this)|look at|read (this|through)|critique|improve|clean ?up|optimise|optimize|describe|document|audit)\b/i;
          const lastUserContent = lastUserMsg?.content;
          const hasFileMarker =
            Array.isArray(lastUserContent) &&
            (lastUserContent as ApiContentBlock[]).some(
              b =>
                b.type === 'text' &&
                /^---\s.+\s---/.test((b as { type: 'text'; text: string }).text.trim())
            );
          if (hasFileMarker) {
            const plainTextBlocks = Array.isArray(lastUserContent)
              ? (lastUserContent as ApiContentBlock[])
                  .filter(
                    b =>
                      b.type === 'text' &&
                      !/^---\s.+\s---/.test((b as { type: 'text'; text: string }).text.trim())
                  )
                  .map(b => (b as { type: 'text'; text: string }).text)
                  .join(' ')
                  .trim()
              : '';
            // Never let the file-analysis shortcut intercept brain-save requests —
            // those need the full tool-calling path (BRAIN_SAVE_RE already handled
            // them above, but guard here too in case of future regex ordering changes).
            if (
              !BRAIN_SAVE_RE.test(plainTextBlocks) &&
              plainTextBlocks.length <= 120 &&
              FILE_ANALYSIS_RE.test(plainTextBlocks)
            ) {
              const fileAnalysisSystem =
                'You are Based, a personal AI assistant. The user has attached files for you to analyse. Respond with clear, helpful markdown — no code generation pipeline, no HTML apps. Just answer their question about the files.';
              const msgs = [
                { role: 'system', content: fileAnalysisSystem },
                ...anthropicMessages.map((m: { role: string; content: unknown }) => ({
                  role: m.role,
                  content: typeof m.content === 'string' ? m.content : lastUserMessage,
                })),
              ];
              let fullText = '';
              fullText = await streamText(
                msgs,
                8000,
                t =>
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`)),
                () =>
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ retrying: true })}\n\n`)
                  ),
                usingFreeModel ? 'free' : 'based'
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ done: true, reply: fullText, files: [], projectType: 'html' })}\n\n`
                )
              );
              return;
            }
          }

          // Step 1: Planner classifies intent and plans files
          const existingFilesContext = existingFiles?.length
            ? `\n\nExisting files (read before deciding which files to include):\n${(existingFiles as ProjectFile[]).map(f => `--- ${f.name} ---\n${f.content.slice(0, 200).replace(/\n/g, ' ')}`).join('\n')}`
            : '';

          // When user is following up in an image conversation without sending a new image,
          // hint the planner to prefer chat unless they explicitly ask to build something.
          const recentImageNote =
            hasRecentImage && !hasImage
              ? '\n[CONTEXT: Previous messages in this conversation contained images. Only generate a file plan if the user explicitly says to build/create/make/design something. Otherwise return [{"chat":true}].]'
              : '';
          const plannerTextContent =
            (lastUserMessage + existingFilesContext + recentImageNote).trim() ||
            'Please look at this image.';
          const plannerPromptContent =
            imageBlocks.length > 0
              ? [
                  ...imageBlocks,
                  {
                    type: 'text' as const,
                    text: plannerTextContent,
                  },
                ]
              : lastUserMessage + existingFilesContext;

          // Signal client that planning is starting so it can show "Planning..." immediately
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ planning: true })}\n\n`));

          // Planner chain: Groq (primary, fastest) → Cerebras (second, if Groq fails) → Haiku (final).
          // Images skip fast planners — Anthropic vision is required for multimodal input.
          const useGroqPlanner = !!process.env.GROQ_API_KEY && imageBlocks.length === 0;
          const useCerebrasPlanner = !!process.env.CEREBRAS_API_KEY && imageBlocks.length === 0;
          const plannerModel = useGroqPlanner
            ? GROQ_MODEL
            : useCerebrasPlanner
              ? CEREBRAS_MODEL
              : MODEL_HAIKU;
          const planGeneration = trace?.generation({
            name: 'planner',
            model: plannerModel,
            input: lastUserMessage,
          });
          let planText: string;
          if (useGroqPlanner) {
            try {
              planText = await groqPlanner(PLANNER_SYSTEM, lastUserMessage + existingFilesContext);
            } catch (groqErr: unknown) {
              console.warn(
                '[groqPlanner] Groq failed, trying Cerebras:',
                groqErr instanceof Error ? groqErr.message : String(groqErr)
              );
              if (useCerebrasPlanner) {
                try {
                  planText = await cerebrasPlanner(
                    PLANNER_SYSTEM,
                    lastUserMessage + existingFilesContext
                  );
                } catch (cerebrasErr: unknown) {
                  console.warn(
                    '[cerebrasPlanner] Cerebras failed, falling back to Haiku:',
                    cerebrasErr instanceof Error ? cerebrasErr.message : String(cerebrasErr)
                  );
                  planText = await callModel(
                    plannerPromptContent,
                    PLANNER_SYSTEM_BLOCKS,
                    'planner',
                    usingFreeModel ? 'free' : 'based'
                  );
                }
              } else {
                planText = await callModel(
                  plannerPromptContent,
                  PLANNER_SYSTEM_BLOCKS,
                  'planner',
                  usingFreeModel ? 'free' : 'based'
                );
              }
            }
          } else if (useCerebrasPlanner) {
            try {
              planText = await cerebrasPlanner(
                PLANNER_SYSTEM,
                lastUserMessage + existingFilesContext
              );
            } catch (cerebrasErr: unknown) {
              console.warn(
                '[cerebrasPlanner] Cerebras failed, falling back to Haiku:',
                cerebrasErr instanceof Error ? cerebrasErr.message : String(cerebrasErr)
              );
              planText = await callModel(
                plannerPromptContent,
                PLANNER_SYSTEM_BLOCKS,
                'planner',
                usingFreeModel ? 'free' : 'based'
              );
            }
          } else if (usingFreeModel && imageBlocks.length > 0) {
            // Free AI + image → always a chat turn, never code gen. Skip the Gemini
            // planner call entirely to halve request count and avoid rate limits.
            planText = '[{"chat":true}]';
          } else {
            planText = await callModel(
              plannerPromptContent,
              PLANNER_SYSTEM_BLOCKS,
              'planner',
              usingFreeModel ? 'free' : 'based'
            );
          }
          planGeneration?.end({
            output: planText.slice(0, 500),
            usage: {
              input: Math.ceil(lastUserMessage.length / 4),
              output: Math.ceil(planText.length / 4),
            },
          });
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ planning: false })}\n\n`));

          let filePlan: { name: string; language: string; description: string }[] = [];
          let routeToChat = false;

          try {
            const jsonMatch = planText.match(/\[[\s\S]*\]/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : planText.trim());
            if (
              Array.isArray(parsed) &&
              parsed.length === 1 &&
              (parsed[0] as { chat?: boolean }).chat === true
            ) {
              routeToChat = true;
            } else if (Array.isArray(parsed) && parsed.length > 0) {
              filePlan = parsed;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ plan: filePlan.map(f => f.name) })}\n\n`)
              );
            } else {
              throw new Error('empty plan');
            }
          } catch {
            if (!routeToChat) {
              // Planner parse failed — stream via vision model (images) or text model (no images)
              let fullText = '';
              if (imageBlocks.length > 0 || hasRecentImage) {
                if (usingFreeModel && HAS_GEMINI_KEY) {
                  fullText = await streamGeminiVisionCollecting(
                    GEMINI_IMAGE_SYSTEM,
                    anthropicMessages,
                    8000,
                    t =>
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`))
                  );
                } else {
                  const stream = await client.messages.stream({
                    model: MODEL_OPUS,
                    max_tokens: 16000,
                    system: [
                      {
                        type: 'text' as const,
                        text: SYSTEM,
                        cache_control: { type: 'ephemeral' as const },
                      },
                    ],
                    messages: anthropicMessages,
                  });
                  for await (const chunk of stream) {
                    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                      fullText += chunk.delta.text;
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`)
                      );
                    }
                  }
                }
              } else {
                const sysText = usingFreeModel
                  ? 'You are Based — a sharp, direct AI assistant. Answer helpfully and concisely. Never output forge_file tags, forge_type tags, or navigation menus. Just reply naturally. Focus on the current message only — do not recap or reference previous topics unless the user explicitly asks.\n\nSTACKED ADDITION PUZZLES:\n- Chat UIs strip newlines, so a stacked addition puzzle will arrive as ONE flat line like: ○ □ △ ○ □ + △ ○ □ = 1 2 5 8 △ ○ □ = ?\n- Parse it using + and = as delimiters: split on + to get addend groups, split on = to find the sum and question.\n- The group after + (before =) is the last addend. The group before + contains all earlier addends concatenated — split them by counting: the last N symbols (where N = length of post-+ addend) form one row; any remaining symbols at the start form shorter rows.\n- Example: "○ □ △ ○ □ + △ ○ □ = 1 2 5 8" → post-+ addend is △○□ (3 symbols) → pre-+ group is "○ □ △ ○ □" → last 3 = △○□ (row 2), first 2 = ○□ (row 1) → three rows: ○□, △○□, △○□ summing to 1258.\n- After parsing rows, write them out right-justified explicitly, then solve column by column algebraically. Show full verification.\n- Each puzzle is independent. Never compare to a previously analysed image.'
                  : systemBlocks.map(b => b.text).join('\n');
                const msgs = [
                  { role: 'system', content: sysText },
                  ...anthropicMessages.map((m: { role: string; content: unknown }) => ({
                    role: m.role,
                    content: typeof m.content === 'string' ? m.content : lastUserMessage,
                  })),
                ];
                fullText = await streamText(
                  msgs,
                  16000,
                  t =>
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`)),
                  () =>
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ retrying: true })}\n\n`)
                    ),
                  usingFreeModel ? 'free' : 'based'
                );
              }
              const files = parseFiles(fullText);
              const projectType = parseType(fullText);
              const reply = stripTags(fullText);
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ done: true, reply, files, projectType })}\n\n`
                )
              );
              return;
            }
          }

          if (routeToChat) {
            let fullText = '';
            if (imageBlocks.length > 0 || hasRecentImage) {
              // Image in current or recent message — Groq/Cerebras have no vision support.
              // Free tier → Gemini Flash 2.0 (multimodal, free quota).
              // Based AI (or no Gemini key) → Anthropic Opus with full conversation history.
              if (usingFreeModel && HAS_GEMINI_KEY) {
                fullText = await streamGeminiVisionCollecting(
                  GEMINI_IMAGE_SYSTEM,
                  anthropicMessages,
                  8192,
                  t =>
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`))
                );
              } else {
                const stream = await client.messages.stream({
                  model: MODEL_OPUS,
                  max_tokens: 12000,
                  system: systemBlocks,
                  messages: anthropicMessages,
                });
                for await (const chunk of stream) {
                  if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    fullText += chunk.delta.text;
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`)
                    );
                  }
                }
              }
            } else if (!usingFreeModel && HAS_ANTHROPIC_KEY) {
              // Based AI (Claude) chat path — runs the digital-brain tool loop so
              // Based can manage tasks and read/update entities mid-conversation.
              // Resolve the tool calls first (non-streamed), then stream the final
              // natural-language reply to the user.
              fullText = await runChatWithTools(
                userId,
                systemBlocks,
                anthropicMessages,
                lastUserMessage,
                t =>
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`)),
                tool => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool })}\n\n`))
              );
            } else {
              const sysText = usingFreeModel
                ? 'You are Based — a sharp, direct AI assistant. Answer helpfully and concisely. Never output forge_file tags, forge_type tags, or navigation menus. Just reply naturally. Focus on the current message only — do not recap or reference previous topics unless the user explicitly asks.\n\nSTACKED ADDITION PUZZLES:\n- Chat UIs strip newlines, so a stacked addition puzzle will arrive as ONE flat line like: ○ □ △ ○ □ + △ ○ □ = 1 2 5 8 △ ○ □ = ?\n- Parse it using + and = as delimiters: split on + to get addend groups, split on = to find the sum and question.\n- The group after + (before =) is the last addend. The group before + contains all earlier addends concatenated — split them by counting: the last N symbols (where N = length of post-+ addend) form one row; any remaining symbols at the start form shorter rows.\n- Example: "○ □ △ ○ □ + △ ○ □ = 1 2 5 8" → post-+ addend is △○□ (3 symbols) → pre-+ group is "○ □ △ ○ □" → last 3 = △○□ (row 2), first 2 = ○□ (row 1) → three rows: ○□, △○□, △○□ summing to 1258.\n- After parsing rows, write them out right-justified explicitly, then solve column by column algebraically. Show full verification.\n- Each puzzle is independent. Never compare to a previously analysed image.'
                : systemBlocks.map(b => b.text).join('\n');
              const msgs = [
                { role: 'system', content: sysText },
                ...anthropicMessages.map((m: { role: string; content: unknown }) => ({
                  role: m.role,
                  content: typeof m.content === 'string' ? m.content : lastUserMessage,
                })),
              ];
              fullText = await streamText(
                msgs,
                12000,
                t =>
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`)),
                () =>
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ retrying: true })}\n\n`)
                  ),
                usingFreeModel ? 'free' : 'based'
              );
            }
            const files = parseFiles(fullText);
            const projectType = parseType(fullText);
            const reply = stripTags(fullText) + imageStudioTip;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ done: true, reply, files, projectType })}\n\n`
              )
            );
            return;
          }

          const projectType = (() => {
            const langs = filePlan.map((f: { language: string }) => f.language);
            if (langs.some(l => l === 'java')) return 'java';
            if (langs.some(l => l === 'cpp')) return 'cpp';
            if (langs.some(l => l === 'go')) return 'go';
            if (langs.some(l => l === 'rust')) return 'rust';
            if (langs.some(l => l === 'bash')) return 'bash';
            if (langs.some(l => l === 'python')) return 'python';
            return 'html';
          })();
          const generatedFiles: { name: string; language: string; content: string }[] = [];

          // Step 2: Generate each file individually
          for (let i = 0; i < filePlan.length; i++) {
            const fileSpec = filePlan[i];

            const generatedContext =
              generatedFiles.length > 0
                ? `\n\nAlready generated files:\n${generatedFiles.map(f => `--- ${f.name} ---\n${f.content.slice(0, 3000)}\n...[continues]`).join('\n\n')}`
                : '';

            const isModifyingExisting = (existingFiles as ProjectFile[] | undefined)?.some(
              f => f.name === fileSpec.name
            );
            const existingContext = existingFiles?.length
              ? `\n\nExisting files:\n${(existingFiles as ProjectFile[])
                  .map(f =>
                    f.name === fileSpec.name
                      ? `--- ${f.name} (YOU ARE MODIFYING THIS FILE — preserve all existing event listeners, buttons, and logic unless explicitly asked to change them) ---\n${f.content}`
                      : `--- ${f.name} (context only) ---\n${f.content.slice(0, 600)}\n...[truncated]`
                  )
                  .join('\n\n')}`
              : '';

            const imagePlaceholderNote =
              imageBlocks.length > 0
                ? `\n\nThe user has provided an image. Wherever you need the image source, use exactly: ${IMAGE_SRC_PLACEHOLDER}\nDo NOT use any other URL or path — only ${IMAGE_SRC_PLACEHOLDER}. It will be replaced with the real base64 data URL at build time.`
                : '';

            const filePrompt = `IMPLEMENT THIS EXACTLY — do not reinterpret, simplify, or substitute with something similar:
"${lastUserMessage}"

${isModifyingExisting ? `MODIFY existing file: ${fileSpec.name}` : `Generate new file: ${fileSpec.name}`}
Planner notes (expand on the spec above — do not replace it): ${fileSpec.description}
Language: ${fileSpec.language}

All project files: ${filePlan.map(f => `${f.name} — ${f.description}`).join('\n')}
${generatedContext}${existingContext}${imagePlaceholderNote}

${isModifyingExisting ? `CRITICAL: This is a MODIFICATION of an existing file. The full existing content is shown above. Make ONLY the changes needed. Every existing event listener, button, screen, and function must still work after your edit.` : `Generate ONLY ${fileSpec.name}, complete with no placeholders. Every mechanic, phase, and element described in the spec above must be present.`}`;

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ status: { file: fileSpec.name, current: i + 1, total: filePlan.length } })}\n\n`
              )
            );
            const fileGeneration = trace?.generation({
              name: `generate-file:${fileSpec.name}`,
              model: MODEL_OPUS,
              input: filePrompt,
            });

            const filePromptContent =
              imageBlocks.length > 0
                ? [...imageBlocks, { type: 'text' as const, text: filePrompt }]
                : filePrompt;

            let fileText = '';
            if (imageBlocks.length > 0) {
              // Image-containing files must use Anthropic (vision required)
              const fileStream = client.messages.stream({
                model: MODEL_OPUS,
                max_tokens: 16000,
                system: FILE_GENERATOR_SYSTEM_BLOCKS,
                messages: [{ role: 'user', content: filePromptContent }],
              });
              for await (const chunk of fileStream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                  fileText += chunk.delta.text;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`)
                  );
                }
              }
              const fileResult = await fileStream.finalMessage();
              if (fileResult.stop_reason === 'max_tokens' && !fileText.includes('</forge_file>')) {
                const contStream = client.messages.stream({
                  model: MODEL_OPUS,
                  max_tokens: 16000,
                  system: FILE_GENERATOR_SYSTEM_BLOCKS,
                  messages: [
                    { role: 'user', content: filePromptContent },
                    { role: 'assistant', content: fileText },
                  ],
                });
                for await (const chunk of contStream) {
                  if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    fileText += chunk.delta.text;
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`)
                    );
                  }
                }
              }
            } else {
              const msgs = [
                { role: 'system', content: FILE_GENERATOR_SYSTEM },
                { role: 'user', content: filePrompt },
              ];
              fileText = await streamText(
                msgs,
                16000,
                t =>
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`)),
                () =>
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ retrying: true })}\n\n`)
                  ),
                usingFreeModel ? 'free' : 'based'
              );
            }

            const parsedFiles = parseFiles(fileText);
            let filesToAdd =
              parsedFiles.length > 0
                ? parsedFiles
                : [
                    {
                      name: fileSpec.name,
                      language: fileSpec.language,
                      content:
                        fileText.replace(/^<forge_file[^>]*>\n?/, '').trim() || fileText.trim(),
                    },
                  ];

            // ── Server-side JS syntax validation ──────────────────────────
            // For each generated file:
            //   1. Pre-sanitise encoding (curly quotes, em-dashes, zero-width chars).
            //   2. Check syntax with vm.Script on the sanitised content.
            //   3. If still broken, retry once with a detailed error prompt.
            const validatedFiles: typeof filesToAdd = [];
            for (const f of filesToAdd) {
              // Step 1: pre-sanitise encoding mistakes in script blocks before validation.
              // This silently fixes curly quotes and invisible chars without needing a retry.
              let sanitisedContent = f.content;
              if (f.language === 'html') {
                sanitisedContent = f.content.replace(
                  /<script(?:\s+[^>]*)?>([^<]*(?:(?!<\/script>)<[^<]*)*)<\/script>/gi,
                  (match: string, body: string) => {
                    const openTag = match.slice(0, match.indexOf('>') + 1);
                    if (/\bsrc\s*=/i.test(openTag)) return match; // skip external
                    return match.replace(body, sanitiseJSEncoding(body));
                  }
                );
              } else if (f.language === 'javascript' || f.language === 'js') {
                sanitisedContent = sanitiseJSEncoding(f.content);
              }
              const fSanitised = { ...f, content: sanitisedContent };

              const syntaxErr = findSyntaxError(sanitisedContent, f.language);
              if (syntaxErr) {
                console.warn(
                  `[Based] SyntaxError in generated ${f.name}: ${syntaxErr.message} — retrying once`
                );
                const retryNote = `\n\n[SYNTAX ERROR DETECTED on server: "${syntaxErr.message}" — The JavaScript you generated had a syntax error. Common causes:\n- Unclosed template literal backticks\n- Mismatched brackets, braces, or parentheses\n- Invalid characters in strings (curly quotes “”‘’, em-dashes —)\n- Trailing commas before closing brackets\n- Missing semicolons in specific contexts\nRegenerate this file with syntactically valid JavaScript only. Do not use smart quotes or curly quotes. Use only standard ASCII characters in code.]`;
                const retryFilePrompt = filePrompt + retryNote;
                let retryText = '';
                try {
                  if (imageBlocks.length > 0) {
                    const retryStream = client.messages.stream({
                      model: MODEL_OPUS,
                      max_tokens: 16000,
                      system: FILE_GENERATOR_SYSTEM_BLOCKS,
                      messages: [
                        {
                          role: 'user',
                          content: [
                            ...imageBlocks,
                            { type: 'text' as const, text: retryFilePrompt },
                          ],
                        },
                      ],
                    });
                    for await (const chunk of retryStream) {
                      if (
                        chunk.type === 'content_block_delta' &&
                        chunk.delta.type === 'text_delta'
                      ) {
                        retryText += chunk.delta.text;
                        controller.enqueue(
                          encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`)
                        );
                      }
                    }
                  } else {
                    const retryMsgs = [
                      { role: 'system', content: FILE_GENERATOR_SYSTEM },
                      { role: 'user', content: retryFilePrompt },
                    ];
                    retryText = await streamText(
                      retryMsgs,
                      16000,
                      t =>
                        controller.enqueue(
                          encoder.encode(`data: ${JSON.stringify({ chunk: t })}\n\n`)
                        ),
                      () =>
                        controller.enqueue(
                          encoder.encode(`data: ${JSON.stringify({ retrying: true })}\n\n`)
                        ),
                      usingFreeModel ? 'free' : 'based'
                    );
                  }
                  const retryParsed = parseFiles(retryText);
                  const retryFiles =
                    retryParsed.length > 0
                      ? retryParsed
                      : [
                          {
                            name: f.name,
                            language: f.language,
                            content:
                              retryText.replace(/^<forge_file[^>]*>\n?/, '').trim() ||
                              retryText.trim(),
                          },
                        ];
                  // Apply encoding sanitisation to retried files too
                  const sanitisedRetryFiles = retryFiles.map(rf => {
                    if (rf.language === 'html') {
                      return {
                        ...rf,
                        content: rf.content.replace(
                          /<script(?:\s+[^>]*)?>([^<]*(?:(?!<\/script>)<[^<]*)*)<\/script>/gi,
                          (match: string, body: string) => {
                            const openTag = match.slice(0, match.indexOf('>') + 1);
                            if (/\bsrc\s*=/i.test(openTag)) return match;
                            return match.replace(body, sanitiseJSEncoding(body));
                          }
                        ),
                      };
                    } else if (rf.language === 'javascript' || rf.language === 'js') {
                      return { ...rf, content: sanitiseJSEncoding(rf.content) };
                    }
                    return rf;
                  });
                  validatedFiles.push(...sanitisedRetryFiles);
                } catch (retryErr) {
                  console.error('[Based] Syntax-error retry failed:', retryErr);
                  // Fall back to the pre-sanitised file rather than the broken original
                  validatedFiles.push(fSanitised);
                }
              } else {
                // No syntax error — use the pre-sanitised version
                validatedFiles.push(fSanitised);
              }
            }
            filesToAdd = validatedFiles;
            // ── End syntax validation ──────────────────────────────────────

            const imageDataUrl =
              imageBlocks.length > 0
                ? `data:${imageBlocks[0].source.media_type};base64,${imageBlocks[0].source.data}`
                : null;

            for (const f of filesToAdd) {
              const content = imageDataUrl
                ? f.content.replaceAll(IMAGE_SRC_PLACEHOLDER, imageDataUrl)
                : f.content;
              generatedFiles.push(
                f.language === 'html' ? { ...f, content: sanitizeHTML(content) } : { ...f, content }
              );
            }

            fileGeneration?.end({
              output: fileText.slice(0, 200),
              usage: {
                input: Math.ceil(filePrompt.length / 4),
                output: Math.ceil(fileText.length / 4),
              },
            });
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ progress: { file: fileSpec.name, current: i + 1, total: filePlan.length } })}\n\n`
              )
            );
          }

          // Step 3: Brief summary — use a minimal system to avoid code-gen rules confusing haiku
          const summarySystem =
            'You are Based. Reply with 1-2 plain sentences describing what was just built. No code, no forge tags, no lists.';
          const summaryPrompt = `User asked: "${lastUserMessage}"\nFiles generated: ${generatedFiles.map(f => f.name).join(', ')}\n\nDescribe what was built in 1-2 sentences.`;
          let replyText = '';
          try {
            replyText = await callModel(
              summaryPrompt,
              summarySystem,
              'summary',
              usingFreeModel ? 'free' : 'based'
            );
          } catch {
            /* summary is best-effort — files already generated */
          }
          const reply =
            (replyText ||
              `Built ${generatedFiles.length} files: ${generatedFiles.map(f => f.name).join(', ')}`) +
            imageStudioTip;

          let suggestions: string[] = [];
          try {
            const suggestText = await callModel(
              `The user just built: "${lastUserMessage}"\nFiles: ${generatedFiles.map(f => f.name).join(', ')}\n\nOutput exactly 3 short follow-up action suggestions as a JSON array. Max 5 words each. Be specific to what was built.\nExamples: ["Add dark mode", "Make it mobile-friendly", "Add sound effects"]\nJSON only, no explanation.`,
              'Output only a valid JSON array of exactly 3 short strings. No markdown.',
              'planner',
              usingFreeModel ? 'free' : 'based'
            );
            const match = suggestText.match(/\[[\s\S]*?\]/);
            if (match)
              suggestions = (JSON.parse(match[0]) as unknown[])
                .filter((s): s is string => typeof s === 'string')
                .slice(0, 3);
          } catch {}

          trace?.update({ output: { files: generatedFiles.map(f => f.name), reply } });
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, reply, files: generatedFiles, projectType, suggestions })}\n\n`
            )
          );

          void (async () => {
            try {
              await supabaseAdmin.from('inference_logs').insert({
                user_id: supabaseUserId ?? null,
                model: usingFreeModel ? GROQ_MODEL : MODEL_OPUS,
                project_type: projectType,
                prompt: lastUserMessage.slice(0, 2000),
                response: reply.slice(0, 1000),
                input_tokens: Math.ceil(lastUserMessage.length / 4),
                output_tokens: generatedFiles.reduce(
                  (acc, f) => acc + Math.ceil(f.content.length / 4),
                  0
                ),
                latency_ms: Date.now() - startMs,
                provider: usingFreeModel ? 'groq' : HAS_ANTHROPIC_KEY ? 'anthropic' : 'pantheon',
              });
            } catch {}
          })();
        } catch (e: unknown) {
          let friendly = friendlyError(e);
          // Free-tier users must never see raw provider auth errors. Vision
          // (image) requests are Anthropic-only; if that fails for a free user,
          // surface an upgrade hint instead of "Missing or invalid API key".
          if (usingFreeModel && /api key|authentication|x-api-key|401/i.test(friendly)) {
            friendly = hasImage
              ? 'Image analysis requires Based AI — switch to Based AI to analyse images.'
              : 'Free AI is temporarily unavailable — switch to Based AI or try again later.';
          }
          Sentry.captureException(e, { extra: { message: lastUserMessage, aiModel } });
          trace?.update({ output: { error: friendly } });
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: friendly })}\n\n`));
        } finally {
          try {
            if (lf) {
              console.log('[LangFuse] shutting down...');
              await lf.shutdownAsync();
              console.log('[LangFuse] done');
            }
          } catch (lfErr) {
            console.error('[LangFuse] shutdown failed:', lfErr);
          }
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ reply: `Error: ${message}`, files: [] }, { status: 500 });
  }
}

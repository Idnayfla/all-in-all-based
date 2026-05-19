# Pantheon — AI Orchestration Platform

**Date:** 2026-05-15  
**Status:** Approved — ready for implementation  
**Tagline:** All the gods. One API.  
**Creator:** Mohamad Hus Alfyandi Bin Mohamed Tahir

---

## Vision

Pantheon is a standalone AI orchestration platform that routes every request to the best available model for that task — invisibly, automatically, and profitably. Developers get one API key, one bill, and access to every major AI capability. You take the margin.

Pantheon powers Based (as its internal intelligence engine) and is also a public developer API. It is a separate product from Based with its own brand, domain, and billing.

The long-term goal is a proprietary fine-tuned model (`pantheon-v1`) that replaces external text providers, compressing margins from ~40% to ~85% on text tasks. Phase 1 ships an orchestration layer using existing provider APIs. The model is built incrementally as revenue funds compute.

---

## Architecture

```
Developer App / Based
        │
        ▼
┌───────────────────────────────────────────────┐
│                 PANTHEON API                  │
│  api.pantheon.ai                              │
│                                               │
│  1. Auth & Rate Limit Gate                    │
│  2. Credit Check                              │
│  3. Intent Classifier  (Haiku / Flash Lite)   │
│  4. Router                                    │
│  5. Provider Adapter                          │
│  6. Unified Stream Response                   │
│  7. Credit Deduction + Usage Log              │
└──────────────────────┬────────────────────────┘
                       │
      ┌────────────────┼──────────────────────┐
      ▼                ▼                       ▼
  Claude API       Gemini API            DeepSeek API
  (code, writing)  (video, research)     (math, logic)

      ▼                ▼                       ▼
  FAL.ai           Suno API              Perplexity API
  (image, video    (music gen)           (deep research)
   gen, Seedance,
   Nano Banana)
```

Three logical layers:

- **Gateway** — auth, rate limiting, credit balance check before any model call
- **Brain** — classifies intent, selects provider, assembles the upstream call
- **Adapters** — thin translation wrappers per provider; each speaks Pantheon internally

---

## Intent Classification & Routing

Every request passes through the classifier before reaching any model. Classification uses `claude-haiku-4-5` or `gemini-2.5-flash-lite` — fast and cheap (~$0.0002 per classification).

Developers can pass `task_type` explicitly to skip classification and save ~200ms latency.

### Routing Table

| task_type        | Primary model           | Fallback                              |
| ---------------- | ----------------------- | ------------------------------------- |
| `code`           | claude-opus-4-7         | claude-sonnet-4-6                     |
| `writing`        | claude-sonnet-4-6       | gpt-4o                                |
| `math`           | deepseek-r1             | claude-sonnet-4-6 (extended thinking) |
| `research`       | gemini-2.5-pro + Tavily | perplexity-sonar-pro                  |
| `video_analysis` | gemini-2.5-pro          | gemini-2.5-flash                      |
| `chat`           | claude-sonnet-4-6       | gemini-2.5-flash                      |
| `image`          | fal/nano-banana         | fal/flux-pro                          |
| `music`          | fal/stable-audio        | suno-v4                               |
| `video_gen`      | fal/seedance-2          | fal/kling                             |

If a provider returns an error, Pantheon retries with the fallback automatically. The developer sees one seamless response.

---

## API Specification

### Base URL

```
https://api.pantheon.ai/v1
```

### API Key Types

| Key prefix  | Purpose                          | Credits charged |
| ----------- | -------------------------------- | --------------- |
| `pk_live_`  | Production key (developers)      | Yes             |
| `pk_test_`  | Test key (rate-limited, sandbox) | No              |
| `pk_owner_` | Internal key for Based           | No              |

### Endpoints

#### Layer 1 — OpenAI-compatible

```http
POST /v1/chat/completions
Authorization: Bearer pk_live_...

{
  "model": "pantheon-auto",
  "messages": [{"role": "user", "content": "..."}],
  "stream": true,
  "pantheon": {
    "task_type": "code"   // optional hint — skips classifier
  }
}
```

Response format mirrors OpenAI's `ChatCompletionChunk` for streaming and `ChatCompletion` for non-streaming. Drop-in compatible.

#### Layer 1b — Anthropic-compatible (Claude Code drop-in)

Claude Code uses the Anthropic Messages API format (`/v1/messages`), not OpenAI's. Pantheon implements this format so any developer using Claude Code in VSCode can point it at Pantheon with a single environment variable:

```bash
# In terminal or VSCode settings / .env
ANTHROPIC_BASE_URL=https://api.pantheon.ai
ANTHROPIC_API_KEY=pk_live_...
```

From that point, their Claude Code session routes through Pantheon's brain — their hard bugs go to Opus, their math to DeepSeek, their large file analysis to Gemini. They pay in Pantheon credits.

```http
POST /v1/messages
Authorization: Bearer pk_live_...

{
  "model": "claude-sonnet-4-6",   // or "pantheon-auto"
  "max_tokens": 4096,
  "messages": [{"role": "user", "content": "..."}],
  "stream": true
}
```

Response mirrors Anthropic's `MessageStreamEvent` format exactly. All Claude model names map transparently:

- `claude-opus-*` → Pantheon routes as `task_type: code`
- `claude-sonnet-*` → Pantheon routes as `task_type: chat`
- `claude-haiku-*` → Pantheon routes as `task_type: chat` (fast/cheap path)
- `pantheon-auto` → full classifier runs

#### Layer 2 — Native Pantheon (generative media + research)

```http
POST /v1/generate
{
  "task_type": "music",
  "prompt": "Upbeat lo-fi hip hop, 90 BPM, study vibes",
  "options": { "duration": 30 }
}

POST /v1/generate
{
  "task_type": "image",
  "prompt": "Cyberpunk cityscape at night, neon reflections",
  "options": { "aspect_ratio": "16:9", "model": "nano-banana" }
}

POST /v1/generate
{
  "task_type": "video_gen",
  "prompt": "Cinematic drone shot over Kuala Lumpur at sunset"
}
```

Response:

```json
{
  "id": "gen_abc123",
  "task_type": "music",
  "status": "completed",
  "output": {
    "url": "https://...",
    "duration": 30,
    "format": "mp3"
  },
  "credits_used": 90,
  "provider": "fal/stable-audio"
}
```

```http
POST /v1/research
{
  "query": "Latest advances in quantum computing 2026",
  "depth": "deep"
}
```

`depth: "quick"` = single model pass. `depth: "deep"` = multi-step: web search → extract → synthesize → cite. Deep research costs more credits.

#### Utility

```http
GET /v1/models           // list all available task_types and their models
GET /v1/credits          // { balance: 450, used_this_month: 550 }
POST /v1/credits/topup   // redirects to Stripe checkout
```

---

## VSCode Extension — Pantheon for VSCode

A first-party VSCode extension that embeds Pantheon's full routing intelligence directly in the editor. Separate from the Claude Code compatibility layer — this is the premium native experience.

### Capabilities

| Feature              | Description                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Chat panel           | Sidebar WebView — chat with Pantheon, context-aware of open files                                                 |
| Inline completions   | Ghost text suggestions as you type (like Copilot). Routes to Opus for complex code, Sonnet for simple completions |
| Selection actions    | Select code → right-click → "Explain", "Refactor", "Add tests", "Fix bug"                                         |
| File context         | Automatically includes active file + relevant imports in every request                                            |
| Math mode            | Detects math/algorithm problems → routes to DeepSeek R1 automatically                                             |
| Research panel       | Run a Pantheon `/v1/research` query from inside the editor                                                        |
| Multi-file awareness | Reads workspace symbol index for large codebase questions                                                         |

### Extension architecture

```
VSCode Extension (TypeScript)
├── src/
│   ├── extension.ts         — activation, command registration
│   ├── PantheonClient.ts    — calls api.pantheon.ai, manages API key
│   ├── ChatPanel.ts         — WebView sidebar chat UI
│   ├── InlineProvider.ts    — InlineCompletionItemProvider
│   ├── ContextBuilder.ts    — assembles file context for requests
│   └── commands/
│       ├── explain.ts
│       ├── refactor.ts
│       ├── addTests.ts
│       └── fixBug.ts
└── package.json             — VSCode extension manifest
```

### Auth flow

On first use, the extension prompts for a Pantheon API key. Key stored in VSCode's `SecretStorage` (OS keychain). Users without a key are offered a link to sign up at `pantheon.ai` (100 free credits on signup).

### Routing inside the extension

The extension passes `task_type` hints directly — no classifier overhead needed since editor context makes intent clear:

- Inline completion → `task_type: code` (fast path, Sonnet)
- "Fix bug" command → `task_type: code` (Opus — quality matters here)
- "Explain" command → `task_type: chat` (Sonnet — speed matters)
- Research panel → `task_type: research` (Gemini + Tavily)
- Math/algorithm file detected → `task_type: math` (DeepSeek R1)

### Published to VS Code Marketplace

Extension ID: `pantheon-ai.pantheon-vscode`  
Requires: Pantheon API key (`pk_live_` or `pk_test_`)

---

## Credit System

**Pricing:** $10 = 1,000 credits. Credits never expire.

| Task            | Upstream cost | Pantheon price       | Margin |
| --------------- | ------------- | -------------------- | ------ |
| chat            | ~$0.003       | 5 credits ($0.005)   | ~40%   |
| code (Opus)     | ~$0.015       | 25 credits ($0.025)  | ~40%   |
| math (DeepSeek) | ~$0.005       | 10 credits ($0.010)  | ~50%   |
| research (deep) | ~$0.020       | 35 credits ($0.035)  | ~43%   |
| image           | ~$0.003       | 8 credits ($0.008)   | ~60%   |
| music (30s)     | ~$0.050       | 90 credits ($0.090)  | ~44%   |
| video_gen       | ~$0.100       | 180 credits ($0.180) | ~44%   |

Free tier: 100 credits on signup (no card required).

Billing flow: Stripe Checkout → webhook → Supabase credit ledger → immediate balance update.

---

## Tech Stack

Pantheon is a standalone Next.js App Router project, deployed separately from Based.

| Layer              | Technology                                                     |
| ------------------ | -------------------------------------------------------------- |
| API                | Next.js 16 App Router (TypeScript)                             |
| Auth               | Supabase Auth                                                  |
| Database           | Supabase Postgres (users, API keys, credit ledger, usage logs) |
| Cache / Rate limit | Redis (Upstash)                                                |
| Payments           | Stripe (Checkout + webhooks)                                   |
| Streaming          | Server-Sent Events (SSE) — unified across all providers        |
| Hosting            | Vercel                                                         |
| Docs               | `docs.pantheon.ai` — static site                               |
| VSCode Extension   | TypeScript, VS Code Extension API, WebView                     |

---

## Based Integration

Based gets a `pk_owner_` key stored in its `.env.local`. The existing `app/api/generate/route.ts` calls Pantheon instead of Claude/Gemini directly. All routing intelligence automatically benefits Based users. Based's C/G toggle is retired — Pantheon handles provider selection transparently.

```
Before: Based → Claude API (+ Gemini fallback)
After:  Based → Pantheon API → best model per task
```

---

## Phased Build Plan

### Phase 1 — MVP (weeks 1–6)

- New repo: `pantheon-api/`
- API gateway: Supabase auth, API key generation/validation, rate limiting via Redis
- Provider adapters: Claude, Gemini, DeepSeek R1, FAL.ai
- Intent classifier (Haiku-powered)
- OpenAI-compatible `/v1/chat/completions`
- Native `/v1/generate` for image + music
- Credit system: Stripe Checkout, webhook, ledger, per-call deduction
- Owner key wired into Based
- Minimal developer dashboard: key management, balance, usage graph

### Phase 2 — Full God Roster + VSCode (weeks 7–16)

- Add Suno, Perplexity, OpenAI GPT-4o adapters
- `/v1/research` endpoint (multi-step web search + synthesis)
- Anthropic-compatible `/v1/messages` endpoint (Claude Code drop-in)
- Unified streaming improvements
- Memory layer: session context stored per API key in Redis
- Public docs site
- **Pantheon VSCode Extension v1**: chat panel, selection actions (explain/refactor/fix/test), API key auth
- **VSCode Extension v2**: inline completions, file context, math mode routing
- Publish to VS Code Marketplace
- Public launch (Product Hunt, dev communities)

### Phase 3 — Pantheon Model (months 6–18)

- Fine-tune Llama 3.1 70B or Qwen 2.5 72B on RunPod GPU (~$1–3/hr)
- Training data: curated code, writing, reasoning — sourced from Pantheon usage logs (anonymised, opt-in)
- Replace Claude Sonnet on `chat` + `writing` tasks with `pantheon-v1`
- Blend: own model for general text, specialist APIs for math/video/music
- `model: "pantheon-v1"` becomes the default for text tasks
- Text task margins grow from ~40% to ~85% (no upstream cost)

---

## Success Criteria

**Phase 1 done when:**

- A developer can sign up, get an API key, and make a successful `/v1/chat/completions` call
- Based is wired to Pantheon's owner key and routing works
- Stripe purchase flow works end to end
- Credits deduct correctly per call

**Phase 2 done when:**

- All 8 task types route correctly
- `/v1/research` returns cited multi-source answers
- Claude Code users can point `ANTHROPIC_BASE_URL` at Pantheon and it works
- VSCode extension is published on the Marketplace and installs cleanly
- Public docs are live
- First 10 external developers using the API

**Phase 3 done when:**

- `pantheon-v1` passes a blind quality eval vs Claude Sonnet on chat/writing tasks
- Based and Pantheon both default to `pantheon-v1` for text

---

## Notes

- Pantheon's model is the long-term moat. The orchestration layer is the business model while the model is built.
- Music, image, and video generation stay on FAL/Suno indefinitely — generative media requires hardware and data that can't be replicated alone.
- The fine-tuning path (Phase 3) requires GPU rental budget. Revenue from Phase 1/2 funds this.
- Domain: `pantheon.ai` (check availability) or `usepantheon.ai` / `getpantheon.dev`

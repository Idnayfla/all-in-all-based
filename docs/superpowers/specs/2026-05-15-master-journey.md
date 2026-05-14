# All in All Based — Master Journey

**Last updated:** 2026-05-15  
**Creator:** Mohamad Hus Alfyandi Bin Mohamed Tahir  
**Vision:** Personal AI dev studio → public SaaS → AI orchestration platform

---

## Current State (as of 2026-05-15)

| Layer | Status |
|-------|--------|
| Based web app | Live — Phase 2 complete |
| Auth + cloud storage | ✅ Done (Phase 1) |
| Design system | ✅ Done (Phase 2) |
| Gemini fallback + C/G toggle | ✅ Done |
| PWA foundation | ✅ Partial (manifest, SW, icons — gaps remain) |
| Pantheon API | 🔄 Bootstrap only (Task 1 of 18) |

---

## Based — Product Roadmap

### Phase 1 — Auth + Cloud Storage ✅ COMPLETE

| Feature | Status |
|---------|--------|
| Email + password login | ✅ Done |
| GitHub OAuth | ✅ Done |
| Google OAuth | ✅ Done |
| Forgot password / email reset | ✅ Done |
| Supabase DB — projects, memory, settings | ✅ Done |
| Cross-device sync | ✅ Done |
| LocalStorage migration on first login | ✅ Done |

---

### Phase 2 — Custom Design System ✅ COMPLETE

| Feature | Status |
|---------|--------|
| Design token system (50+ tokens) | ✅ Done |
| Typography scale (--fs-2xs → --fs-hero) | ✅ Done |
| Spacing + radius + shadow scales | ✅ Done |
| Framer Motion — panels, sidebar, chat | ✅ Done |
| Light / Dark / OLED mode | ✅ Done |
| Accent color + custom font selection | ✅ Done |
| Theme persistence to Supabase | ✅ Done |
| Memory chip UI | ✅ Done |
| Component polish (buttons, inputs, empty states) | ✅ Done |
| Splash screen + personality panel | ✅ Done |
| Gemini fallback + bidirectional C/G toggle | ✅ Done |
| useScreenCapture hook | ✅ Done |

---

### Phase 3 — Mobile App 🔄 IN PROGRESS

**Strategy:** PWA-first (no app store required), then Capacitor wrapper for stores.

| Feature | Status | Notes |
|---------|--------|-------|
| PWA manifest + service worker | ✅ Done | manifest.json, sw.js, ServiceWorkerInit |
| Safe area insets (notch/Dynamic Island) | ⬜ Todo | `env(safe-area-inset-*)` CSS |
| Install prompt UI | ⬜ Todo | In-app "Add to Home Screen" banner |
| iOS splash screens | ⬜ Todo | `apple-touch-startup-image` per device |
| SW update notification | ⬜ Todo | "New version available" toast |
| Maskable icon (Android adaptive) | ⬜ Todo | Regenerate with safe-zone padding |
| Welcome audio on launch | ⬜ Todo | Dramatic jingle on app open |
| Voice activation ("Based, …") | ⬜ Todo | Web Speech API trigger |
| Ambient AI companion | ⬜ Todo | Floating button, always-accessible |
| Desktop app | ⬜ Todo | Electron / Tauri wrapper |

---

### Phase 4 — App Store + Play Store ⬜ TODO

| Feature | Status | Notes |
|---------|--------|-------|
| iOS App Store submission | ⬜ Todo | Requires Apple Dev account ($99/yr) |
| Android Play Store submission | ⬜ Todo | TWA or Capacitor wrapper ($25 one-time) |
| Privacy policy + terms of service | ⬜ Todo | Required for store review |
| App Store screenshots + listing copy | ⬜ Todo | |

---

### Phase 5 — Subscriptions ⬜ TODO

| Feature | Status | Notes |
|---------|--------|-------|
| Stripe integration | ⬜ Todo | Checkout + webhooks |
| Pricing tiers (Free / Pro / Studio) | ⬜ Todo | |
| Feature gating per tier | ⬜ Todo | Video gen, music AI, export |
| Billing portal (upgrade / cancel) | ⬜ Todo | |
| Trial period support | ⬜ Todo | |

---

### Phase 6 — Public Release Infrastructure ⬜ TODO

| Feature | Status | Notes |
|---------|--------|-------|
| Production hosting (Vercel Pro / AWS) | ⬜ Todo | |
| CDN + monitoring + error tracking | ⬜ Todo | Sentry |
| Rate limiting per user/tier | ⬜ Todo | |
| Usage metering (FAL credits, AI tokens) | ⬜ Todo | |
| Status page | ⬜ Todo | |
| Public launch | ⬜ Todo | After Phase 5 |

---

### Phase 7 — Real-Time Data Tools ⬜ TODO

| Feature | Status | Notes |
|---------|--------|-------|
| Web search (Tavily / Brave Search) | ⬜ Todo | Claude tool_use integration |
| Weather, news, stock/crypto data | ⬜ Todo | |
| Personal device data access | ⬜ Todo | |

---

### Phase 8 — Document Export ⬜ TODO

| Feature | Status | Notes |
|---------|--------|-------|
| PDF export (pdf-lib / Puppeteer) | ⬜ Todo | |
| Word/Docx export | ⬜ Todo | |
| Excel/XLSX export | ⬜ Todo | |
| PowerPoint/PPTX export | ⬜ Todo | |

---

### Phase 9 — Music AI ⬜ TODO

| Feature | Status | Notes |
|---------|--------|-------|
| Text-to-music generation | ⬜ Todo | FAL music models / Suno API |
| Audio player card in chat | ⬜ Todo | Like GeneratedVideoCard |
| Download generated tracks | ⬜ Todo | |

---

### Phase 10 — Memory Tab Redesign ✅ MERGED INTO PHASE 2

| Feature | Status |
|---------|--------|
| Per-user memory storage | ✅ Done (Supabase `user_settings.global_memory`) |
| Chip-based UI | ✅ Done (merged into Phase 2) |

---

### Phase 11 — Advanced Game & Web Engine ⬜ TODO

| Feature | Status | Notes |
|---------|--------|-------|
| 3D game generation (Three.js / Babylon.js) | ⬜ Todo | |
| Physics engine (Cannon.js / Rapier) | ⬜ Todo | |
| Multi-section landing pages + GSAP | ⬜ Todo | |
| Game architecture planner (Haiku) | ⬜ Todo | |
| Extended file budget (15–30 files) | ⬜ Todo | |

---

## Pantheon — AI Orchestration Platform

**Tagline:** All the gods. One API.  
**Concept:** Route every request to the best model per task type. One key, one bill.  
**Long-term goal:** Replace Claude Sonnet with a proprietary `pantheon-v1` model (fine-tuned Llama/Qwen) to compress margins from ~40% to ~85% on text tasks.

### Phase 1 — MVP Orchestration API 🔄 IN PROGRESS

**Repo:** `pantheon-api/` (standalone Next.js 16, separate from Based)

| Task | Status |
|------|--------|
| Project bootstrap (Next.js + Vitest) | ✅ Done |
| Supabase schema (api_keys, credits, usage_logs) | ⬜ Todo |
| API key generation + validation | ⬜ Todo |
| Credit ledger (atomic deduction) | ⬜ Todo |
| Redis rate limiting (sliding window) | ⬜ Todo |
| Shared adapter types | ⬜ Todo |
| Claude adapter (streaming) | ⬜ Todo |
| Gemini adapter (streaming) | ⬜ Todo |
| DeepSeek R1 adapter | ⬜ Todo |
| FAL.ai adapter (image/music/video) | ⬜ Todo |
| Intent classifier (Haiku-powered) | ⬜ Todo |
| Router with automatic fallback | ⬜ Todo |
| Edge middleware (auth + rate limit gate) | ⬜ Todo |
| `/v1/chat/completions` (OpenAI-compatible) | ⬜ Todo |
| `/v1/generate` (native media endpoint) | ⬜ Todo |
| Stripe credit top-up + webhook | ⬜ Todo |
| Based integration (owner key wired in) | ⬜ Todo |
| Full test suite + Vercel deploy | ⬜ Todo |

**Phase 1 done when:** developer signs up → gets API key → makes a `/v1/chat/completions` call → credits deduct → Based is routed through Pantheon.

---

### Phase 2 — Full God Roster + VSCode Extension ⬜ TODO

| Feature | Notes |
|---------|-------|
| Suno, Perplexity, OpenAI GPT-4o adapters | |
| `/v1/research` (multi-step web search + synthesis) | |
| Anthropic-compatible `/v1/messages` (Claude Code drop-in) | |
| Memory layer (session context per API key in Redis) | |
| Public docs site (`docs.pantheon.ai`) | |
| Pantheon VSCode Extension v1 (chat panel, selection actions) | |
| VSCode Extension v2 (inline completions, file context, math mode) | |
| Publish to VS Code Marketplace | |
| Public launch (Product Hunt, dev communities) | |

---

### Phase 3 — Pantheon Model (`pantheon-v1`) ⬜ TODO

| Feature | Notes |
|---------|-------|
| Fine-tune Llama 3.1 70B or Qwen 2.5 72B on RunPod GPU | ~$1–3/hr |
| Training data from anonymised Pantheon usage logs | Opt-in |
| Replace Claude Sonnet on chat/writing tasks | Text margins: ~40% → ~85% |
| `model: "pantheon-v1"` as default for text tasks | |

**Requires:** Revenue from Phase 1/2 to fund GPU compute.

---

## Routing Table (Pantheon)

| task_type | Primary model | Fallback |
|-----------|--------------|---------|
| `code` | claude-opus-4-7 | claude-sonnet-4-6 |
| `writing` | claude-sonnet-4-6 | gemini-2.5-flash |
| `chat` | claude-sonnet-4-6 | gemini-2.5-flash |
| `math` | deepseek-reasoner | claude-sonnet-4-6 |
| `research` | gemini-2.5-pro | perplexity-sonar-pro |
| `video_analysis` | gemini-2.5-pro | gemini-2.5-flash |
| `image` | fal/nano-banana | fal/flux-pro |
| `music` | fal/stable-audio | suno-v4 |
| `video_gen` | fal/seedance-2 | fal/kling |

---

## Build Order (Overall)

| Priority | What | Why |
|----------|------|-----|
| Now | Based Phase 3 (PWA + voice + ambient) | Existing product, real users, tangible |
| Next | Based Phase 4–5 (stores + subscriptions) | Monetisation before opening to public |
| Then | Based Phase 6 (public release) | Revenue unlocks Pantheon build budget |
| After | Pantheon Phase 1–2 | Funded by Based revenue, replaces Based's direct API calls |
| Long-term | Pantheon Phase 3 (own model) | Margins compound, moat deepens |

---

## Key Decisions Made

- **PWA-first for mobile** — no app store needed immediately; Capacitor wrapper adds stores later
- **Gemini as fallback, not primary** — Claude is primary; Gemini activates on error or user toggle
- **Pantheon after Based has users** — no point building orchestration infra with zero traffic
- **Phase 10 (memory redesign) merged into Phase 2** — already shipped as chip UI
- **Pantheon model (Phase 3) funded by Phase 1/2 revenue** — can't build it without GPU budget

---

## Credentials Needed (not stored here)

- Supabase project URL + keys (Based + Pantheon — separate projects)
- Upstash Redis (Pantheon rate limiting)
- Anthropic API key
- Google Gemini API key
- DeepSeek API key
- FAL.ai key
- Stripe secret + publishable key
- Apple Developer account ($99/yr) — for App Store
- Google Play Developer account ($25) — for Play Store

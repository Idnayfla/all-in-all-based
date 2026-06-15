# Jarvis Standard — Based Architecture Plan

> Status: PLANNED — not started. Waiting on go-ahead.

## Goal

Always-on ambient AI. Constantly aware, remembers everything, acts without being asked, controls the environment, costs near zero to run.

---

## Model Stack (cost-first)

Anthropic stays for one job only — app generation. Everything else routes away.

| Job | Model | Cost | Notes |
|-----|-------|------|-------|
| Companion chat | Groq `llama-3.3-70b-versatile` | Free (500K tok/day) | Already wired as planner fallback |
| Companion overflow | Cerebras `llama-3.3-70b` | Free (1M tok/day) | 2,600 tok/s — near-instant |
| Hard reasoning | Deepseek R1 | $0.14/1M tokens | GPT-4 level, fraction of cost |
| Vision (screen/camera) | Gemini Flash 2.0 | $0.075/1M + free vision | Native multimodal |
| Local (offline/fast) | Ollama `llama3.2:3b` | $0 | Sub-100ms simple responses |
| App generation only | Claude Opus 4.8 | Pay per use | Only fires in Studio mode |
| STT | Deepgram Nova-3 + Groq Whisper | Near free | Done |
| TTS | Modal F5-TTS | Near free | Done |

---

## What Needs to Be Built

### 1. Multi-model Router
Single function routing by request type. Companion → Groq. Vision → Gemini. Complex reasoning → Deepseek R1. Offline → Ollama. Cuts companion API cost to near zero immediately.

**Files:** `lib/modelRouter.ts`, changes to `app/api/companion/route.ts`

### 2. Ambient Vision Loop
Background loop captures screen + camera frame every N seconds. Compressed rolling buffer. Based references what it sees without being asked.

**Files:** `app/companion/page.tsx` (new vision capture loop), `app/api/companion/route.ts` (accept vision context)

### 3. Proactive Engine
Based initiates unprompted. Background ticker checks: time, user idle state, calendar, recent context. Speaks first when conditions met — reminders, observations, check-ins.

**Files:** New `lib/proactiveEngine.ts`, Electron main process integration

### 4. Long-term Vector Memory
Supabase pgvector for semantic recall across months. Stores embeddings of past conversations, user facts, preferences. Recalls "that thing from three weeks ago" without exact keywords.

**Files:** New `lib/vectorMemory.ts`, migration in Supabase

### 5. System Control via Electron IPC
Based gets hands. Exposes: open app, type text, move mouse, screenshot, adjust volume, lock screen, read clipboard. Computer Use without Anthropic cost.

**Files:** `electron/main.js` (new IPC handlers), `lib/systemControl.ts`

### 6. Multi-language Support
User sets preferred language in their getbased.dev / beta.getbased.dev profile settings. Companion responds in that language. STT `language` param switches on Deepgram and Groq (both support it natively). System prompt prepends language instruction. UI strings follow the same setting.

**Files:** `app/api/companion/route.ts` (read user language pref, inject into system prompt + STT call), `app/api/stt/route.ts` (accept `language` param), settings page on getbased.dev

### 7. Mic Input Profile — External vs Headset vs Built-in
External USB/condenser mic, close-field headset mic, and built-in laptop mic all have different sensitivity. Detect the active audio device label on mount and map it to a threshold profile: higher RMS for external mic (more ambient pickup), lower for headset (close-field, directional), mid for built-in. User can also manually pick in settings.

**Files:** `app/companion/page.tsx` (device detection on mic init, threshold lookup), optional settings UI

### 8. Sensor Fusion Layer
Unified context object prepended to every request: current screen, last camera frame, active app, time, calendar events, recent messages, mood state.

**Files:** `lib/sensorFusion.ts`, integration in companion route

### 9. Mood + State Inference
Behavioral signals (typing speed, mic silence duration, time of day, recent topics) → lightweight state model → sets Based's tone.

**Files:** `lib/moodEngine.ts`

---

## Phases

### Phase 1 — Now ✓ DONE
- Companion → Groq (free) → Cerebras (free) → Anthropic Sonnet fallback
- Opus reserved for app generation only
- Desktop Ollama **skipped** — Groq/Cerebras already faster and zero risk to desktop bot

### Phase 2 — Mac Mini M4 Pro 48GB (S$2,899)
- Trigger: Based API costs hit S$150+/month consistently
- Move Discord bot from desktop → Mac Mini
- Run Qwen2.5 72B locally (fits in 48GB unified memory at 4-bit)
- Replace Anthropic for all agent work
- Local Whisper for STT — no more cloud audio
- Vector memory goes live
- Tailscale for remote access from anywhere

### Phase 3 — Jarvis
- Ambient vision loop + screen control
- Proactive engine (Based speaks first)
- System control via Electron IPC
- Sensor fusion (screen + camera + calendar + mood)
- Based VS Code extension (see below)
- Based is always watching, always aware, speaks first when it matters

---

## Build Order

1. ~~Multi-model router~~ ✓ shipped
2. Long-term vector memory ← biggest UX gap vs Jarvis
3. Proactive engine ← the moment it stops feeling like a chatbot
4. Ambient vision loop + screen control
5. System control (Electron IPC)
6. Multi-language support
7. Mic input profiles (external / headset / built-in)
8. Sensor fusion + mood engine
9. **Based for VS Code** ← platform expansion

---

## Based for VS Code

Claude has Claude Code. Based gets Based for VS Code.

**What it does:**
- Sidebar panel: Based companion lives inside VS Code — chat, voice, Hey Based wake word
- Code-aware: reads the open file, selected code, terminal output, errors as automatic context
- Generation: trigger Based's app generator from inside the editor — output lands directly in workspace files
- Inline suggestions: Based proposes edits, user accepts/rejects like Copilot
- Screen awareness: sees what's on screen without user pasting code manually
- Agent mode: "fix this bug" → Based reads the error, finds the file, proposes the edit

**How it's built:**
- VS Code Extension API (TypeScript) — same language as the rest of Based
- Webview panel for the companion UI (reuse existing companion React component)
- Language Server Protocol (LSP) for inline suggestions
- Connects to getbased.dev API — same backend, new client surface
- Published to VS Code Marketplace + Open VSX (for Cursor, Windsurf, etc.)

**Why this matters:**
- Claude Code is CLI-first, developer-only
- Based for VS Code targets the same developers who already use the web app
- Companion + generation + voice in one editor panel = Jarvis in the IDE
- Distribution: VS Code has 17M+ users — Marketplace is a growth channel

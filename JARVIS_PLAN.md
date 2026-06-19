# Jarvis Standard — Based Architecture Plan

> Status: Phase 1 & 2 COMPLETE. Phase 3 starts when Mac Mini arrives.

## Goal

Always-on ambient AI. Constantly aware, remembers everything, acts without being asked, controls the environment, costs near zero to run.

---

## Model Stack (cost-first)

Anthropic stays for one job only — app generation. Everything else routes away.

| Job                    | Model                          | Cost                    | Status                |
| ---------------------- | ------------------------------ | ----------------------- | --------------------- |
| Companion chat         | Groq `llama-3.3-70b-versatile` | Free (500K tok/day)     | ✅ Live               |
| Companion overflow     | Cerebras `llama-3.3-70b`       | Free (1M tok/day)       | ✅ Live               |
| Hard reasoning         | Deepseek R1                    | $0.14/1M tokens         | ⬜ Phase 3            |
| Vision (screen/camera) | Gemini Flash 2.0               | $0.075/1M + free vision | ✅ Live               |
| Local (offline/fast)   | Ollama `llama3.2:3b`           | $0                      | ⬜ Phase 3 (Mac Mini) |
| App generation only    | Claude Opus 4.8                | Pay per use             | ✅ Live               |
| STT                    | Deepgram Nova-3 + Groq Whisper | Near free               | ✅ Live               |
| TTS                    | Modal F5-TTS                   | Near free               | ✅ Live               |

---

## What Was Built

### ✅ 1. Multi-model Router

Groq → Cerebras → Anthropic Sonnet fallback for text. Gemini 2.0 Flash for vision.
**Files:** `lib/companionRouter.ts`

### ✅ 2. Long-term Vector Memory

Gemini text-embedding-004 (768-dim, free). `match_memories` Supabase RPC with cosine similarity (threshold 0.72). Fire-and-forget extraction via Haiku after every conversation.
**Files:** `lib/vectorMemory.ts`

### ✅ 3. Proactive Engine

`proactive` param triggers unprompted initiation — Based opens with one warm, specific line based on time of day + user memories. Idle-state detection wired in companion.
**Files:** `app/api/companion/route.ts` (lines 483–491)

### ✅ 4. Ambient Vision Loop

`ambientFrameRef` auto-captures screen every N seconds in background. Compressed for payload size. Sent alongside every message as implicit context — Based sees what's on screen without user sharing manually.
**Files:** `app/companion/page.tsx` (`ambientFrameRef`, `compressAmbient`)

### ✅ 5. System Control via Electron IPC

Based has hands: `system:launch-app`, `system:type-text`, `system:clipboard-read/write`, `system:get-volume`, `system:set-volume`, `system:get-active-app`.
**Files:** `electron/main.js` (lines 401–701)

### ✅ 6. Multi-language Support

`language` param read from companion request. `LANG_NAMES` lookup. Injected into system prompt — Based responds fully in user's chosen language. STT language param follows same setting.
**Files:** `app/api/companion/route.ts` (lines 668–686)

### ✅ 7. Mic Input Profiles

`MicProfile` type (`auto | built-in | headset | external | mobile | custom`). Device label detection (Yeti, Rode, AirPods, Jabra, etc.). RMS + VAD thresholds per profile. Persisted in localStorage.
**Files:** `app/companion/page.tsx` (`MicProfile`, `applyMicProfile`)

### ✅ 8. Mood + State Inference

`moodSignals` (latency, avgLength, sessionMinutes, shortStreak) sent from client. Based adjusts tone based on inferred state — quick replies = busy, long silence = distracted.
**Files:** `app/api/companion/route.ts` (lines 623–650), `app/companion/page.tsx`

---

## Phases

### Phase 1 — ✅ COMPLETE

- Companion → Groq (free) → Cerebras (free) → Anthropic Sonnet fallback
- Opus reserved for app generation only
- Long-term vector memory with Gemini embeddings
- Ambient vision loop + mic profiles + mood signals

### Phase 2 — ✅ COMPLETE

- Proactive engine (Based speaks first)
- System control via Electron IPC
- Multi-language support
- Sensor fusion layer (screen + mood + calendar + tasks in every request)

### Phase 3 — Mac Mini M4 Pro (S$2,899)

- Trigger: Based API costs hit S$150+/month consistently
- Move Discord bot from desktop → Mac Mini
- Run Qwen2.5 72B locally (fits in 48GB at 4-bit) — replace Anthropic for all agent work
- Deepseek R1 for hard reasoning
- Local Whisper STT — no more cloud audio
- Tailscale for remote access

---

## Build Order

1. ~~Multi-model router~~ ✅ shipped
2. ~~Long-term vector memory~~ ✅ shipped
3. ~~Proactive engine~~ ✅ shipped
4. ~~Ambient vision loop~~ ✅ shipped
5. ~~System control (Electron IPC)~~ ✅ shipped
6. ~~Multi-language support~~ ✅ shipped
7. ~~Mic input profiles~~ ✅ shipped
8. ~~Mood + state inference~~ ✅ shipped
9. **Based for VS Code** ← next platform expansion

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

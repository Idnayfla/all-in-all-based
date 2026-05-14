# All in All Based

Personal AI dev studio. Users chat with "Based" (Claude-powered) and get generated HTML/JS/CSS apps rendered in a live preview panel.

**Creator:** Mohamad Hus Alfyandi Bin Mohamed Tahir  
**Stack:** Next.js 16 App Router, TypeScript, Anthropic SDK, Redis (memory)

## Environment Setup

Claude Code defaults to your **Claude.ai Pro/Max subscription** (no API credits consumed).

If starting a new terminal session, activate it with:
```powershell
. $PROFILE
```

Provider options:
- `use-subscription` — Claude.ai Pro/Max (default, no fallback)
- `use-anthropic` — Anthropic API (pay as you go, no fallback)
- `use-gemini` — Gemini (primary with Claude fallback for reliability)

**Gemini Setup:** Gemini requires a free API key from [Google AI Studio](https://aistudio.google.com). Get your key and add it to your PowerShell profile as `$GEMINI_API_KEY`.

## Key Files

| File | Purpose |
|------|---------|
| `app/api/generate/route.ts` | Main generation pipeline — planner → per-file generator → summary |
| `app/api/memory/route.ts` | Redis-backed memory extraction (uses Haiku) |
| `app/page.tsx` | Main shell — header, sidebar, panel switcher |
| `components/ChatPanel.tsx` | Chat UI, streaming render, progress bar |
| `components/Sidebar.tsx` | Project and file list |
| `app/globals.css` | All styling, design tokens |

## Generation Pipeline (route.ts)

Three-step flow for code requests:
1. **Planner** (`haiku`) — outputs JSON file plan sized to complexity
2. **File generator** (`opus`) — generates each file individually, streams chunks
3. **Summary** (`haiku`) — 1-2 sentence reply

Non-code chat uses `sonnet`. `sanitizeHTML()` post-processes all HTML before sending to client (adds `defer`, injects button safety net).

## Rules

- **Fix only the broken file** — never rewrite working files to fix one bug
- Prompt rules are unreliable for structural guarantees — use server-side post-processing (`sanitizeHTML`) instead
- Always state root cause before fixing, state what changed after

## Model Guide

| Task | Model |
|------|-------|
| Questions, explanations | sonnet |
| CSS / styling tweaks | sonnet |
| Small fixes (1-2 files, clear bug) | sonnet |
| Discussing approach / planning | sonnet |
| New feature from scratch | opus |
| Complex multi-file changes | opus |
| Hard bug you've been stuck on | opus |
| Changes to `generate/route.ts` logic | opus |

## Model Equivalents (Gemini Fallback)

When Gemini fallback is used, Claude models map to Gemini equivalents:

| Claude | Gemini |
|--------|--------|
| claude-opus-4-7 (generator) | gemini-2.0-flash |
| claude-sonnet-4-6 | gemini-1.5-flash |
| claude-haiku-4-5 (planner/summary) | gemini-1.5-flash |

Fallback is transparent — user sees a message in chat when Gemini is used.

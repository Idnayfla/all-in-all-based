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

Claude Code provider options (this terminal, not the webapp):

- `use-subscription` — Claude.ai Pro/Max (default)
- `use-anthropic` — Anthropic API (pay as you go)

## Key Files

| File                        | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `app/api/generate/route.ts` | Main generation pipeline — planner → per-file generator → summary |
| `app/api/memory/route.ts`   | Redis-backed memory extraction (uses Haiku)                       |
| `app/page.tsx`              | Main shell — header, sidebar, panel switcher                      |
| `components/ChatPanel.tsx`  | Chat UI, streaming render, progress bar                           |
| `components/Sidebar.tsx`    | Project and file list                                             |
| `app/globals.css`           | All styling, design tokens                                        |

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

## Agent System

Seventeen agents (16 specialists + 1 orchestrator) defined in `.claude/agents/`.

### Single-agent invocation

```
[Agent: Architect]          — system design, scalability, cost modeling
[Agent: Product]            — roadmap, specs, prioritization
[Agent: Designer]           — design system, layouts, brand
[Agent: Growth]             — copy, SEO, launch, onboarding
[Agent: QA]                 — test plans, bug triage, release gate
[Agent: DevOps]             — infra, cost per user, monitoring
[Agent: Security]           — auth audit, API security, OWASP
[Agent: Chief of Staff]     — decisions log, changelog, roadmap status
[Agent: Senior Engineer]    — deep bug diagnosis, generation pipeline, surgical fixes
[Agent: Mobile]             — PWA, service workers, iOS/Android, app store submissions
[Agent: Data Analyst]       — PostHog, funnels, retention, A/B testing, metrics
[Agent: Legal]              — privacy policy, ToS, GDPR/PDPA, compliance
[Agent: Community]          — feedback synthesis, Discord, support triage, changelog comms
[Agent: Finance]            — MRR, unit economics, Stripe, API cost modelling, pricing
[Agent: Technical Writer]   — API docs, user guides, error messages, CHANGELOG entries
[Agent: AI Engineer]        — prompt architecture, model selection, pipeline optimisation
```

### Multi-agent workflows (Orchestrator coordinates all)

```
[Workflow: New Feature]     — Product → Architect → Designer → Dev → QA → DevOps → Chief of Staff
[Workflow: Bug Fix]         — Senior Engineer diagnoses → fixes → QA verifies → Chief of Staff
[Workflow: Beta → Stable]   — QA gate → Product → Security → DevOps → Growth → Chief of Staff
[Workflow: Architecture]    — Architect → Security + DevOps (parallel) → Chief of Staff
[Workflow: Weekly Review]   — Chief of Staff → Product → DevOps
[Workflow: Security Audit]  — Security → Architect → DevOps → Chief of Staff
```

See `.claude/agents/WORKFLOWS.md` for full step definitions.  
Without a prefix: **Full-Stack Engineer** mode (code, bugs, features).

### Tracking documents

- `DECISIONS.md` — every significant decision with rationale
- `CHANGELOG.md` — user-facing record of what shipped

## Quality Gate (local)

```bash
npm run check          # typecheck + lint + format check (all three)
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm run format         # Prettier write
npm run format:check   # Prettier check only
```

CI runs automatically on every push to `dev` and `main` via `.github/workflows/ci.yml`:

- TypeScript check → ESLint → Prettier check → Build

## Model Guide

Default model is **Sonnet** (fast, cost-efficient). Automatically switch to **Opus 4.8** for quality-critical tasks using the `Skill` tool — no user action needed.

- Auto-switch to Opus: invoke `Skill("build")` at the start of the task
- Return to Sonnet: invoke `Skill("fix")` at the start of the task

| Task                                 | Model                           |
| ------------------------------------ | ------------------------------- |
| Questions, explanations              | sonnet                          |
| CSS / styling tweaks                 | sonnet                          |
| Small fixes (1-2 files, clear bug)   | sonnet                          |
| Discussing approach / planning       | sonnet                          |
| New feature from scratch             | **auto-invoke** `/build` (Opus) |
| Complex multi-file changes           | **auto-invoke** `/build` (Opus) |
| Hard bug you've been stuck on        | **auto-invoke** `/build` (Opus) |
| Changes to `generate/route.ts` logic | **auto-invoke** `/build` (Opus) |

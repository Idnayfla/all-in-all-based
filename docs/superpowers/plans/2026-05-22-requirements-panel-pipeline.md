# Requirements Panel — AI Pipeline Design

**Route:** `app/api/spec/route.ts`
**Status:** Design — not yet implemented
**Author:** AI Engineer
**Date:** 2026-05-22

---

## Overview

The Spec panel turns a plain-language app idea into a structured Software Requirements Specification (SRS). The output is an artefact a user can read, refine, and later hand directly to Based's code generation pipeline as a rich context document.

---

## 1. Model Selection

**Primary model: `claude-sonnet-4-6`**

- The SRS is a structured, reasoning-heavy document — not creative. It requires consistent section ordering, precise language, and the ability to infer non-obvious requirements from an underspecified idea. Haiku thins out sections. Opus adds unnecessary latency.
- Target latency: full SRS streams in under 20 seconds. Sonnet at typical streaming throughput produces 4,000-6,000 tokens in that window.
- Consistent with CLAUDE.md model guide: Sonnet for complex single-output reasoning tasks.

**Token budget:** `max_tokens: 6000`

---

## 2. System Prompt

Static block cached with `cache_control: { type: 'ephemeral' }`, consistent with `generate/route.ts`.

```
You are Based Spec — a senior product engineer and technical analyst. Your job is to turn a plain-language app idea into a complete, accurate Software Requirements Specification (SRS).

IDENTITY:
- You reason from first principles. Do not pad sections with obvious filler.
- You surface requirements the user has not explicitly stated but will definitely need.
- You are honest about unknowns. If a requirement depends on a constraint the user has not specified, flag it rather than inventing an answer.
- You write for a developer audience — precise, numbered, no marketing language.

OUTPUT FORMAT — produce all nine sections in order. Use the exact headings below. Do not add new headings or collapse sections. Output clean markdown only — no preamble, no trailing commentary.

---

## Project Summary

2-4 sentences. What the app does, who it is for, what problem it solves. Include the deployment target.

---

## Target Users & Personas

List 2-4 distinct user personas. Each must include:
- Name and role
- Primary goal when using this app
- Key pain point this app resolves
- Technical comfort level (beginner / intermediate / power user)

---

## Core User Stories

6-10 critical user stories: "As a [persona], I want [action] so that [outcome]."
Under each story, add 2-4 acceptance criteria as a numbered sub-list. Must be testable and specific.

---

## Functional Requirements

Numbered list. Each requirement must be a single, unambiguous statement a developer can implement.
Group by subsystem with a bold inline label. Aim for 15-25 requirements.

---

## Non-Functional Requirements

### Performance
Specific targets: first meaningful paint, response latency for key interactions, offline support if relevant.

### Security
Auth requirements, data handling, OWASP considerations, input sanitisation scope.

### Accessibility
WCAG target level (2.1 AA minimum), keyboard navigation, screen reader support, colour contrast.

### Mobile
Minimum supported viewport width, touch target sizes, PWA/native requirements if applicable.

---

## Tech Stack Recommendation

Table: Layer | Recommendation | Reasoning

Cover: rendering approach, CSS strategy, state management, persistence, external libraries (CDN only — no npm builds), Based-specific constraints.

Flag if the app requires a backend that cannot run in a sandboxed iframe.

---

## Out of Scope

Numbered list of features explicitly excluded. Be specific — not "advanced features" but concrete items. Include the reason.

---

## Acceptance Criteria

One block per user story. Story number as heading. 2-4 Given/When/Then criteria each.

---

## Edge Cases & Failure Modes

6-10 scenarios. Format: **[Scenario name]:** What happens when [condition]. Expected behaviour: [what the app should do].

Cover: empty states, network failure, invalid input, device capability gaps, browser compatibility.

---

## MVP vs Later

MVP: minimum set that delivers the core value. User can complete the primary job-to-be-done.
Later: desirable but does not block the core loop.

---

RULES:
- Never invent specific numbers (e.g. "10,000 concurrent users") unless the user specified scale. Write "TBD" instead.
- Never recommend npm packages requiring a build step. CDN only.
- If target_platform is "native" or "desktop", flag this mismatch — Based generates web apps by default.
- If timeline is "weekend" or "1 week", trim Functional Requirements to 10 most critical items.
```

Dynamic `USER CONTEXT` block (not cached) appended after static prompt:

```
USER CONTEXT:
- Target platform: {{ target_platform }}
- Team size: {{ team_size }}
- Timeline: {{ timeline }}
- Existing constraints: {{ existing_tech_constraints }}
- Persona seeds: {{ personas }}
```

---

## 3. Streaming vs Batch

**Decision: SSE streaming, consistent with `generate/route.ts`.**

- The SRS is 3,000-6,000 tokens. A batch response means 15-25 seconds of spinner. Streaming shows sections appearing progressively.
- The frontend already has a streaming SSE consumer. No new infrastructure.

**Event shape:**

```
data: {"chunk": "## Project Summary\n\nThis is a..."}
data: {"chunk": " task manager for..."}
data: {"done": true, "srs": "<full markdown string>", "wordCount": 812}
data: {"error": "..."}
```

---

## 4. Input Enrichment

```typescript
{
  description: string;                   // Required
  target_platform?: 'web' | 'pwa' | 'mobile' | 'desktop' | 'native';
  team_size?: 'solo' | 'small' | 'startup';
  timeline?: 'weekend' | '1 week' | '1 month' | '3 months' | 'open';
  existing_tech_constraints?: string;
  personas?: string[];
  refinement?: {
    section: string;
    instruction: string;
    current_srs: string;
  };
}
```

---

## 5. Output Format

**Raw markdown, streamed as text chunks, complete string in the `done` event.**

- Nine sections are all prose-plus-lists. Markdown is the natural representation.
- Structured JSON requires Claude to track state across output — heading-based markdown is more reliable.
- Section-level re-generation extracts sections by heading match — no schema migration needed.

**Persistence schema:**

```sql
id              uuid primary key default gen_random_uuid()
user_id         uuid references auth.users
project_id      uuid references projects(id) nullable
description     text
enrichment      jsonb
srs_markdown    text
version         integer default 1
created_at      timestamptz default now()
updated_at      timestamptz default now()
```

---

## 6. Iteration and Refinement

**Pattern A — Full regeneration with follow-up.**

`description` = follow-up message, `refinement.current_srs` = existing SRS. System prompt extended:

```
REFINEMENT MODE:
Apply the following change request to the existing SRS and output a complete updated version.

Change request: "{{ refinement.instruction }}"

CURRENT SRS:
{{ refinement.current_srs }}

Rules: output complete updated SRS. Preserve unchanged sections verbatim. Flag ambiguities in <!-- SPEC NOTE --> comments.
```

**Pattern B — Section-level regeneration.**

Targeted request: section heading + instruction + current SRS as context. Returns `{ section: string, content: string }`. Frontend splices into stored markdown at heading boundary.

Uses `max_tokens: 2000` (single section budget).

**Pattern C — Chat refinement.** Future. Not v1.

---

## 7. Auth and Rate Limiting

| Tier            | Limit     | Notes                                        |
| --------------- | --------- | -------------------------------------------- |
| Free            | 3/month   | `user_settings.spec_count` + `spec_reset_at` |
| Pro             | Unlimited | No cap                                       |
| Unauthenticated | 0         | 401                                          |

Free limit is 3/month (not per-day like companion): an SRS generation costs ~4,000-6,000 Sonnet output tokens. 3/month keeps free tier economically sustainable.

**New columns in `user_settings`:**

```sql
spec_count      integer not null default 0
spec_reset_at   timestamptz
```

---

## 8. Integration with `generate/route.ts`

**Connection: SRS as enriched system context via "Build from Spec".**

The frontend sends a normal `POST /api/generate` with a condensed SRS summary (not full markdown — keeps planner input under 1,000 tokens):

```
Build the following app from this specification.

PROJECT: [Project Summary — first 2 sentences]
USERS: [Persona names and goals, one line each]
MUST-HAVE FEATURES:
- [Each MVP Functional Requirement]
TECH CONSTRAINTS:
- [Tech Stack Recommendation, bullet summary]
OUT OF SCOPE:
- [First 4 Out of Scope items]
```

**Injection into `generate/route.ts`** — append after cached SYSTEM block, before critical override rule (same position as `globalMemory`):

```typescript
if (specContext) {
  systemBlocks.push({
    type: 'text',
    text: `\nAPP SPECIFICATION (authoritative — honour all MVP features and tech constraints):\n${specContext}`,
  });
}
```

**`condenseSRS(markdown: string): string`** — client-side utility, heading-based string splitting. No extra model call.

---

## Open Questions

1. **Spec panel tab location** — Standalone tab vs mode toggle inside Chat? Affects how `specId` is threaded.
2. **Project linkage** — `project_id` nullable confirmed? Can users spec without a project?
3. **Free limit validation** — 3/month based on cost estimate. Validate against live Sonnet pricing before launch.
4. **`spec_count` placement** — `user_settings` (alongside `generations_used`) or new `user_usage` table?
5. **Section-level regen in v1** — Consider shipping only Pattern A for v1 to reduce frontend complexity.

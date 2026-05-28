# Requirements Panel — "Spec"

**Date:** 2026-05-22
**Status:** Approved — ready for implementation
**Owner:** Mohamad Hus Alfyandi Bin Mohamed Tahir
**Implementors:** Senior Engineer + Designer

---

## 1. Overview

The Spec panel is a dedicated requirements-gathering workspace inside Based. It sits alongside Chat, Editor, Preview, Video, Studio, Image, Notes, and 3D as a first-class tab in the app shell.

**Problem it solves:** Users arrive at Based with a vague idea — "I want an app that tracks my habits" — and immediately ask Based to start building. The result is a half-baked app that misses the real intent. The user asks for changes, Based rebuilds, and they spend five iterations converging on something they could have defined in two minutes.

The Spec panel breaks that loop. Before writing a line of code, the user defines what they actually want. Based transforms that fuzzy input into a structured, export-ready Software Requirements Specification. That document then seeds the generate pipeline so the very first build is directionally correct.

**Who it's for:** Primarily non-technical users who have an idea but cannot translate it into technical language. Secondarily, technical users who want to front-load thinking and skip the back-and-forth correction loop.

---

## 2. User Flow

1. User opens the Spec tab. They see an empty input area with the prompt: "Describe your app idea. Don't filter — the messier the better."
2. User types (or speaks) their idea in plain language. No formatting required. One sentence or ten paragraphs both work.
3. User presses "Generate Spec." Based shows a skeleton loading state section by section as the document streams in.
4. The full SRS document appears in the right pane. Each section is collapsed by default; the user expands and reads.
5. The user edits any section inline by clicking into it.
6. User clicks "Build from Spec." Based extracts the functional requirements and tech stack recommendation, injects them into the generate pipeline as the project brief, and switches to the Chat panel with a pre-filled prompt. The user hits send to start building.
7. Optionally, user clicks "Save to Notes" or "Copy as Markdown."

Total time from idea to a spec ready to build: under 90 seconds for a typical app idea.

---

## 3. Input Modes

**3.1 Free text (primary)** — A plain multi-line textarea. No character limit enforced in the UI. Server strips anything beyond 4,000 tokens before sending to the model to control cost.

**3.2 Voice input** — Tap the microphone icon to record. Audio is sent to `/api/transcribe` (existing Whisper endpoint). The transcript lands in the textarea for the user to review before generating. Voice is not streamed directly into spec generation — the user must confirm the transcript first.

**3.3 Import from chat history (v1.1, not MVP)** — A button "Import from current chat" reads the last N messages of the active project conversation and pre-fills the textarea with a summary of what the user has been trying to build. Helps users who already have a half-built project and want to formalise requirements retroactively.

---

## 4. Output — SRS Document Structure

Every generated spec contains exactly these nine sections in this order. The model must not add sections or change headings. All sections are required; none may be omitted.

**4.1 Project Summary** — One paragraph (3–5 sentences). Restates the idea in clear, unambiguous language. Confirms the core problem, the solution, and the primary user.

**4.2 Target Users and Personas** — Two to three distinct personas. Each has: name, age/role label, one-sentence description, primary pain point, and the one thing they need this app to do well. Four lines per persona.

**4.3 Core User Stories** — Minimum five, maximum twelve stories. Format: "As a [persona], I want [capability], so that [outcome]." Each story is one line.

**4.4 Functional Requirements** — Numbered list. Each requirement is a single, testable statement beginning with a verb: "Display," "Allow," "Notify," "Store," "Validate." Target 10–20 requirements. Each requirement maps to at least one user story (reference by story number in parentheses).

**4.5 Non-Functional Requirements** — Three fixed sub-sections: Performance (specific numeric targets), Security (auth model, data sensitivity, storage approach), Accessibility (minimum WCAG AA, app-specific considerations).

**4.6 Tech Stack Recommendation** — Table: Layer / Recommendation / Reason. Minimum six rows: frontend framework, styling, data storage, auth, hosting, AI provider. Reasoned against the functional requirements. Based defaults to Next.js, Supabase, Tailwind, Anthropic unless a requirement rules one out.

**4.7 Out of Scope** — Bullet list of features a reader might assume are included but are not. Minimum three items. Prevents scope creep during implementation.

**4.8 Acceptance Criteria** — One block per user story from 4.3. Each block has the story number as heading and 2–4 Given/When/Then criteria beneath it.

**4.9 Edge Cases and Failure Modes** — Numbered list. Each item states: the edge condition, what happens if unhandled, and the recommended handling. Minimum five items.

---

## 5. Editing

The generated document is fully editable inline. Every section renders in a lightweight contenteditable area. No separate "edit mode" toggle — clicking any text places the cursor immediately.

Changes are auto-saved to a `spec TEXT` column on the `projects` table in Supabase. Debounce: 1,500 ms after the last keystroke. No manual save button.

Section-level regeneration: a "↺ Regenerate" icon appears on hover at the top-right of each section. Streams a new version. Previous version is preserved in one-level undo (Cmd/Ctrl+Z). Regeneration sends only that section's heading, the original user input, and the project summary + functional requirements as context — not the full spec.

---

## 6. Export and Integration

**6.1 "Build from Spec" (primary CTA)** — Extracts functional requirements (4.4) and tech stack (4.6). Constructs a structured prompt and injects it into the chat input. Switches to Chat panel. The user must confirm and hit send — Based does not auto-send.

**6.2 Save to Notes** — Copies the full spec as a new note. Title: "[App name] — Spec [date]."

**6.3 Copy as Markdown** — One-click copy of the entire spec as clean markdown.

**6.4 Share link (v1.1)** — Read-only public URL via existing `/api/share` route. Pro only.

**6.5 Project attachment** — One spec per project. When a project is active, the Spec tab reflects the saved spec for that project, not a blank state.

---

## 7. AI Model and Prompt Approach

**Model:** `claude-sonnet-4-6`

Rationale: Spec generation is a structured document task. Opus adds latency and cost with negligible quality difference on structured output. Haiku lacks reasoning quality for tech stack selection and edge case identification. Sonnet is the correct choice.

**System prompt:**

```
You are a senior software architect. Transform the user's app idea into a complete,
structured Software Requirements Specification.

Output exactly these nine sections in this order using these exact headings:
1. Project Summary
2. Target Users and Personas
3. Core User Stories
4. Functional Requirements
5. Non-Functional Requirements
6. Tech Stack Recommendation
7. Out of Scope
8. Acceptance Criteria
9. Edge Cases and Failure Modes

Rules:
- Be specific. Replace vague adjectives with numbers and conditions.
- Tech stack defaults to Next.js, Supabase, Tailwind, Anthropic. State reasoning when deviating.
- Out of Scope must contain at least three items.
- Acceptance criteria must use Given/When/Then format.
- Do not add sections beyond the nine listed.
- Do not add preamble or meta-commentary. Output only the document.
```

**Streaming:** Response streams section by section. Client renders each section as it arrives and collapses it on completion.

**Context sent:** System prompt + user's raw input (trimmed to 4,000 tokens) + current date. No chat history, no memory, no project files. The Spec panel is deliberately isolated from the generation pipeline on input, intentionally coupled on output via "Build from Spec."

---

## 8. Monetisation

| Feature                         | Free       | Pro       |
| ------------------------------- | ---------- | --------- |
| Generate spec                   | 3 per day  | Unlimited |
| Edit inline                     | Yes        | Yes       |
| Build from Spec                 | Yes        | Yes       |
| Save to Notes                   | Yes        | Yes       |
| Copy as Markdown                | Yes        | Yes       |
| Regenerate individual sections  | 1 per spec | Unlimited |
| Share link (v1.1)               | No         | Yes       |
| Import from chat history (v1.1) | No         | Yes       |

Rate limit: Redis key `spec:daily:{userId}`, limit 3, window 86,400 s. Unauthenticated users: 1 per session. On limit hit, show Pro upsell modal.

---

## 9. Success Metrics

| Metric                        | Target at 30 days                          | Measurement                                             |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| Spec-to-Build conversion      | > 40%                                      | `spec_generated` → `spec_build_clicked` funnel          |
| First-build quality (proxy)   | < 2 follow-up messages vs unspecced builds | Avg messages after spec-seeded build                    |
| Spec completion rate          | > 85%                                      | `spec_generation_started` vs `spec_generation_complete` |
| Daily active spec users       | > 15% of DAU                               | Unique users with `spec_panel_opened`                   |
| Pro conversion from limit hit | > 8% within 7 days                         | `spec_limit_hit` → `subscription_started`               |

If Spec-to-Build conversion is below 30% at day 14: spec output is too long or too formal. Fix: add a "Quick Spec" mode (summary + user stories + functional requirements only).

---

## 10. MVP Scope

**v1 — Ships:**

- Free-text input
- Voice input via existing `/api/transcribe`
- Full 9-section SRS generation, Sonnet streaming
- Inline editing, auto-save to Supabase `projects.spec` column
- Section-level regeneration (one undo level)
- "Build from Spec" integration into chat pipeline
- "Save to Notes"
- "Copy as Markdown"
- Free/Pro gating (3/day free, unlimited Pro)
- PostHog instrumentation for all five success metrics
- `'spec'` added to `activePanel` union type in `page.tsx`
- Empty state for projects with no spec yet

**v1.1 — Post-launch:**

- Import from chat history
- Share link (public read-only URL)
- "Quick Spec" mode (3-section abbreviated output)
- Multi-spec per project (version history)
- Spec diff view when regenerating a section

**Out of scope permanently:**

- Spec templates (UI complexity outweighs value)
- Real-time collaborative editing (no multi-user model in Based)
- PDF export (Markdown copy covers the need)
- Jira/Linear/GitHub Issues sync (belongs in Pantheon, not Based core)

---

## 11. Technical Implementation Notes

**New API route:** `POST /api/spec/generate`. Accepts `{ input: string, projectId?: string }`. Validates auth. Checks Redis daily limit via existing `_mediaRateLimit.ts` pattern. Calls Sonnet with the system prompt above. Returns SSE stream. On completion, if `projectId` is provided, persists raw markdown to `projects.spec` in Supabase.

**Database migration:** Add `spec TEXT` column to `projects` table. Nullable, no default. Additive only.

**Component:** `SpecPanel.tsx` in `/components`. Receives `currentProject`, `user`, `authToken` as props — same pattern as `NotesPanel.tsx`.

**Tab registration:** Add `'spec'` to the `activePanel` type union in `page.tsx`. Tab label: "Spec." Insert between `'notes'` and `'3d'` in tab order and swipe navigation.

**Rate limiting:** Reuse `_mediaRateLimit.ts` pattern. Key: `spec:daily:{userId}`, limit 3, window 86,400 s.

**"Build from Spec" coupling rule:** Injects text into the chat input via a lifted callback prop from `page.tsx` — same pattern as other cross-panel actions. Do not couple `SpecPanel` to `ChatPanel` internals directly.

**Fix-only-broken-file rule applies in full:** Do not modify `ChatPanel.tsx`, `generate/route.ts`, or any file not listed above beyond the minimal additions described here.

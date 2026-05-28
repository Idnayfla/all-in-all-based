# Requirements Panel — Design Spec

**Date:** 2026-05-22
**Status:** Ready for implementation
**Panel name:** Spec
**Tab label:** Spec

---

## Layout — Desktop

Two-column split. 38% input / 62% output.

```
┌─────────────────────────────────────────────────────────────────┐
│  ◈ Spec                                          [↺ New Spec]   │
├────────────────────────┬────────────────────────────────────────┤
│                        │                                        │
│  DESCRIBE YOUR IDEA    │  ## Project Summary                   │
│  ┌──────────────────┐  │  ▸ (collapsed, click to expand)       │
│  │                  │  │                                        │
│  │  Free text area  │  │  ## Target Users & Personas           │
│  │                  │  │  ▸ (collapsed)                        │
│  │                  │  │                                        │
│  └──────────────────┘  │  ## Core User Stories                 │
│                        │  ▾ (expanded)                         │
│  [◉ Voice]             │    As a habit tracker...              │
│                        │                                        │
│  Platform:  [Web ▾]    │  ## Functional Requirements           │
│  Timeline:  [···]      │  ▸ (collapsed)                        │
│                        │                                        │
│  [◈ Generate Spec  →]  │  ## Non-Functional Requirements       │
│                        │  ▸ (collapsed)                        │
│  ────────────────────  │                                        │
│  [⬡ Build from Spec]   │  ## Tech Stack Recommendation        │
│  [· Save to Notes   ]  │  ▸ (collapsed)                        │
│  [· Copy Markdown   ]  │                                        │
│                        │  ## Out of Scope                      │
│                        │  ▸ (collapsed)                        │
│                        │                                        │
│                        │  ## Acceptance Criteria               │
│                        │  ▸ (collapsed)                        │
│                        │                                        │
│                        │  ## Edge Cases & Failure Modes        │
│                        │  ▸ (collapsed)                        │
│                        │                                        │
└────────────────────────┴────────────────────────────────────────┘
```

---

## Layout — Mobile

Stacked vertically. Input collapses once spec is generated.

```
┌──────────────────────────────┐
│  ◈ Spec              [↺ New] │
├──────────────────────────────┤
│  DESCRIBE YOUR IDEA     [▾]  │  ← collapsible after generation
│  ┌────────────────────────┐  │
│  │  Free text...          │  │
│  └────────────────────────┘  │
│  [◉ Voice]  [Web ▾]          │
│  [◈ Generate Spec →]         │
├──────────────────────────────┤
│  ## Project Summary      ▸   │
│  ## Target Users         ▸   │
│  ## User Stories         ▾   │
│    As a habit tracker...     │
│    ──── [↺ Regenerate] ────  │
│  ## Functional Req       ▸   │
│  ## Non-Functional       ▸   │
│  ## Tech Stack           ▸   │
│  ## Out of Scope         ▸   │
│  ## Acceptance Criteria  ▸   │
│  ## Edge Cases           ▸   │
├──────────────────────────────┤
│  [⬡ Build from Spec] [· Copy]│  ← fixed bottom bar
└──────────────────────────────┘
```

---

## Component Tree

```
SpecPanel                          (components/SpecPanel.tsx)
  spec-root
    spec-input-col
      spec-input-header
        spec-input-title           "Describe your idea"
        spec-input-collapse-btn    (mobile only — collapses after generation)
      spec-textarea                (free text, auto-resize)
      spec-voice-btn               (◉ Voice — calls /api/transcribe)
      spec-chips-row
        spec-chip                  Platform: [Web ▾]
        spec-chip                  Timeline: [···]
      spec-generate-btn            ◈ Generate Spec →
      spec-divider
      spec-actions
        spec-action-build          ⬡ Build from Spec
        spec-action-notes          · Save to Notes
        spec-action-copy           · Copy Markdown
    spec-output-col
      spec-output-empty            (empty state — no spec yet)
        spec-empty-icon            ◈
        spec-empty-title
        spec-empty-body
      spec-output-generating       (skeleton loading state)
        spec-skeleton-section × 3
      spec-output-doc              (generated spec)
        spec-section × 9
          spec-section-header
            spec-section-symbol    (◈ ⬡ ◉ ⊙ → · —)
            spec-section-title
            spec-section-toggle    ▾ / ▸
            spec-section-regen     ↺ (hover-only, section regenerate)
          spec-section-body        (contenteditable, inline edit)
  spec-bottom-bar                  (mobile fixed bottom — Build + Copy)
```

---

## SRS Section Symbols

| #   | Section                     | Symbol |
| --- | --------------------------- | ------ |
| 1   | Project Summary             | ◈      |
| 2   | Target Users & Personas     | ⬡      |
| 3   | Core User Stories           | ◉      |
| 4   | Functional Requirements     | →      |
| 5   | Non-Functional Requirements | ⊙      |
| 6   | Tech Stack Recommendation   | ·      |
| 7   | Out of Scope                | —      |
| 8   | Acceptance Criteria         | ◈      |
| 9   | Edge Cases & Failure Modes  | ⬡      |

---

## UI States

### 1. Empty (no spec generated)

Input column fully visible. Output column shows empty state centred:

- Symbol: `◈` at 48px, color: `var(--text3)`
- Title: "Your spec will appear here"
- Body: "Describe your app idea on the left — Based will write a full software requirements document."
- No CTA button (the generate button is in the input column)

### 2. Generating

Input column dims to 50% opacity, disabled. Output column shows skeleton sections streaming in:

- Three skeleton bars per section placeholder
- Each bar: `var(--bg3)` background, `border-radius: var(--r-md)`, subtle pulse animation (`spec-skeleton-pulse`)
- Sections appear one by one as streaming completes each
- Status line at top of output col: "◈ Writing your spec..." with blinking cursor

### 3. Generated

All nine sections rendered as accordion items. First section (Project Summary) auto-expands. Rest collapsed. Each section:

- Header: symbol + title + toggle chevron + hover-reveal ↺ regen button
- Body: contenteditable div with `spec-section-body` class, `outline: none`, cursor changes to text on hover
- Clicking anywhere in body = immediate edit
- Auto-save debounce: 1,500ms, status dot in panel header goes grey → green on save

### 4. Refining (section-level regenerate)

User clicks ↺ on a section:

- Section body fades to 40% opacity
- Inline input appears above body: small textarea pre-filled with "Rewrite this section focusing on..." placeholder
- Two buttons: [↺ Regenerate] and [✕ Cancel]
- On Regenerate: streams new content into the body, replaces old
- Undo: `Cmd/Ctrl+Z` restores previous content (one level only)
- The section-level regen sends: section heading + original user input + sections 1 and 4 as context

---

## CSS Class Inventory

| Class                         | Purpose                                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| `.spec-root`                  | Flex row container (columns side by side desktop, column mobile) |
| `.spec-input-col`             | Left column, flex-shrink-0, width 38%                            |
| `.spec-output-col`            | Right column, flex 1, overflow-y auto                            |
| `.spec-input-header`          | Title row above textarea                                         |
| `.spec-input-title`           | "Describe your idea" label, mono, text3                          |
| `.spec-input-collapse-btn`    | Mobile only — toggles input col height                           |
| `.spec-textarea`              | Main idea input, auto-resize, no resize handle                   |
| `.spec-voice-btn`             | ◉ Voice record button                                            |
| `.spec-chips-row`             | Horizontal row of optional context chips                         |
| `.spec-chip`                  | Single chip button (Platform, Timeline)                          |
| `.spec-chip.active`           | Selected chip state                                              |
| `.spec-generate-btn`          | Primary CTA — full-width, accent gradient                        |
| `.spec-generate-btn:disabled` | Greyed while generating                                          |
| `.spec-divider`               | Thin separator line between generate and actions                 |
| `.spec-actions`               | Stack of secondary action buttons                                |
| `.spec-action-build`          | ⬡ Build from Spec — outlined, accent                             |
| `.spec-action-notes`          | · Save to Notes — ghost                                          |
| `.spec-action-copy`           | · Copy Markdown — ghost                                          |
| `.spec-output-empty`          | Centred empty state container                                    |
| `.spec-empty-icon`            | Large ◈ symbol                                                   |
| `.spec-empty-title`           | Empty state heading                                              |
| `.spec-empty-body`            | Empty state description                                          |
| `.spec-output-generating`     | Skeleton container during stream                                 |
| `.spec-skeleton-section`      | Single skeleton section placeholder                              |
| `.spec-skeleton-bar`          | Individual shimmer bar                                           |
| `.spec-skeleton-pulse`        | Keyframe animation — opacity 0.4→0.8                             |
| `.spec-status-line`           | "◈ Writing your spec..." status                                  |
| `.spec-cursor`                | Blinking text cursor after status text                           |
| `.spec-output-doc`            | Rendered spec document container                                 |
| `.spec-section`               | Single accordion section wrapper                                 |
| `.spec-section.open`          | Expanded state modifier                                          |
| `.spec-section-header`        | Clickable header row (symbol + title + toggle)                   |
| `.spec-section-symbol`        | Section symbol (◈ ⬡ ◉ etc.)                                      |
| `.spec-section-title`         | Section heading text                                             |
| `.spec-section-toggle`        | ▾ / ▸ chevron                                                    |
| `.spec-section-regen`         | ↺ hover-only regenerate icon                                     |
| `.spec-section-body`          | Contenteditable section content                                  |
| `.spec-section-body:focus`    | Remove outline, keep caret                                       |
| `.spec-regen-panel`           | Inline refine UI within a section                                |
| `.spec-regen-input`           | Refine instruction textarea                                      |
| `.spec-regen-actions`         | Row with [↺ Regenerate] [✕ Cancel]                               |
| `.spec-save-dot`              | Auto-save status indicator (header)                              |
| `.spec-save-dot.saved`        | Green state                                                      |
| `.spec-save-dot.saving`       | Pulsing grey state                                               |
| `.spec-bottom-bar`            | Mobile-only fixed bottom action bar                              |

---

## CSS Variables to Use

| Variable               | Usage                                              |
| ---------------------- | -------------------------------------------------- |
| `var(--bg)`            | Page background                                    |
| `var(--bg2)`           | Panel background                                   |
| `var(--bg3)`           | Input backgrounds, skeleton bars                   |
| `var(--accent)`        | Generate button, active chip, symbol colour        |
| `var(--accent-muted)`  | Accent backgrounds (chip hover, section symbol bg) |
| `var(--text)`          | Primary text                                       |
| `var(--text2)`         | Secondary text, section titles                     |
| `var(--text3)`         | Placeholder text, labels, symbols                  |
| `var(--border)`        | Section dividers, column separator                 |
| `var(--border-subtle)` | Skeleton bar colour                                |
| `var(--r-md)`          | Button border-radius                               |
| `var(--r-lg)`          | Panel border-radius                                |
| `var(--r-xl)`          | Section card border-radius                         |
| `var(--font-mono)`     | Labels, section titles, status text                |

---

## Interaction Details

### Helper chips

`Platform` chip: dropdown — Web / Mobile / Desktop / All  
`Timeline` chip: text input — "2 weeks", "MVP by June", etc.

Chip values append to the generate request as structured context (not shown in textarea). They do not replace free text — they enrich it.

### Copy per section

Each open section has a copy icon (top-right, appears on hover alongside ↺). Copies that section's markdown only.

### Build from Spec

1. Extracts sections 4 (Functional Requirements) and 6 (Tech Stack)
2. Formats as: `"Build this app:\n\n[Project Summary]\n\nRequirements:\n[FR list]\n\nStack: [tech stack]"`
3. Sets as value in chat textarea
4. Switches `activePanel` to `'chat'`
5. Does NOT auto-submit — user reviews and hits send

### Voice input flow

1. Tap ◉ Voice → browser requests mic permission
2. Recording indicator: button pulses, timer shows
3. Tap again to stop → sends to `/api/transcribe`
4. Transcript inserts into textarea at cursor position
5. User edits if needed, then generates

---

## Design Rationale

**Why free text, not a structured form?**  
Forms create anxiety. "What is your target audience?" is harder to answer than "describe your app." The AI handles the structure — the user just needs to dump their thinking.

**Why 62/38 split (output wider)?**  
The spec document is the primary deliverable. Input is transient; the spec is what the user reads, edits, and acts on. Give it the space.

**Why accordion (collapsed by default)?**  
A 9-section document is overwhelming if shown all at once. Accordion gives the user agency to read at their pace. Project Summary auto-expands because it's the validation check — did Based understand my idea?

**Why no "Save" button?**  
Auto-save matches the Notes panel pattern. Users shouldn't think about persistence — it just works.

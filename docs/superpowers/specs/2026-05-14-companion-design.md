# Based Companion — Design Spec

**Date:** 2026-05-14  
**Phase:** 3B — Ambient AI Companion  
**Status:** Approved for implementation

---

## Overview

A persistent, always-accessible chat companion that overlays the existing app as a slide-out drawer. Accessible from any panel (Chat, Editor, Preview, Debug) without switching tabs. Includes explicit screen capture for visual analysis — both in-app preview capture and external screen sharing via `getDisplayMedia`. Designed as a premium, fluid experience with spring physics, living animations, and a streaming response feel.

The companion is scoped to the web app now, with the architecture designed to slot naturally into an Electron/Tauri desktop wrapper in a future phase.

---

## What We're Building

### CompanionDrawer (`components/CompanionDrawer.tsx`)

A 300px wide drawer that slides in from the right edge, overlaying the active panel. It is independent of the project system — it has its own session-only chat context and its own API endpoint.

**Layout (top to bottom):**

1. **Header** — `⬡` icon + "BASED" label + session badge + close button. Gradient background `#12121e → #0e0e1a`. Purple-tinted bottom border.
2. **Messages area** — scrollable. Renders capture cards, user bubbles, and assistant bubbles. Assistant text streams word-by-word with a blinking block cursor while in-flight.
3. **Input area** — two capture buttons row + text input + send button.

**Capture card** (appears in messages when a capture is triggered):

- Purple-tinted border and header label ("📷 Preview captured")
- Thumbnail of the captured content
- A purple scan-line CSS animation sweeps down once on reveal — the "magic moment"
- After scan completes, Based begins streaming its response

**Capture buttons:**

- `📷 Capture preview` — active/highlighted when Preview panel is active, captures the iframe via canvas API (no browser permission prompt)
- `🖥 Share screen` — triggers `getDisplayMedia`, opens browser's screen share picker for any external screen/window/tab

**Message bubbles:**

- User: `rgba(124,58,237,0.15)` background, purple border, right-aligned, `border-radius: 10px 10px 2px 10px`
- Assistant: `#16162a` background, left-aligned, `border-radius: 10px 10px 10px 2px`, streams with blinking cursor

**Surfaces:**

- Drawer background: `#0e0e1a`
- Left border: `1px solid rgba(124,58,237,0.2)` + `box-shadow: -1px 0 32px rgba(124,58,237,0.08)`
- Input area background: `#0c0c18`, separated by `1px solid rgba(124,58,237,0.1)`

**Animation (Framer Motion):**

- Open: `x: 300 → 0`, `opacity: 0 → 1`, spring `{ stiffness: 380, damping: 34 }`
- Close: `x: 0 → 300`, `opacity: 1 → 0`, same spring
- Wrapped in `AnimatePresence` in `page.tsx`

---

### CompanionTrigger (inline in `page.tsx`)

A floating button fixed to the bottom-left corner of the viewport (`position: fixed`, `bottom: 24px`, `left: 24px`). Always rendered, always on top (`z-index: 9999`).

**Visual:**

- 48×48px circle, gradient `linear-gradient(135deg, #7c3aed, #4f46e5)`
- "B" label, `font-weight: 800`
- `box-shadow: 0 4px 20px rgba(124,58,237,0.45)`

**States:**

- **Idle:** Two concentric CSS rings (`border: 1px solid rgba(124,58,237,0.2)`) with a slow breathe animation (`scale 1 → 1.1`, 3s ease-in-out, infinite, staggered 0.5s offset on outer ring)
- **Responding:** Single ring, faster pulse animation (1s), brighter `box-shadow` on core (`rgba(124,58,237,0.7)`)
- **Open:** No rings — drawer is open, trigger acts as close button

Clicking the trigger toggles `showCompanion` state in `page.tsx`.

---

### useScreenCapture (`hooks/useScreenCapture.ts`)

A hook with two exported functions:

```ts
capturePreview(files: FileNode[]): PreviewCapture   // source snapshot of the preview files
captureScreen(): Promise<string | null>              // base64 PNG via getDisplayMedia
```

**`capturePreview`:**

- Takes the current `files` array (already in scope — no DOM access needed)
- Returns a `PreviewCapture` object: `{ html, css, js, label }` — the raw source
- No browser permission prompt, no canvas, no new dependencies
- In `CompanionDrawer`, this source is rendered as a live mini `srcdoc` iframe thumbnail (the scan-line effect plays over it), then passed to the API as formatted code context: ` ```html\n...\n``` `
- Claude sees the actual source — more useful for code analysis than a pixel screenshot

**`captureScreen`:**

- Calls `navigator.mediaDevices.getDisplayMedia({ video: true })`
- Grabs first video frame via an offscreen `<video>` + `<canvas>`
- Stops the stream immediately after capture
- Returns base64 PNG as a data URL, attached to the message as a vision block

Both functions return `null` on failure (permission denied, no files loaded, etc.) — failure is silent, capture button shows a brief error state.

---

### `/api/companion/route.ts`

A lightweight streaming endpoint — not the full planner/generator pipeline. Uses `claude-sonnet-4-6` directly.

**Request body:**

```ts
{
  messages: Array<{ role: 'user' | 'assistant', content: string | ContentBlock[] }>,
  personality: string,
  memory: string,
  screenshot?: string        // base64 PNG data URL from getDisplayMedia, optional
  previewSource?: string     // formatted code string from capturePreview, optional
}
```

**Behavior:**

- Prepends system prompt: personality + global memory (same as main chat, non-code path)
- If `screenshot` is present, attaches it as a vision block to the latest user message
- If `previewSource` is present, prepends it as a code block to the latest user message text
- Only one of `screenshot` / `previewSource` will be set per message (whichever capture mode was used)
- Streams response as SSE text chunks (same `text/event-stream` format as `/api/generate`)
- No planner, no file generation, no summary step

**Auth:** Same `_auth.ts` guard as other routes.

---

## Data Flow

```
User clicks "Capture preview"
  → useScreenCapture.capturePreview()
  → base64 PNG stored in companionMessages state as a ContentBlock
  → capture card renders in messages with scan-line animation
  → user types message + sends
  → POST /api/companion with { messages, personality, memory, screenshot }
  → streams response → word-by-word render with cursor
  → trigger button pulses while isCompanionGenerating === true
```

```
User clicks "Share screen"
  → useScreenCapture.captureScreen()
  → browser shows screen picker (requires user permission)
  → same flow as above after permission granted
```

---

## State (in `page.tsx`)

Two new state variables added to the existing Home component:

```ts
const [showCompanion, setShowCompanion] = useState(false);
const [isCompanionGenerating, setIsCompanionGenerating] = useState(false);
```

`CompanionDrawer` receives: `personality`, `globalMemory`, `activePanel`, `files`, `onClose`, `onGeneratingChange`.

Companion chat history lives inside `CompanionDrawer` as local state — intentionally not persisted to Supabase. Session-only.

---

## Files Changed / Created

| File                             | Change                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `components/CompanionDrawer.tsx` | New — drawer UI + capture buttons + streaming chat                                                |
| `hooks/useScreenCapture.ts`      | New — `capturePreview` + `captureScreen`                                                          |
| `app/api/companion/route.ts`     | New — lightweight sonnet chat endpoint with vision                                                |
| `app/page.tsx`                   | Add `showCompanion`, `isCompanionGenerating` state; render `CompanionTrigger` + `CompanionDrawer` |
| `app/globals.css`                | Add trigger breathe/pulse keyframes + companion surface tokens                                    |

---

## Out of Scope (this phase)

- Persisting companion chat history to Supabase
- Voice activation trigger
- Electron/desktop app wrapper
- Companion chat referencing or editing project files

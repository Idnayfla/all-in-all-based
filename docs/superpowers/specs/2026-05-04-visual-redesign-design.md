# Visual Redesign — All in All Based

**Date:** 2026-05-04  
**Status:** Approved

## Summary

Tidy up the UI to be cleaner, more readable, and more user-friendly. The dark aesthetic stays; the changes reduce visual noise, improve typography hierarchy, and make the app feel more intentional.

---

## Design Decisions

| Decision | Choice |
|---|---|
| Visual direction | Clean & readable — whitespace, hierarchy, minimal chrome |
| Color accents | Purple (`#7c6af7`) for user / active states, teal (`#6af7c8`) for AI / secondary. Pink only for destructive actions (delete). |
| Chat typography | System sans-serif for prose (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`), Space Mono stays for UI labels, buttons, code blocks |
| Approach scope | CSS + component restructure (approach C) |

---

## Changes by Area

### 1. Header (`app/page.tsx` + `globals.css`)

**Current:** Individual nav buttons (CHAT, ✎, ◉, ⚙) with borders; incognito mixed in with panel nav.

**New:**
- Logo area: icon + "BASED" wordmark + project name (separated by a left-border divider)
- Pill tab switcher in the center-right: `Chat | Editor | Preview` as a segmented control in a rounded container (`background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 3px`) with the active tab as a filled pill
- Secondary controls cluster on the far right: incognito button + settings button (both icon-only, borderless on rest, bordered on hover), separated from status by a divider
- Status dot (●) + "Ready" / "Generating..." text stays, moved to the rightmost position

### 2. Chat messages (`components/ChatPanel.tsx` + `globals.css`)

**Current:** Both user and assistant messages are full-width boxes with background + border + border-radius.

**New:**
- Remove the box entirely — no background, no border-radius
- Left border accent: `border-left: 2px solid` — purple (`rgba(124,106,247,0.5)`) for user, teal (`rgba(106,247,200,0.4)`) for Based
- Padding: `2px 0 2px 18px`
- Role label: `font-size: 10px; letter-spacing: 2px; font-family: var(--font-mono); margin-bottom: 6px` — purple for user, teal for Based. Simplified text: `YOU` and `BASED` (no symbols)
- Message prose: `font-size: 14px; line-height: 1.8; font-family: system-ui, sans-serif` — `var(--text)` for user, slightly muted (`#c0c0d8`) for Based
- Code blocks inside messages: stay monospace, keep existing dark background + border styling
- Gap between messages: `24px`

### 3. Chat input (`globals.css`)

- Textarea border-radius: `8px`
- Placeholder text: `"Ask Based anything..."` (updated in `ChatPanel.tsx`)
- Input background: `var(--bg2)` (slightly lighter than current `var(--bg3)`)
- Top border on input area: `1px solid` using a slightly lighter shade (`#1e1e2a`) for a softer separator

### 4. Welcome / empty state (`components/ChatPanel.tsx` + `globals.css`)

**Current:** Large `⬡` symbol at low opacity, "ALL IN ALL BASED" heading, typo in subtitle ("Making your life easier is what matter."), monospace suggestion chips.

**New:**
- Icon: a small rounded square with a gradient background (`linear-gradient(135deg, rgba(124,106,247,0.25), rgba(106,247,200,0.15))`) and a subtle border — replaces the large symbol
- Title: `BASED` in Space Mono, `font-weight: 700; letter-spacing: 3px; font-size: 16px`
- Subtitle: `"Your AI coding assistant. Describe what you want to build."` in system sans-serif, `font-size: 14px; color: var(--text3); line-height: 1.7`
- Suggestion chips: `font-family: system-ui; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; padding: 7px 14px; background: transparent` — hover gets `border-color: var(--accent)`

### 5. No-project landing screen (`app/page.tsx` + `globals.css`)

**Current:** Same icon + "Welcome to Based" heading.

**New:** Consistent with the empty chat state — same icon treatment, "BASED" wordmark, subtitle `"Open a project or start a new one."`, single `+ New Project` CTA button.

### 6. Sidebar (`components/Sidebar.tsx` + `globals.css`)

**Current:** Items have `border-left: 2px solid transparent` already but active uses accent background.

**New:**
- Active project: `border-left-color: var(--accent)` (purple) + very subtle background `rgba(124,106,247,0.08)`
- Active file: `border-left-color: var(--accent3)` (teal) + `rgba(106,247,200,0.06)` background
- Section header labels: `letter-spacing: 3px; font-size: 10px; color: var(--text3)` — keep current style, just ensure consistent 16px top padding
- Section divider: `1px solid #1e1e2a` with `margin: 0 12px` (inset, not full-width)
- Delete action button hover: `color: #f76a8a` (pink — only place pink appears)

### 7. Color cleanup (`globals.css`)

- Remove pink (`var(--accent2)`) from all non-destructive uses
- Status dot when generating: keep `var(--accent3)` (teal)
- `nav-btn.active`: keep purple border + background
- Incognito active state: keep the red/pink border (it's a warning state, appropriate)

---

## Files to Change

| File | Type of change |
|---|---|
| `app/globals.css` | Primary — typography, message styles, header, sidebar, empty states, color cleanup |
| `app/page.tsx` | Header JSX restructure (pill tabs, secondary controls cluster) |
| `components/ChatPanel.tsx` | Message markup (remove box, add border-left), placeholder text, empty state JSX |
| `components/Sidebar.tsx` | Active state class usage (minor, mostly CSS-driven) |

---

## What Does Not Change

- Dark color palette (`--bg`, `--bg2`, `--bg3`, `--border`)
- Space Mono for all UI chrome (labels, buttons, nav, code)
- All animations (message entrance, button hover lifts, logo pulse)
- Editor panel (Monaco editor — untouched)
- Preview panel (iframe — untouched)
- Settings panel (minor spacing inherits from CSS changes, no explicit rework)
- All API routes and logic
- Hamburger button (mobile sidebar toggle) — stays, styling unchanged
- Mobile breakpoints (CSS changes are additive/replacing, not structural)

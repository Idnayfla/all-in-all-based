# Animated Logo — Design Spec

**Date:** 2026-05-07
**Status:** Approved

---

## Overview

Replace the static PNG logo in the app header with a Framer Motion–animated shimmer logo. The logo is fully customizable via a click-to-edit modal and persists settings to localStorage. CSS variables are also written to the component root for developer access.

---

## Decisions

| Decision | Choice |
|---|---|
| Animation style | Shimmer Sweep (light sheen sweeps across icon + text) |
| Animation engine | Framer Motion (added as npm dependency) |
| Customizable properties | Text, icon shape, shimmer color, icon background, speed, shimmer width |
| Settings trigger | Pencil button (✎) that fades in on logo hover → centered modal |
| Persistence | `localStorage` key `logo_config` |

---

## Architecture

**New files:**
- `components/AnimatedLogo.tsx` — animated logo with hover edit trigger
- `components/LogoEditorModal.tsx` — centered modal with all controls + live preview
- `hooks/useLogoConfig.ts` — config state + localStorage read/write

**Modified files:**
- `app/page.tsx` — replace `<img class="logo-img">` + `<span class="logo-text">` with `<AnimatedLogo />`

No other files touched. The rest of the header (hamburger, nav tabs, status, settings gear) is unchanged.

---

## Config Schema

Stored in `localStorage` as `logo_config` (JSON). Default values:

```ts
interface LogoConfig {
  text: string;         // "BASED"
  shimmerColor: string; // "#a89aff"
  iconShape: "bolt" | "diamond" | "hex" | "circle"; // "bolt"
  speed: number;        // 2.8  (seconds per sweep)
  shimmerWidth: number; // 40   (% of element width)
  iconBg: string;       // "#0a0a0f"
}
```

`useLogoConfig` exposes `{ config, setConfig, reset }`. `setConfig` triggers a `localStorage.setItem` write via `useEffect`. `reset` restores all fields to the defaults above.

---

## AnimatedLogo Component

**Layout:** icon (40×40) + text — identical dimensions to the current logo so no header layout shifts.

**Icon:** Inline SVG (no PNG). Four shapes drawn as SVG paths, all fitting a 40×40 viewBox:
- `bolt` — lightning bolt (current icon)
- `diamond` — rotated square
- `hex` — hexagon
- `circle` — filled circle with inner ring

**Shimmer animation:** A `motion.div` absolutely positioned over the full logo width, with a semi-transparent gradient matching `shimmerColor`. It sweeps left-to-right on infinite repeat:

```ts
animate={{ x: ["-100%", "150%"] }}
transition={{
  duration: config.speed,
  repeat: Infinity,
  ease: "easeInOut",
  repeatDelay: 1.2
}}
```

**Edit trigger:** On `onMouseEnter`, a pencil button (`✎`) fades in (Framer Motion `AnimatePresence` + opacity 0→1). Clicking it sets `modalOpen = true`. On `onMouseLeave` (and when modal is open), the button stays visible until the modal closes.

**CSS variables** written on the component's root `div` via `style` prop:
```
--logo-shimmer-color
--logo-speed
--logo-text
--logo-icon-bg
--logo-shimmer-width
```

---

## LogoEditorModal Component

**Backdrop:** `position: fixed; inset: 0; background: rgba(0,0,0,0.6)`. Click outside or press Escape to dismiss without saving.

**Panel:** Centered card, `background: var(--bg3)`, `border: 1px solid var(--border)`, `border-radius: 16px`, `padding: 28px`, max-width 420px.

**Live preview** at the top of the modal — a read-only instance of the shimmer animation reflecting the in-progress (unsaved) edits. Changes to controls update the preview immediately; they do not update the real header logo until Save is clicked.

**Controls:**

| Control | Element | Notes |
|---|---|---|
| Logo text | `<input type="text">` | max 12 chars |
| Icon shape | 4-button pill picker | shows SVG icon + label |
| Shimmer color | 6 preset swatches + `<input type="color">` | swatches: purple, cyan, gold, red, white, green |
| Icon background | 4 preset swatches + `<input type="color">` | swatches: near-black, dark purple, navy, charcoal |
| Animation speed | Range slider, 0.8–4.0s, step 0.1 | labelled Slow ↔ Fast |
| Shimmer width | Range slider, 15–70%, step 5 | labelled Narrow ↔ Wide |

**Footer:** `Save` button (primary) + `Reset to defaults` text link. Reset restores all fields in the preview without closing the modal; Save commits to `useLogoConfig` + closes.

---

## CSS / Styling

All new styles added to `globals.css` using existing class conventions (no CSS modules, no new files). New classes: `.logo-editor-backdrop`, `.logo-editor-panel`, `.logo-edit-btn`, `.logo-preview-wrap`, `.logo-shape-picker`, `.logo-swatch-row`.

The existing `.logo`, `.logo-text`, `.logo-img`, and related classes are removed since `AnimatedLogo` replaces them entirely.

---

## Out of Scope

- Mobile-specific layout changes to the logo
- Exporting the logo as an image
- Per-project logo settings (one global config only)
- Any changes to the PWA manifest icons

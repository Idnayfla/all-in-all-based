# Logo Design Spec — Based

**Date:** 2026-05-09  
**Status:** Approved

## Summary

Replace the placeholder `.chat-empty-logo` gradient box and refine the default logo configuration with the official "Terminal Mark" — a purple-to-teal gradient tile displaying `B>` in Space Mono Bold, paired with a `BASED` wordmark.

## Design

### Icon mark

| Property | Value |
|----------|-------|
| Text | `B>` |
| Font | Space Mono Bold |
| Text color | `#0a0a0f` (--bg) |
| Background | `linear-gradient(135deg, #7c6af7, #6af7c8)` (--accent → --accent3) |
| Border radius (sm / header) | `7px` |
| Border radius (lg / empty state, PWA) | `14px` |

### Wordmark

| Property | Value |
|----------|-------|
| Text | `BASED` |
| Font | Space Mono Bold |
| Color | `#e8e8f0` (--text) |
| Letter spacing | `2–3px` depending on context |

### Usage contexts

| Context | Tile size | Font size | Radius |
|---------|-----------|-----------|--------|
| Header | 30×30px | 11px | 7px |
| Empty state | 56×56px | 22px | 14px |
| PWA icon (192, 512) | Full bleed | proportional | 14px scaled |

## Implementation

### 1. `components/LogoDisplay.tsx`

Add a `terminal` icon shape: a `div` with the gradient background and `B>` text, replacing the SVG icon. No SVG needed — pure CSS/text.

Update the icon rendering block to handle `config.iconShape === 'terminal'` as a special case that skips the SVG and renders the gradient tile with text instead.

### 2. `hooks/useLogoConfig.ts`

Update `LOGO_DEFAULTS`:
- `iconShape: 'terminal'`
- `text: 'BASED'`
- `shimmerWidth: 0` (no shimmer — the gradient tile provides sufficient visual interest)
- Keep `shimmerColor` and `speed` for users who customize

Extend `LogoConfig.iconShape` union type to include `'terminal'`.

### 3. `app/page.tsx` — empty state

Replace:
```tsx
<div className="chat-empty-logo" aria-hidden="true" />
```

With the actual logo mark — import `LogoDisplay` and `LOGO_DEFAULTS` and render a sized version, or inline the terminal tile directly as JSX for simplicity (avoids pulling in the full configurable system into a static context).

Recommended: inline JSX — a `div` with gradient background and `B>` text, sized at 56×56px, plus the `BASED` wordmark below it (already rendered by the existing `no-project-title` div).

### 4. `app/globals.css`

Update `.chat-empty-logo` to match the terminal tile:
- Remove the placeholder gradient
- Set `border-radius: 14px`, `font-family: Space Mono`, `font-size: 22px`, `color: #0a0a0f`
- Set `background: linear-gradient(135deg, var(--accent), var(--accent3))`
- Add `display: flex; align-items: center; justify-content: center; font-weight: 700`

### 5. PWA icons (optional, out of scope for this iteration)

`public/icon-192.png` and `public/icon-512.png` should be updated to match. This requires generating PNG files from the mark — a separate task.

## Out of scope

- Favicon update (separate task)
- PWA icon PNG generation (separate task)
- Logo editor UI changes (the editor already supports custom shapes; `terminal` just becomes the new default)

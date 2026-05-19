# Logo Cleanup Spec

**Date:** 2026-05-09  
**Status:** Approved

## Summary

Remove the logo customisation system entirely. The `B>` Terminal Mark is the official, locked-down logo. No user-facing editor, no localStorage persistence. The header gets a clean static logo component.

## What Gets Removed

| File                             | Action                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| `components/AnimatedLogo.tsx`    | Delete                                                                  |
| `components/LogoEditorModal.tsx` | Delete                                                                  |
| `hooks/useLogoConfig.ts`         | Simplify — remove hook + localStorage, keep `LOGO_DEFAULTS` export only |

## What Gets Simplified

### `hooks/useLogoConfig.ts`

Remove the `useLogoConfig` hook function and the `readStored` function entirely. Keep only:

```ts
export interface LogoConfig {
  /* unchanged */
}

export const LOGO_DEFAULTS: LogoConfig = {
  text: 'BASED',
  shimmerColor: '#a89aff',
  iconShape: 'terminal',
  speed: 2.8,
  shimmerWidth: 0,
  iconBg: '#0a0a0f',
};
```

The `KEY` constant and all localStorage code is removed. The file becomes a pure config module.

### `app/page.tsx`

- Remove `import AnimatedLogo from '@/components/AnimatedLogo'`
- Add `import LogoDisplay from '@/components/LogoDisplay'`
- Add `import { LOGO_DEFAULTS } from '@/hooks/useLogoConfig'`
- Replace `<AnimatedLogo />` (line 155) with `<LogoDisplay config={LOGO_DEFAULTS} />`
- Remove the hamburger-triggered `sidebarOpen` state, overlay div, and hamburger button — these are replaced by the animated sidebar (Spec 2)

### `app/globals.css`

**Remove** these specific blocks (approximately 170 lines total):

- `.animated-logo-root` and its hover state (lines ~673–678)
- `.logo-edit-btn` and `.logo-edit-btn:hover` (lines ~720–738)
- `.logo-editor-backdrop`, `.logo-editor-panel`, `.logo-editor-header`, `.logo-editor-title`, `.logo-editor-close`, `.logo-preview-wrap`, `.logo-editor-controls`, `.logo-editor-label`, `.logo-editor-value`, `.logo-editor-input`, `.logo-shape-picker`, `.logo-shape-btn`, `.logo-shape-btn.active`, `.logo-swatch-row`, `.logo-swatch`, `.logo-color-input`, `.logo-slider-row`, `.logo-editor-slider`, `.logo-slider-cap`, `.logo-editor-footer`, `.logo-reset-link`, `.logo-save-btn` (lines ~745–915)

**Keep** (still used by `LogoDisplay`):

- `.animated-logo-wrap`, `.logo-icon-svg`, `.animated-logo-text` (lines ~679–703)
- `@keyframes logo-shimmer-slide`, `.logo-shimmer` (lines ~706–718)
- Mobile override `.animated-logo-text { font-size: 14px }` inside `@media (max-width: 768px)`

## What Stays

- `components/LogoDisplay.tsx` — unchanged, renders the terminal mark
- `hooks/useLogoConfig.ts` — kept as a config-only module (no hook)
- All `.animated-logo-wrap`, `.logo-icon-svg`, `.animated-logo-text`, shimmer CSS — still used by `LogoDisplay`

## Out of Scope

- Changes to `LogoDisplay.tsx` itself
- Any changes to the empty-state logo (already done in prior work)

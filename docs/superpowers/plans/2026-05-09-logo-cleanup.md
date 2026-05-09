# Logo Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the logo customization system entirely — delete AnimatedLogo.tsx and LogoEditorModal.tsx, strip useLogoConfig.ts down to a config-only module, update page.tsx to use LogoDisplay, and remove all dead CSS.

**Architecture:** Three surgical deletions (two component files, one hook simplification) with matching cleanup in page.tsx and globals.css. No new behaviour added — only removal of the editor machinery while keeping the static LogoDisplay rendering path intact.

**Tech Stack:** Next.js 16 App Router, TypeScript, React

---

### Task 1: Delete AnimatedLogo.tsx and LogoEditorModal.tsx

**Files:**
- Delete: `components/AnimatedLogo.tsx`
- Delete: `components/LogoEditorModal.tsx`

- [ ] **Step 1: Delete both files**

```bash
rm /workspaces/all-in-all-based/components/AnimatedLogo.tsx
rm /workspaces/all-in-all-based/components/LogoEditorModal.tsx
```

- [ ] **Step 2: Verify files are gone**

```bash
ls /workspaces/all-in-all-based/components/
```

Expected: neither `AnimatedLogo.tsx` nor `LogoEditorModal.tsx` appears in the listing.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: delete AnimatedLogo and LogoEditorModal components"
```

---

### Task 2: Simplify useLogoConfig.ts to config-only module

**Files:**
- Modify: `hooks/useLogoConfig.ts`

Current file (48 lines) has `'use client'`, `useState` import, `KEY` const, `readStored()` function, and `useLogoConfig()` hook. Keep only the `LogoConfig` interface and `LOGO_DEFAULTS` const.

- [ ] **Step 1: Replace the entire file**

Write `hooks/useLogoConfig.ts` with this exact content:

```ts
export interface LogoConfig {
  text: string;
  shimmerColor: string;
  iconShape: 'bolt' | 'diamond' | 'hex' | 'circle' | 'terminal';
  speed: number;
  shimmerWidth: number;
  iconBg: string;
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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors referencing `useLogoConfig.ts` (there may be downstream errors in page.tsx from the deleted AnimatedLogo import — those are fixed in Task 3).

- [ ] **Step 3: Commit**

```bash
git add hooks/useLogoConfig.ts
git commit -m "feat: simplify useLogoConfig to config-only module, remove hook and localStorage"
```

---

### Task 3: Update page.tsx — swap AnimatedLogo for LogoDisplay, remove sidebarOpen machinery

**Files:**
- Modify: `app/page.tsx`

Changes needed:
1. Line 9: replace `import AnimatedLogo from '@/components/AnimatedLogo'` with imports for `LogoDisplay` and `LOGO_DEFAULTS`
2. Line 52: remove `const [sidebarOpen, setSidebarOpen] = useState(false);`
3. Line 113: remove `setSidebarOpen(false);` inside `newProject()`
4. Line 122: remove `setSidebarOpen(false);` inside `loadProject()`
5. Line 154: remove the hamburger `<button>` element
6. Line 155: replace `<AnimatedLogo />` with `<LogoDisplay config={LOGO_DEFAULTS} />`
7. Line 180: remove the overlay div `{sidebarOpen && <div onClick=... />}`
8. Lines 181-192: remove `isOpen={sidebarOpen}` prop from `<Sidebar>`

- [ ] **Step 1: Replace AnimatedLogo import with LogoDisplay imports**

Find:
```tsx
import AnimatedLogo from '@/components/AnimatedLogo';
```

Replace with:
```tsx
import LogoDisplay from '@/components/LogoDisplay';
import { LOGO_DEFAULTS } from '@/hooks/useLogoConfig';
```

- [ ] **Step 2: Remove sidebarOpen state declaration**

Find:
```tsx
  const [sidebarOpen, setSidebarOpen] = useState(false);
```

Replace with (delete the line entirely — use empty string as replacement or remove manually).

- [ ] **Step 3: Remove setSidebarOpen(false) from newProject**

Find:
```tsx
    setFiles([]); setMessages([]); setActiveFile(null); setActivePanel('chat');
    setSidebarOpen(false);
```

Replace with:
```tsx
    setFiles([]); setMessages([]); setActiveFile(null); setActivePanel('chat');
```

- [ ] **Step 4: Remove setSidebarOpen(false) from loadProject**

Find:
```tsx
    setActivePanel('chat');
    setSidebarOpen(false);
  };
```

Replace with:
```tsx
    setActivePanel('chat');
  };
```

- [ ] **Step 5: Remove hamburger button and replace AnimatedLogo**

Find:
```tsx
          <button className="hamburger" onClick={() => setSidebarOpen(s => !s)}>☰</button>
          <AnimatedLogo />
```

Replace with:
```tsx
          <LogoDisplay config={LOGO_DEFAULTS} />
```

- [ ] **Step 6: Remove the sidebarOpen overlay div**

Find:
```tsx
        {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{position:'fixed',inset:0,zIndex:199,background:'rgba(0,0,0,0.5)'}} />}
```

Replace with (delete the line — empty replacement).

- [ ] **Step 7: Remove isOpen prop from Sidebar**

Find:
```tsx
          isOpen={sidebarOpen}
```

Replace with (delete the line — empty replacement).

- [ ] **Step 8: Verify TypeScript compiles with no errors**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. If `useState` is still imported but no longer used for sidebarOpen, the compiler won't error (it's still used for other state). If there are unused import warnings, check `useEffect` is still in the import too.

- [ ] **Step 9: Commit**

```bash
git add app/page.tsx
git commit -m "feat: replace AnimatedLogo with static LogoDisplay, remove hamburger and sidebarOpen state"
```

---

### Task 4: Remove dead CSS from globals.css

**Files:**
- Modify: `app/globals.css`

Remove the following CSS blocks (confirmed line numbers from grep):
- Lines 673–678: `.animated-logo-root` and hover state
- Lines 720–738: `.logo-edit-btn` and `.logo-edit-btn:hover`
- Lines 745–915: all `.logo-editor-*` rules (backdrop, panel, header, title, close, preview, controls, label, value, input, shape-picker, shape-btn, swatch-row, swatch, slider-row, slider, slider-cap, footer, reset-link, save-btn)
- Lines 313–324: `.hamburger` rule and `@media (min-width: 769px) { .hamburger { display: none; } }`

**Keep** (do NOT touch):
- `.animated-logo-wrap`, `.logo-icon-svg`, `.animated-logo-text` — still used by LogoDisplay
- `@keyframes logo-shimmer-slide`, `.logo-shimmer` — still used by LogoDisplay
- Mobile override `.animated-logo-text { font-size: 14px }` inside `@media (max-width: 768px)`

- [ ] **Step 1: Remove .animated-logo-root block**

Find and delete:
```css
.animated-logo-root {
```
...through its closing `}` (lines ~673–678). The block contains a hover rule. Remove both `.animated-logo-root` and `.animated-logo-root:hover` (or however many closing braces cover both rules).

Verify by searching for `.animated-logo-root` after editing — should return no matches.

- [ ] **Step 2: Remove .logo-edit-btn block**

Find and delete from:
```css
.logo-edit-btn {
```
through and including:
```css
.logo-edit-btn:hover { color: var(--accent); border-color: var(--accent); }
```

- [ ] **Step 3: Remove all .logo-editor-* blocks**

Find and delete from:
```css
.logo-editor-backdrop {
```
through and including the last editor rule:
```css
.logo-save-btn:hover { opacity: 0.85; }
```

This is approximately lines 745–915. After deletion, verify:
```bash
grep -n "logo-editor\|logo-shape\|logo-swatch\|logo-slider\|logo-reset\|logo-save" /workspaces/all-in-all-based/app/globals.css
```
Expected: no matches.

- [ ] **Step 4: Remove hamburger CSS**

Find and delete:
```css
  .hamburger {
```
through its closing `}` block (lines ~313–320).

Also find and delete:
```css
  .hamburger { display: none; }
```
(inside `@media (min-width: 769px)`, line ~324).

Verify:
```bash
grep -n "hamburger" /workspaces/all-in-all-based/app/globals.css
```
Expected: no matches.

- [ ] **Step 5: Verify dev server compiles without errors**

```bash
cd /workspaces/all-in-all-based && npm run build 2>&1 | tail -20
```

Expected: build succeeds (exit 0). If there are errors, check they aren't related to missing CSS classes used by LogoDisplay (`.animated-logo-wrap`, `.logo-icon-svg`, `.animated-logo-text`, `.logo-shimmer`).

- [ ] **Step 6: Commit**

```bash
git add app/globals.css
git commit -m "feat: remove logo editor CSS (logo-editor-*, logo-edit-btn, animated-logo-root, hamburger)"
```

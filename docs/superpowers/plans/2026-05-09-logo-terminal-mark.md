# Logo Terminal Mark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder logo defaults and empty-state gradient box with the official Terminal Mark — a purple-to-teal gradient tile displaying `B>` in Space Mono Bold, paired with a Space Mono `BASED` wordmark.

**Architecture:** Four files touched in isolation. Type change in `useLogoConfig.ts` flows downstream to `LogoDisplay.tsx` (rendering) and `LogoEditorModal.tsx` (picker UI). The empty state in `page.tsx` + `globals.css` is independent — a self-contained div + CSS update.

**Tech Stack:** React (Next.js App Router), TypeScript, CSS custom properties (`--accent` = `#7c6af7`, `--accent3` = `#6af7c8`, `--bg` = `#0a0a0f`, `--font-mono` = Space Mono)

---

## Files

| File | Change |
|------|--------|
| `hooks/useLogoConfig.ts` | Add `'terminal'` to `iconShape` union; update `LOGO_DEFAULTS` |
| `components/LogoDisplay.tsx` | Render gradient tile + `B>` text when `iconShape === 'terminal'`; override wordmark font |
| `components/LogoEditorModal.tsx` | Add `'terminal'` to `SHAPES` array and `SHAPE_LABELS` map |
| `app/page.tsx` | Add `B>` text content to the `.chat-empty-logo` div |
| `app/globals.css` | Restyle `.chat-empty-logo` as the real gradient tile |

---

## Task 1: Extend LogoConfig type and update defaults

**Files:**
- Modify: `hooks/useLogoConfig.ts`

- [ ] **Step 1: Update `iconShape` union type and `LOGO_DEFAULTS`**

  In `hooks/useLogoConfig.ts`, make these two changes:

  Change line 7:
  ```ts
  // Before
  iconShape: 'bolt' | 'diamond' | 'hex' | 'circle';
  // After
  iconShape: 'bolt' | 'diamond' | 'hex' | 'circle' | 'terminal';
  ```

  Change lines 13–20 (`LOGO_DEFAULTS`):
  ```ts
  export const LOGO_DEFAULTS: LogoConfig = {
    text: 'BASED',
    shimmerColor: '#a89aff',
    iconShape: 'terminal',
    speed: 2.8,
    shimmerWidth: 0,
    iconBg: '#0a0a0f',
  };
  ```

  `shimmerWidth: 0` hides the shimmer overlay (the gradient tile provides sufficient visual interest). `iconBg` is kept for backward compatibility when users switch to other shapes.

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
  ```

  Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 3: Commit**

  ```bash
  git add hooks/useLogoConfig.ts
  git commit -m "feat: add terminal icon shape to LogoConfig, set as default"
  ```

---

## Task 2: Add terminal rendering to LogoDisplay

**Files:**
- Modify: `components/LogoDisplay.tsx`

- [ ] **Step 1: Replace the icon rendering block**

  The current `LogoDisplay` renders `<div className="logo-icon-svg" style={{ background: config.iconBg }}><IconComp /></div>` unconditionally. Replace the entire return statement with one that branches on `iconShape === 'terminal'`:

  Full new file content for `components/LogoDisplay.tsx`:
  ```tsx
  'use client';
  import { LogoConfig } from '@/hooks/useLogoConfig';

  function BoltIcon({ color }: { color: string }) {
    return (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <polygon points="14,3 7,13 11.5,13 9.5,21 17,11 12.5,11" fill={color} />
      </svg>
    );
  }

  function DiamondIcon({ color }: { color: string }) {
    return (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <polygon points="12,3 21,12 12,21 3,12" fill={color} />
      </svg>
    );
  }

  function HexIcon({ color }: { color: string }) {
    return (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <polygon points="12,2 20.5,7 20.5,17 12,22 3.5,17 3.5,7" fill={color} />
      </svg>
    );
  }

  function CircleIcon({ color }: { color: string }) {
    return (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <circle cx="12" cy="12" r="7" fill={color} />
        <circle cx="12" cy="12" r="10.5" fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
    );
  }

  const ICONS = { bolt: BoltIcon, diamond: DiamondIcon, hex: HexIcon, circle: CircleIcon };

  export default function LogoDisplay({ config }: { config: LogoConfig }) {
    const isTerminal = config.iconShape === 'terminal';
    const IconComp = isTerminal ? null : ICONS[config.iconShape as keyof typeof ICONS] ?? null;
    const totalDuration = config.speed + 1.2;
    const movePct = Math.round((config.speed / totalDuration) * 100);

    return (
      <div
        className="animated-logo-wrap"
        style={{
          '--logo-shimmer-color': config.shimmerColor,
          '--logo-speed': `${totalDuration}s`,
          '--logo-icon-bg': config.iconBg,
          '--logo-shimmer-width': `${config.shimmerWidth}%`,
          '--shimmer-move-pct': `${movePct}%`,
        } as React.CSSProperties}
      >
        {isTerminal ? (
          <div
            className="logo-icon-svg"
            style={{
              background: 'linear-gradient(135deg, var(--accent), var(--accent3))',
              border: 'none',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: '11px',
              color: 'var(--bg)',
              letterSpacing: 0,
            }}
          >
            B&gt;
          </div>
        ) : (
          <div className="logo-icon-svg" style={{ background: config.iconBg }}>
            {IconComp && <IconComp color={config.shimmerColor} />}
          </div>
        )}
        <span
          className="animated-logo-text"
          style={isTerminal ? { fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '13px', letterSpacing: '2px' } : undefined}
        >
          {config.text}
        </span>
        <div
          className="logo-shimmer"
          style={{
            width: `${config.shimmerWidth}%`,
            background: `linear-gradient(90deg, transparent, ${config.shimmerColor}55, ${config.shimmerColor}99, ${config.shimmerColor}55, transparent)`,
          }}
        />
      </div>
    );
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
  ```

  Expected: no new errors.

- [ ] **Step 3: Commit**

  ```bash
  git add components/LogoDisplay.tsx
  git commit -m "feat: render gradient B> tile for terminal icon shape in LogoDisplay"
  ```

---

## Task 3: Add terminal to LogoEditorModal

**Files:**
- Modify: `components/LogoEditorModal.tsx` (lines 8–9)

- [ ] **Step 1: Add `terminal` to the SHAPES array and SHAPE_LABELS map**

  In `components/LogoEditorModal.tsx`, find these two lines:
  ```ts
  const SHAPES: LogoConfig['iconShape'][] = ['bolt', 'diamond', 'hex', 'circle'];
  const SHAPE_LABELS: Record<string, string> = { bolt: '⚡', diamond: '◆', hex: '⬡', circle: '●' };
  ```

  Replace with:
  ```ts
  const SHAPES: LogoConfig['iconShape'][] = ['terminal', 'bolt', 'diamond', 'hex', 'circle'];
  const SHAPE_LABELS: Record<string, string> = { terminal: 'B>', bolt: '⚡', diamond: '◆', hex: '⬡', circle: '●' };
  ```

  `terminal` is listed first so it appears as the default option in the picker.

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
  ```

  Expected: no new errors.

- [ ] **Step 3: Commit**

  ```bash
  git add components/LogoEditorModal.tsx
  git commit -m "feat: add terminal shape to logo editor picker"
  ```

---

## Task 4: Fix empty-state logo

**Files:**
- Modify: `app/page.tsx` (line 266)
- Modify: `app/globals.css` (`.chat-empty-logo` block, lines 112–116)

- [ ] **Step 1: Add `B>` text to the empty-state div**

  In `app/page.tsx`, find line 266:
  ```tsx
  <div className="chat-empty-logo" aria-hidden="true" />
  ```

  Replace with:
  ```tsx
  <div className="chat-empty-logo" aria-hidden="true">B&gt;</div>
  ```

- [ ] **Step 2: Restyle `.chat-empty-logo` in globals.css**

  In `app/globals.css`, find the `.chat-empty-logo` block:
  ```css
  .chat-empty-logo {
    width: 48px; height: 48px;
    background: linear-gradient(135deg, rgba(124,106,247,0.25), rgba(106,247,200,0.15));
    border-radius: 14px; border: 1px solid rgba(124,106,247,0.3);
  }
  ```

  Replace with:
  ```css
  .chat-empty-logo {
    width: 56px; height: 56px;
    background: linear-gradient(135deg, var(--accent), var(--accent3));
    border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-mono); font-weight: 700; font-size: 22px; color: var(--bg);
  }
  ```

  Changes: real gradient (opaque, not washed-out), 56px (matches approved mockup), flex centering for the text, mono font, dark text on gradient background, no border.

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
  ```

  Expected: no new errors.

- [ ] **Step 4: Commit**

  ```bash
  git add app/page.tsx app/globals.css
  git commit -m "feat: apply terminal mark to empty-state logo"
  ```

---

## Task 5: Visual verification

- [ ] **Step 1: Start dev server (if not already running)**

  ```bash
  cd /workspaces/all-in-all-based && npm run dev
  ```

- [ ] **Step 2: Verify header logo**

  Open the app. The header should show:
  - A 36×36px rounded square with purple-to-teal gradient containing `B>` in Space Mono Bold dark text
  - `BASED` wordmark in Space Mono (smaller, tighter than before) next to it
  - No shimmer animation

- [ ] **Step 3: Verify empty state**

  Close/don't select any project so the no-project empty state is visible. Confirm:
  - A 56×56px gradient tile with `B>` text, centered
  - `BASED` title below (already rendered by `.no-project-title`)
  - "Open a project or start a new one." subtitle
  - `+ New Project` button

- [ ] **Step 4: Verify logo editor**

  Hover the header logo and click the ✎ edit button. Confirm:
  - `B>` appears as the first option in the shape picker
  - Selecting other shapes (bolt, diamond, etc.) still renders them correctly
  - Reset restores `B>` terminal shape

# Animated Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static PNG logo with a Framer Motion shimmer logo that is customizable (text, icon shape, colors, speed, shimmer width) via a click-to-edit modal persisted to localStorage.

**Architecture:** Four new files — `hooks/useLogoConfig.ts` (state + persistence), `components/LogoDisplay.tsx` (pure presentational shimmer), `components/LogoEditorModal.tsx` (modal with draft state + live preview), `components/AnimatedLogo.tsx` (header component that wires hook + edit trigger + modal). `app/page.tsx` swaps two elements for `<AnimatedLogo />`. `app/globals.css` gains new classes and loses the old logo-img/logo-text/logoPulse/logoSpin blocks.

**Tech Stack:** Next.js 16, React 19, TypeScript, Framer Motion (new dep), localStorage

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `hooks/useLogoConfig.ts` | Config type, defaults, localStorage r/w, reset |
| Create | `components/LogoDisplay.tsx` | Shimmer animation, 4 SVG icons, CSS vars — no state |
| Create | `components/LogoEditorModal.tsx` | Backdrop, draft state, live preview, all controls |
| Create | `components/AnimatedLogo.tsx` | Hook + hover edit button + modal open/close |
| Modify | `app/page.tsx` | Swap `<img>` + `<span>` for `<AnimatedLogo />` |
| Modify | `app/globals.css` | Add new classes, remove old logo-img/logo-text/animations |

---

## Task 1: Install Framer Motion

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install the package**

```bash
cd /workspaces/all-in-all-based && npm install framer-motion
```

Expected: `added 1 package` (or similar), no errors.

- [ ] **Step 2: Verify it's in package.json**

```bash
grep '"framer-motion"' package.json
```

Expected output: `"framer-motion": "^X.Y.Z"`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add framer-motion dependency"
```

---

## Task 2: Create useLogoConfig hook

**Files:**
- Create: `hooks/useLogoConfig.ts`

- [ ] **Step 1: Create the hooks directory and file**

Create `hooks/useLogoConfig.ts` with this exact content:

```ts
'use client';
import { useState, useEffect } from 'react';

export interface LogoConfig {
  text: string;
  shimmerColor: string;
  iconShape: 'bolt' | 'diamond' | 'hex' | 'circle';
  speed: number;
  shimmerWidth: number;
  iconBg: string;
}

export const LOGO_DEFAULTS: LogoConfig = {
  text: 'BASED',
  shimmerColor: '#a89aff',
  iconShape: 'bolt',
  speed: 2.8,
  shimmerWidth: 40,
  iconBg: '#0a0a0f',
};

const KEY = 'logo_config';

export function useLogoConfig() {
  const [config, setConfigState] = useState<LogoConfig>(LOGO_DEFAULTS);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored) setConfigState({ ...LOGO_DEFAULTS, ...JSON.parse(stored) });
    } catch {}
  }, []);

  const setConfig = (c: LogoConfig) => {
    setConfigState(c);
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
  };

  const reset = () => {
    setConfigState(LOGO_DEFAULTS);
    try { localStorage.removeItem(KEY); } catch {}
  };

  return { config, setConfig, reset };
}
```

- [ ] **Step 2: Verify TypeScript accepts it**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors referencing `useLogoConfig.ts`.

- [ ] **Step 3: Commit**

```bash
git add hooks/useLogoConfig.ts
git commit -m "feat: add useLogoConfig hook with localStorage persistence"
```

---

## Task 3: Create LogoDisplay component

**Files:**
- Create: `components/LogoDisplay.tsx`

This is a pure presentational component — no hooks, no state. It takes a `LogoConfig` prop and renders the shimmer animation. It is used by both `AnimatedLogo` (real header) and `LogoEditorModal` (live preview).

- [ ] **Step 1: Create `components/LogoDisplay.tsx`**

```tsx
'use client';
import { motion } from 'framer-motion';
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
  const IconComp = ICONS[config.iconShape];
  // x end: shimmer needs to travel 100% of parent + its own width (shimmerWidth%)
  // expressed as % of shimmer element: 100/fraction + 100 = (1 + 1/fraction) * 100
  const shimmerEnd = `${Math.ceil((1 + 100 / config.shimmerWidth) * 100)}%`;

  return (
    <div
      className="animated-logo-wrap"
      style={{
        '--logo-shimmer-color': config.shimmerColor,
        '--logo-speed': `${config.speed}s`,
        '--logo-icon-bg': config.iconBg,
        '--logo-shimmer-width': `${config.shimmerWidth}%`,
      } as React.CSSProperties}
    >
      <div className="logo-icon-svg" style={{ background: config.iconBg }}>
        <IconComp color={config.shimmerColor} />
      </div>
      <span className="animated-logo-text">{config.text}</span>
      <motion.div
        className="logo-shimmer"
        style={{
          width: `${config.shimmerWidth}%`,
          background: `linear-gradient(90deg, transparent, ${config.shimmerColor}55, ${config.shimmerColor}99, ${config.shimmerColor}55, transparent)`,
        }}
        animate={{ x: ['-150%', shimmerEnd] }}
        transition={{
          duration: config.speed,
          repeat: Infinity,
          ease: 'easeInOut',
          repeatDelay: 1.2,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/LogoDisplay.tsx
git commit -m "feat: add LogoDisplay component with Framer Motion shimmer"
```

---

## Task 4: Create LogoEditorModal component

**Files:**
- Create: `components/LogoEditorModal.tsx`

- [ ] **Step 1: Create `components/LogoEditorModal.tsx`**

```tsx
'use client';
import { useState, useEffect } from 'react';
import { LogoConfig, LOGO_DEFAULTS } from '@/hooks/useLogoConfig';
import LogoDisplay from './LogoDisplay';

const SHIMMER_SWATCHES = ['#a89aff', '#6af7c8', '#f7c86a', '#ff6b6b', '#ffffff', '#6af7f7'];
const ICON_BG_SWATCHES = ['#0a0a0f', '#15102a', '#0a1020', '#1a1018'];
const SHAPES: LogoConfig['iconShape'][] = ['bolt', 'diamond', 'hex', 'circle'];
const SHAPE_LABELS: Record<string, string> = { bolt: '⚡', diamond: '◆', hex: '⬡', circle: '●' };

export default function LogoEditorModal({ config, onSave, onClose }: {
  config: LogoConfig;
  onSave: (c: LogoConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<LogoConfig>({ ...config });
  const patch = (partial: Partial<LogoConfig>) => setDraft(d => ({ ...d, ...partial }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Only updates draft — real config unchanged until Save is clicked
  const handleReset = () => setDraft({ ...LOGO_DEFAULTS });

  return (
    <div className="logo-editor-backdrop" onClick={onClose}>
      <div className="logo-editor-panel" onClick={e => e.stopPropagation()}>

        <div className="logo-editor-header">
          <span className="logo-editor-title">Customize Logo</span>
          <button className="logo-editor-close" onClick={onClose}>✕</button>
        </div>

        <div className="logo-preview-wrap">
          <LogoDisplay config={draft} />
        </div>

        <div className="logo-editor-controls">

          <label className="logo-editor-label">Name</label>
          <input
            className="logo-editor-input"
            value={draft.text}
            maxLength={12}
            onChange={e => patch({ text: e.target.value })}
          />

          <label className="logo-editor-label">Icon shape</label>
          <div className="logo-shape-picker">
            {SHAPES.map(s => (
              <button
                key={s}
                className={`logo-shape-btn${draft.iconShape === s ? ' active' : ''}`}
                onClick={() => patch({ iconShape: s })}
                title={s}
              >
                {SHAPE_LABELS[s]}
              </button>
            ))}
          </div>

          <label className="logo-editor-label">Shimmer color</label>
          <div className="logo-swatch-row">
            {SHIMMER_SWATCHES.map(c => (
              <button
                key={c}
                className={`logo-swatch${draft.shimmerColor === c ? ' active' : ''}`}
                style={{ background: c }}
                onClick={() => patch({ shimmerColor: c })}
              />
            ))}
            <input
              type="color"
              className="logo-color-input"
              value={draft.shimmerColor}
              onChange={e => patch({ shimmerColor: e.target.value })}
              title="Custom shimmer color"
            />
          </div>

          <label className="logo-editor-label">Icon background</label>
          <div className="logo-swatch-row">
            {ICON_BG_SWATCHES.map(c => (
              <button
                key={c}
                className={`logo-swatch${draft.iconBg === c ? ' active' : ''}`}
                style={{ background: c, outline: c === '#0a0a0f' ? '1px solid #3a3060' : 'none', outlineOffset: '1px' }}
                onClick={() => patch({ iconBg: c })}
              />
            ))}
            <input
              type="color"
              className="logo-color-input"
              value={draft.iconBg}
              onChange={e => patch({ iconBg: e.target.value })}
              title="Custom icon background"
            />
          </div>

          <label className="logo-editor-label">
            Speed <span className="logo-editor-value">{draft.speed.toFixed(1)}s</span>
          </label>
          <div className="logo-slider-row">
            <span className="logo-slider-cap">Fast</span>
            <input
              type="range" min="0.8" max="4.0" step="0.1"
              className="logo-editor-slider"
              value={draft.speed}
              onChange={e => patch({ speed: parseFloat(e.target.value) })}
            />
            <span className="logo-slider-cap">Slow</span>
          </div>

          <label className="logo-editor-label">
            Shimmer width <span className="logo-editor-value">{draft.shimmerWidth}%</span>
          </label>
          <div className="logo-slider-row">
            <span className="logo-slider-cap">Narrow</span>
            <input
              type="range" min="15" max="70" step="5"
              className="logo-editor-slider"
              value={draft.shimmerWidth}
              onChange={e => patch({ shimmerWidth: parseInt(e.target.value) })}
            />
            <span className="logo-slider-cap">Wide</span>
          </div>

        </div>

        <div className="logo-editor-footer">
          <button className="logo-reset-link" onClick={handleReset}>Reset to defaults</button>
          {/* Note: reset only updates draft/preview — Save must be clicked to persist */}
          <button className="logo-save-btn" onClick={() => onSave(draft)}>Save</button>
        </div>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/LogoEditorModal.tsx
git commit -m "feat: add LogoEditorModal with draft state and live preview"
```

---

## Task 5: Create AnimatedLogo component

**Files:**
- Create: `components/AnimatedLogo.tsx`

- [ ] **Step 1: Create `components/AnimatedLogo.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLogoConfig } from '@/hooks/useLogoConfig';
import LogoDisplay from './LogoDisplay';
import LogoEditorModal from './LogoEditorModal';

export default function AnimatedLogo() {
  const { config, setConfig, reset } = useLogoConfig();
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <>
      <div
        className="animated-logo-root"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <LogoDisplay config={config} />
        <AnimatePresence>
          {(isHovered || isEditing) && (
            <motion.button
              key="edit-btn"
              className="logo-edit-btn"
              onClick={() => setIsEditing(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              title="Customize logo"
              aria-label="Customize logo"
            >
              ✎
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      {isEditing && (
        <LogoEditorModal
          config={config}
          onSave={(c) => { setConfig(c); setIsEditing(false); }}
          onClose={() => setIsEditing(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/AnimatedLogo.tsx
git commit -m "feat: add AnimatedLogo with hover edit trigger and modal"
```

---

## Task 6: Wire AnimatedLogo into page.tsx

**Files:**
- Modify: `app/page.tsx:134-137`

The current logo markup (lines 134–137) is:
```tsx
<div className="logo">
  <button className="hamburger" onClick={() => setSidebarOpen(s => !s)}>☰</button>
  <img src="/icon-192.png" className="logo-img" alt="Based" />
  <span className="logo-text">BASED</span>
  {currentProject && <span className="project-name-display">{currentProject.name}</span>}
</div>
```

- [ ] **Step 1: Add the import at the top of `app/page.tsx`**

After the existing imports (after line 9 `import DebugPanel from '@/components/DebugPanel';`), add:

```tsx
import AnimatedLogo from '@/components/AnimatedLogo';
```

- [ ] **Step 2: Replace the img + span with AnimatedLogo**

Replace:
```tsx
          <img src="/icon-192.png" className="logo-img" alt="Based" />
          <span className="logo-text">BASED</span>
```

With:
```tsx
          <AnimatedLogo />
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Verify the dev server renders without crashing**

The dev server should already be running on port 3000. Open `http://localhost:3000` and confirm:
- The logo area shows an icon + "BASED" text
- The shimmer sweep animation is visible
- No console errors in the browser

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: replace static logo with AnimatedLogo component"
```

---

## Task 7: Update globals.css

**Files:**
- Modify: `app/globals.css`

Two parts: add new CSS classes, then remove the old logo classes.

- [ ] **Step 1: Add new CSS classes to the end of `app/globals.css`**

Append this entire block at the very end of the file:

```css
/* ===== ANIMATED LOGO ===== */
.animated-logo-root {
  position: relative;
  display: flex;
  align-items: center;
}

.animated-logo-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  border-radius: 6px;
  padding: 0 4px 0 0;
}

.logo-icon-svg {
  width: 36px; height: 36px;
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  border: 1px solid #2a2a3a;
}

.animated-logo-text {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 18px;
  letter-spacing: 3px;
  color: var(--text);
  white-space: nowrap;
}

.logo-shimmer {
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  pointer-events: none;
}

.logo-edit-btn {
  position: absolute;
  right: -28px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text2);
  font-size: 13px;
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s, border-color 0.15s;
  z-index: 10;
}

.logo-edit-btn:hover { color: var(--accent); border-color: var(--accent); }

@media (max-width: 768px) {
  .animated-logo-text { font-size: 14px; }
}

/* ===== LOGO EDITOR MODAL ===== */
.logo-editor-backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.65);
  z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}

.logo-editor-panel {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
  width: 100%;
  max-width: 400px;
  max-height: 90vh;
  overflow-y: auto;
}

.logo-editor-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
}

.logo-editor-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 15px;
  color: var(--text);
}

.logo-editor-close {
  background: transparent; border: none;
  color: var(--text2); cursor: pointer;
  font-size: 16px; padding: 2px 6px;
  border-radius: 4px;
}

.logo-editor-close:hover { color: var(--text); }

.logo-preview-wrap {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 20px;
  min-height: 64px;
}

.logo-editor-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.logo-editor-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text2);
  margin-top: 4px;
  display: flex; align-items: center; justify-content: space-between;
}

.logo-editor-value {
  color: var(--accent);
  font-size: 11px;
  letter-spacing: 0;
  text-transform: none;
}

.logo-editor-input {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 14px;
  letter-spacing: 2px;
  padding: 8px 12px;
  width: 100%;
}

.logo-editor-input:focus { outline: none; border-color: var(--accent); }

.logo-shape-picker { display: flex; gap: 6px; }

.logo-shape-btn {
  flex: 1;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text2);
  font-size: 16px;
  padding: 8px 4px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.logo-shape-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg);
}

.logo-swatch-row { display: flex; gap: 6px; align-items: center; }

.logo-swatch {
  width: 24px; height: 24px;
  border-radius: 6px;
  cursor: pointer;
  border: 2px solid transparent;
  transition: transform 0.15s, border-color 0.15s;
  flex-shrink: 0;
  padding: 0;
}

.logo-swatch:hover { transform: scale(1.12); }
.logo-swatch.active { border-color: white; }

.logo-color-input {
  width: 28px; height: 24px;
  border-radius: 6px;
  border: 1px solid var(--border);
  padding: 0 2px;
  cursor: pointer;
  background: transparent;
  flex-shrink: 0;
}

.logo-slider-row {
  display: flex; align-items: center; gap: 8px;
}

.logo-editor-slider { flex: 1; accent-color: var(--accent); cursor: pointer; }

.logo-slider-cap { font-size: 10px; color: var(--text3); white-space: nowrap; }

.logo-editor-footer {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.logo-reset-link {
  background: transparent; border: none;
  color: var(--text2);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

.logo-reset-link:hover { color: var(--danger); }

.logo-save-btn {
  background: var(--accent);
  border: none;
  border-radius: 8px;
  color: white;
  font-weight: 700;
  font-size: 13px;
  padding: 8px 20px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.logo-save-btn:hover { opacity: 0.85; }
```

- [ ] **Step 2: Remove the old logo CSS blocks from `app/globals.css`**

Remove the following blocks entirely (they are replaced by the new classes above):

**Block A** — line 39, `.logo-icon` single rule:
```css
.logo-icon { font-size: 20px; color: var(--accent); }
```

**Block B** — line 40, `.logo-text` single rule:
```css
.logo-text { font-family: var(--font-display); font-weight: 800; font-size: 18px; letter-spacing: 3px; color: var(--text); }
```

**Block C** — inside the `@media (max-width: 768px)` block around line 282:
```css
  .logo-text { font-size: 14px; }
```

**Block D** — the `.logo-icon` hover animation block around lines 389–395:
```css
/* Logo pulse on hover */
.logo-icon {
  transition: all 0.3s ease;
  display: inline-block;
}
.logo:hover .logo-icon {
  transform: rotate(30deg) scale(1.2);
  color: var(--accent3);
}
```

**Block E** — the entire `/* LOGO IMAGE */` section (lines 576–614):
```css
/* LOGO IMAGE */
.logo-img {
  width: 40px; height: 40px; border-radius: 10px;
  background: var(--bg);
  animation: logoPulse 3s ease-in-out infinite;
  flex-shrink: 0;
}

@media (min-width: 769px) {
  .logo-img {
    width: 40px; height: 40px; border-radius: 10px;
  }
}

@keyframes logoPulse {
  0%, 100% { 
    box-shadow: 0 0 0 0 rgba(212,175,55,0), 
                0 0 8px rgba(212,175,55,0.3);
    opacity: 1;
  }
  50% { 
    box-shadow: 0 0 0 6px rgba(212,175,55,0.1), 
                0 0 20px rgba(212,175,55,0.5);
    opacity: 0.9;
  }
}

.logo-img:hover {
  animation: logoSpin 0.6s ease forwards;
}

@keyframes logoSpin {
  0% { transform: rotate(0deg) scale(1); }
  50% { transform: rotate(180deg) scale(1.1); }
  100% { transform: rotate(360deg) scale(1); }
}
```

- [ ] **Step 3: Verify TypeScript and check the app still builds**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Smoke-test in browser**

Open `http://localhost:3000` and verify:
1. The shimmer sweeps across icon + text continuously
2. Hovering the logo reveals the ✎ edit button
3. Clicking ✎ opens the modal with a live preview
4. Changing any control updates the preview immediately
5. Pressing Escape or clicking outside closes without saving
6. Clicking Save updates the header logo and closes the modal
7. Clicking Reset to defaults restores the original look
8. Refreshing the page shows your saved settings

- [ ] **Step 5: Commit**

```bash
git add app/globals.css
git commit -m "feat: add animated logo CSS, remove old logo-img/logo-text styles"
```

---

## Task 8: Push and verify

- [ ] **Step 1: Push to remote**

```bash
git push
```

- [ ] **Step 2: Final browser check**

Open `http://localhost:3000`. Confirm all 8 smoke-test items from Task 7 Step 4 pass. The logo should be visually distinct from the old static PNG version.

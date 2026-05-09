# Animated Sidebar Spec

**Date:** 2026-05-09  
**Status:** Approved

## Summary

Replace the always-visible desktop sidebar and mobile hamburger drawer with a single unified animated system: a floating gradient tab pinned to the vertical centre of the left edge, which opens a frosted-glass panel that grows leftward out of it. Works on all screen sizes.

## Design

### Sidebar unit

The tab and panel are a single positioned unit (`position: absolute; left: 0; top: 50%; transform: translateY(-50%)`). They share the same vertical centre at all times.

### Gradient tab

| Property | Value |
|----------|-------|
| Size | 20 × 64px |
| Border radius | `0 10px 10px 0` |
| Colour | Glow pulse animation (see below) |
| Chevron | `›` — rotates 180° when panel is open |
| Always visible | Yes — never hidden |

**Glow pulse animation:**
```css
@keyframes glow-pulse {
  0%, 100% {
    box-shadow: 0 0 8px 1px rgba(124,106,247,0.4), 2px 0 16px rgba(124,106,247,0.2);
    opacity: 0.85;
  }
  50% {
    box-shadow: 0 0 16px 3px rgba(106,247,200,0.5), 2px 0 24px rgba(106,247,200,0.25);
    opacity: 1;
  }
}
```

Tab background: fades to transparent at top and bottom edges, solid purple→teal in the middle:
```css
background: linear-gradient(180deg,
  transparent 0%,
  rgba(124,106,247,0.45) 15%,
  rgba(124,106,247,0.85) 35%,
  rgba(106,247,200,0.85) 65%,
  rgba(106,247,200,0.45) 85%,
  transparent 100%
);
animation: glow-pulse 2.4s ease-in-out infinite;
```

Chevron text shadow when open: `0 0 6px rgba(106,247,200,0.8)`.

### Floating panel

| Property | Value |
|----------|-------|
| Width | 220px (when open), 0 (when closed) |
| Max height | `min(80vh, 520px)` |
| Border radius | `12px 0 0 12px` |
| Background | `rgba(17,17,24,0.95)` |
| Backdrop filter | `blur(16px)` |
| Border | `1px solid rgba(42,42,58,0.9)`, right border none |
| Animation | framer-motion `motion.div`, `width` animated with `spring { stiffness: 300, damping: 30 }` |
| Contents | Existing `Sidebar` component content (Projects + Files sections) |

### Backdrop

| Property | Value |
|----------|-------|
| Coverage | Full viewport |
| Background | `rgba(0,0,0,0.5)` |
| Animation | framer-motion `AnimatePresence` + opacity fade (0 → 1, duration 0.2s) |
| Dismiss | Click backdrop → close panel |
| z-index | Below panel (15), above content (5) |

## Architecture

### New component: `components/SidebarTrigger.tsx`

Owns the open/closed state. Renders:
1. The gradient tab (always visible)
2. `AnimatePresence` wrapping the backdrop + floating panel (mounted only when open)
3. The `Sidebar` component inside the panel

Props passed down to `Sidebar`: all existing props (`files`, `activeFile`, `onSelectFile`, `projects`, `currentProject`, `onNewProject`, `onLoadProject`, `onDeleteProject`, `onRenameProject`). `isOpen` and `onClose` are managed internally.

```tsx
// SidebarTrigger.tsx — manages open state, renders tab + panel + backdrop
export default function SidebarTrigger(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  // ... renders tab, AnimatePresence backdrop, motion.div panel, Sidebar
}
```

### `app/page.tsx`

- Remove `sidebarOpen` state, hamburger button, manual overlay div
- Remove `isOpen` prop from `<Sidebar>` call — `SidebarTrigger` manages this
- Replace `<Sidebar ... isOpen={sidebarOpen} />` with `<SidebarTrigger ... />`
- `SidebarTrigger` is absolutely positioned over the app body — not in the flex row

### `components/Sidebar.tsx`

- Remove `isOpen` prop (no longer needed — panel visibility managed by `SidebarTrigger`)
- Remove the CSS class toggle logic (`className={`sidebar ${isOpen ? 'open' : ''}`}`)
- The sidebar renders as a plain `<aside className="sidebar">` inside the floating panel

### `app/globals.css`

**Remove:**
- `.sidebar` mobile `position: fixed; left: -220px` rule and `.sidebar.open { left: 0 }` rule (inside `@media (max-width: 768px)`)
- `.hamburger` rule

**Add:**
```css
.sidebar-trigger {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 20;
  display: flex;
  align-items: center;
}

.sidebar-tab {
  width: 20px;
  height: 64px;
  border-radius: 0 10px 10px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: linear-gradient(180deg,
    transparent 0%,
    rgba(124,106,247,0.45) 15%,
    rgba(124,106,247,0.85) 35%,
    rgba(106,247,200,0.85) 65%,
    rgba(106,247,200,0.45) 85%,
    transparent 100%
  );
  animation: glow-pulse 2.4s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes glow-pulse {
  0%, 100% {
    box-shadow: 0 0 8px 1px rgba(124,106,247,0.4), 2px 0 16px rgba(124,106,247,0.2);
    opacity: 0.85;
  }
  50% {
    box-shadow: 0 0 16px 3px rgba(106,247,200,0.5), 2px 0 24px rgba(106,247,200,0.25);
    opacity: 1;
  }
}

.sidebar-tab-chevron {
  font-size: 12px;
  color: rgba(240,255,250,0.95);
  font-weight: 900;
  line-height: 1;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
              text-shadow 0.3s;
}

.sidebar-tab-chevron.open {
  transform: rotate(180deg);
  text-shadow: 0 0 6px rgba(106,247,200,0.8);
}

.sidebar-floating-panel {
  overflow: hidden;
  max-height: min(80vh, 520px);
  border-radius: 12px 0 0 12px;
  background: rgba(17,17,24,0.95);
  border: 1px solid rgba(42,42,58,0.9);
  border-right: none;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

/* sidebar inside panel fills available space */
.sidebar-floating-panel .sidebar {
  width: 220px;
  height: 100%;
  border-right: none;
}
```

**`.app-body` must get `position: relative`** so the absolutely-positioned `SidebarTrigger` anchors correctly:
```css
/* Before */
.app-body { display: flex; flex: 1; overflow: hidden; }
/* After */
.app-body { display: flex; flex: 1; overflow: hidden; position: relative; }
```

**Desktop sidebar rule change:**
```css
/* Before */
.sidebar {
  width: 220px; background: var(--bg2); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; flex-shrink: 0;
  justify-content: center;
}

/* After — width and flex-shrink removed (panel controls sizing), no border-right (panel has none) */
.sidebar {
  background: var(--bg2);
  display: flex; flex-direction: column;
}
```

## framer-motion usage

```tsx
import { motion, AnimatePresence } from 'framer-motion';

// Backdrop
<AnimatePresence>
  {open && (
    <motion.div
      className="sidebar-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={() => setOpen(false)}
    />
  )}
</AnimatePresence>

// Panel (width spring)
<motion.div
  className="sidebar-floating-panel"
  initial={{ width: 0 }}
  animate={{ width: open ? 220 : 0 }}
  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
>
  <Sidebar {...props} />
</motion.div>
```

## Out of Scope

- Sidebar content changes (Projects/Files sections unchanged)
- Keyboard shortcut to open/close sidebar
- Remembering open/closed state across sessions

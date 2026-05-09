# Animated Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static desktop sidebar and removed mobile hamburger with a unified animated system: a glow-pulse gradient tab pinned to the vertical centre of the left edge that opens a frosted-glass panel via framer-motion spring animation, with a full-viewport backdrop click-to-dismiss.

**Architecture:** New `SidebarTrigger.tsx` component owns open/closed state and renders the tab + panel + backdrop as a React fragment (backdrop is a fragment sibling, not a child of the positioned trigger, to avoid transform-ancestor stacking context issues). `Sidebar.tsx` loses its `isOpen` prop. `page.tsx` swaps `<Sidebar>` for `<SidebarTrigger>`. `globals.css` gains sidebar trigger/tab/panel/backdrop rules and loses mobile slide rules.

**Tech Stack:** Next.js 16 App Router, TypeScript, React, framer-motion

---

### Task 1: Strip isOpen prop from Sidebar.tsx

**Files:**
- Modify: `components/Sidebar.tsx`

`Sidebar` currently accepts `isOpen: boolean` and applies `className={`sidebar ${isOpen ? 'open' : ''}`}`. The panel visibility is now managed by `SidebarTrigger`, so this prop is removed.

- [ ] **Step 1: Remove isOpen from the props destructure and type**

Find:
```tsx
export default function Sidebar({ files, activeFile, onSelectFile, projects, currentProject, onNewProject, onLoadProject, onDeleteProject, onRenameProject, isOpen }: {
  files: FileNode[];
  activeFile: FileNode | null;
  onSelectFile: (f: FileNode) => void;
  projects: Project[];
  currentProject: Project | null;
  onNewProject: () => void;
  onLoadProject: (p: Project) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  isOpen: boolean;
}) {
```

Replace with:
```tsx
export default function Sidebar({ files, activeFile, onSelectFile, projects, currentProject, onNewProject, onLoadProject, onDeleteProject, onRenameProject }: {
  files: FileNode[];
  activeFile: FileNode | null;
  onSelectFile: (f: FileNode) => void;
  projects: Project[];
  currentProject: Project | null;
  onNewProject: () => void;
  onLoadProject: (p: Project) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
}) {
```

- [ ] **Step 2: Change the aside className to plain "sidebar"**

Find:
```tsx
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
```

Replace with:
```tsx
    <aside className="sidebar">
```

- [ ] **Step 3: Verify TypeScript compiles (there will be a downstream error in page.tsx — expected)**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
```

Expected: one error about `isOpen` prop passed from `page.tsx` — that is fixed in Task 3. No other errors should appear.

- [ ] **Step 4: Commit**

```bash
git add components/Sidebar.tsx
git commit -m "feat: remove isOpen prop from Sidebar, panel visibility now managed by SidebarTrigger"
```

---

### Task 2: Create SidebarTrigger.tsx

**Files:**
- Create: `components/SidebarTrigger.tsx`

This component owns open/closed state, renders the glow-pulse gradient tab, the framer-motion floating panel, and the backdrop as a React fragment. The backdrop is a fragment sibling (not a child) of the `.sidebar-trigger` div, avoiding the transform stacking context trap.

- [ ] **Step 1: Create the file with this exact content**

Write `components/SidebarTrigger.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './Sidebar';
import { FileNode, Project } from '@/app/page';

interface SidebarTriggerProps {
  files: FileNode[];
  activeFile: FileNode | null;
  onSelectFile: (f: FileNode) => void;
  projects: Project[];
  currentProject: Project | null;
  onNewProject: () => void;
  onLoadProject: (p: Project) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
}

export default function SidebarTrigger({ onNewProject, onLoadProject, ...props }: SidebarTriggerProps) {
  const [open, setOpen] = useState(false);

  const handleNewProject = () => { onNewProject(); setOpen(false); };
  const handleLoadProject = (p: Project) => { onLoadProject(p); setOpen(false); };

  return (
    <>
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
      <div className="sidebar-trigger">
        <motion.div
          className="sidebar-floating-panel"
          initial={{ width: 0 }}
          animate={{ width: open ? 220 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <Sidebar
            {...props}
            onNewProject={handleNewProject}
            onLoadProject={handleLoadProject}
          />
        </motion.div>
        <button
          className="sidebar-tab"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close sidebar' : 'Open sidebar'}
        >
          <span className={`sidebar-tab-chevron${open ? ' open' : ''}`}>›</span>
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -20
```

Expected: the existing `isOpen` error from page.tsx is still present (fixed in Task 3). No new errors from `SidebarTrigger.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/SidebarTrigger.tsx
git commit -m "feat: add SidebarTrigger component with glow-pulse tab and framer-motion floating panel"
```

---

### Task 3: Update page.tsx — replace Sidebar with SidebarTrigger

**Files:**
- Modify: `app/page.tsx`

Replace the `<Sidebar>` import with `<SidebarTrigger>`, remove the remaining `isOpen` prop (the sidebarOpen state and hamburger button were already removed in the logo-cleanup plan — if they still exist, remove them here too).

- [ ] **Step 1: Replace the Sidebar import with SidebarTrigger**

Find:
```tsx
import Sidebar from '@/components/Sidebar';
```

Replace with:
```tsx
import SidebarTrigger from '@/components/SidebarTrigger';
```

- [ ] **Step 2: Replace the <Sidebar> JSX with <SidebarTrigger>**

Find:
```tsx
        <Sidebar
          files={files}
          activeFile={activeFile}
          onSelectFile={setActiveFile}
          projects={projects}
          currentProject={currentProject}
          onNewProject={newProject}
          onLoadProject={loadProject}
          onDeleteProject={deleteProject}
          onRenameProject={renameProject}
          isOpen={sidebarOpen}
        />
```

Replace with:
```tsx
        <SidebarTrigger
          files={files}
          activeFile={activeFile}
          onSelectFile={setActiveFile}
          projects={projects}
          currentProject={currentProject}
          onNewProject={newProject}
          onLoadProject={loadProject}
          onDeleteProject={deleteProject}
          onRenameProject={renameProject}
        />
```

If `sidebarOpen` state, hamburger button, and overlay div still exist (not removed by logo-cleanup plan), remove them now:
- Remove `const [sidebarOpen, setSidebarOpen] = useState(false);`
- Remove `setSidebarOpen(false)` calls in `newProject` and `loadProject`
- Remove `<button className="hamburger" ...>☰</button>`
- Remove `{sidebarOpen && <div onClick={() => setSidebarOpen(false)} ... />}`

- [ ] **Step 3: Verify TypeScript compiles with no errors**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: replace Sidebar with SidebarTrigger in page.tsx"
```

---

### Task 4: Update globals.css — add sidebar CSS, fix app-body, clean mobile rules

**Files:**
- Modify: `app/globals.css`

Four changes:
1. Add `position: relative` to `.app-body` (anchors the absolute-positioned trigger)
2. Strip `width`, `flex-shrink`, and `justify-content` from the desktop `.sidebar` rule (panel now controls sizing)
3. Remove mobile `.sidebar` slide-in rules and `.sidebar.open` (lines ~307–311)
4. Add `.sidebar-backdrop`, `.sidebar-trigger`, `.sidebar-tab`, `@keyframes glow-pulse`, `.sidebar-tab-chevron`, `.sidebar-floating-panel` CSS

- [ ] **Step 1: Add position: relative to .app-body**

Find:
```css
.app-body { display: flex; flex: 1; overflow: hidden; }
```

Replace with:
```css
.app-body { display: flex; flex: 1; overflow: hidden; position: relative; }
```

- [ ] **Step 2: Update desktop .sidebar rule**

Find the desktop `.sidebar` rule (line ~78):
```css
.sidebar {
  width: 220px; background: var(--bg2); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; flex-shrink: 0;
  justify-content: center;
}
```

Replace with:
```css
.sidebar {
  background: var(--bg2);
  display: flex; flex-direction: column;
}
```

- [ ] **Step 3: Remove mobile sidebar slide rules**

Find and delete these lines inside `@media (max-width: 768px)`:
```css
  .sidebar {
    position: fixed; top: 0; left: -220px; height: 100%; z-index: 200;
    transition: left 0.25s ease; width: 220px;
  }
  .sidebar.open { left: 0; }
```

Verify by running:
```bash
grep -n "sidebar.open\|left: -220px" /workspaces/all-in-all-based/app/globals.css
```
Expected: no matches.

- [ ] **Step 4: Add new sidebar CSS before the final @media block or at end of file**

Append the following CSS block at the end of `globals.css` (before or after the last existing rules — just not inside an existing @media block):

```css
/* ── Animated Sidebar ── */
.sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: 15;
  background: rgba(0,0,0,0.5);
}

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
  border: none;
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

.sidebar-floating-panel .sidebar {
  width: 220px;
  height: 100%;
  border-right: none;
}
```

- [ ] **Step 5: Verify build succeeds**

```bash
cd /workspaces/all-in-all-based && npm run build 2>&1 | tail -20
```

Expected: build succeeds (exit 0).

- [ ] **Step 6: Commit**

```bash
git add app/globals.css
git commit -m "feat: add animated sidebar CSS (trigger, tab, panel, backdrop), fix app-body position, remove mobile slide rules"
```

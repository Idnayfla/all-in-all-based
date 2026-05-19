# Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the UI to be cleaner, more readable, and more user-friendly — removing visual box-clutter from messages, restructuring the header nav into a pill tab switcher, and improving typography hierarchy throughout.

**Architecture:** Primarily CSS-driven with targeted JSX changes in three components. No logic changes. Each task is a self-contained diff that can be verified visually in the running dev server.

**Tech Stack:** Next.js 14 (App Router), React, TypeScript, plain CSS (`app/globals.css`)

---

## File Map

| File                       | Changes                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `app/globals.css`          | Message styles, header/tab styles, empty state styles, sidebar active states, input styles, color cleanup |
| `app/page.tsx`             | Header JSX: pill tab switcher + secondary controls cluster; no-project screen icon + copy                 |
| `components/ChatPanel.tsx` | Message role labels, message markup (border-left), placeholder text, empty state icon + copy              |

`components/Sidebar.tsx` needs no JSX changes — all sidebar updates are CSS-only.

---

## Task 1: Start dev server and verify baseline

**Files:**

- None modified

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: server starts on `http://localhost:3000`. Keep it running in the background throughout all tasks.

- [ ] **Step 2: Open the app and note the current state**

Open `http://localhost:3000`. Confirm you can see:

- The dark header with CHAT/✎/◉/⚙ nav buttons
- The welcome/no-project screen with the ⬡ icon
- The chat panel (create a project if needed)

---

## Task 2: Chat message styles

Replace the boxed message design with a left-border accent treatment and switch prose to system sans-serif.

**Files:**

- Modify: `app/globals.css` (message-related rules)
- Modify: `components/ChatPanel.tsx` (role label text)

- [ ] **Step 1: Update message CSS in `app/globals.css`**

Find the block starting with `.message {` and replace it and all related message rules with:

```css
.message {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 100%;
  padding: 2px 0 2px 18px;
  animation: messageIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.message.user {
  border-left: 2px solid rgba(124, 106, 247, 0.5);
}
.message.assistant {
  border-left: 2px solid rgba(106, 247, 200, 0.4);
}
.message-role {
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  font-family: var(--font-mono);
  margin-bottom: 2px;
}
.message.user .message-role {
  color: var(--accent);
}
.message.assistant .message-role {
  color: var(--accent3);
}
.message-content {
  font-size: 14px;
  line-height: 1.8;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--text);
  word-break: break-word;
}
.message.assistant .message-content {
  color: #c0c0d8;
}
```

Also remove (or replace with empty rules) the old overrides further down the file:

- `.message.user .message-content { border-color: rgba(124,106,247,0.3); }` — delete this line
- The `/* Larger readable text in chat */` block `.message-content { font-size: 14px; line-height: 1.75; }` — delete (superseded above)

Update `.chat-messages` gap:

```css
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
```

- [ ] **Step 2: Update role label text in `components/ChatPanel.tsx`**

Find the line:

```tsx
<div className="message-role">{m.role === 'user' ? '▸ You' : '◈ Based'}</div>
```

Replace with:

```tsx
<div className="message-role">{m.role === 'user' ? 'You' : 'Based'}</div>
```

- [ ] **Step 3: Verify visually**

In the browser, send a message. Confirm:

- Messages have no background box or border-radius
- User message has a purple left border, assistant message has a teal left border
- Role labels are `YOU` / `BASED` in monospace, small caps
- Prose text is in system sans-serif at 14px with generous line height
- Code blocks inside messages still use monospace + dark background

- [ ] **Step 4: Commit**

```bash
git add app/globals.css components/ChatPanel.tsx
git commit -m "style: replace message boxes with border-left accent treatment"
```

---

## Task 3: Chat input area

Update the chat textarea and send button for the cleaner look.

**Files:**

- Modify: `app/globals.css` (input area styles)
- Modify: `components/ChatPanel.tsx` (placeholder text)

- [ ] **Step 1: Update chat input CSS in `app/globals.css`**

Find and update `.chat-input-area` and `.chat-textarea`:

```css
.chat-input-area {
  padding: 16px 24px;
  border-top: 1px solid #1e1e2a;
  background: var(--bg2);
  display: flex;
  gap: 12px;
  align-items: flex-end;
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}
.chat-textarea {
  flex: 1;
  background: var(--bg2);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  padding: 12px 14px;
  border-radius: 8px;
  resize: none;
  outline: none;
  transition: border-color 0.15s;
  line-height: 1.5;
  min-height: 44px;
  max-height: 200px;
}
.chat-textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(124, 106, 247, 0.2);
}
.chat-textarea::placeholder {
  color: var(--text3);
}
```

Also update `.send-btn` border-radius to match:

```css
.send-btn {
  padding: 12px 20px;
  background: var(--accent);
  border: none;
  color: white;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 1px;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
  text-transform: uppercase;
  box-shadow: 0 0 0 0 rgba(124, 106, 247, 0);
}
```

- [ ] **Step 2: Update placeholder text in `components/ChatPanel.tsx`**

Find:

```tsx
placeholder = 'How may I assist you today?';
```

Replace with:

```tsx
placeholder = 'Ask Based anything...';
```

- [ ] **Step 3: Verify visually**

Confirm the input area has a softer top border (`#1e1e2a` instead of the heavier `var(--border)`), textarea uses system font, and placeholder reads "Ask Based anything..."

- [ ] **Step 4: Commit**

```bash
git add app/globals.css components/ChatPanel.tsx
git commit -m "style: update chat input border-radius, font, and placeholder text"
```

---

## Task 4: Empty state (chat welcome screen)

Replace the ⬡ symbol + typo'd subtitle with the new gradient icon box and corrected copy.

**Files:**

- Modify: `components/ChatPanel.tsx` (JSX)
- Modify: `app/globals.css` (empty state styles)

- [ ] **Step 1: Update empty state JSX in `components/ChatPanel.tsx`**

Find the `chat-empty` block:

```tsx
<div className="chat-empty">
  <div className="chat-empty-icon">⬡</div>
  <div className="chat-empty-title">ALL IN ALL BASED</div>
  <div className="chat-empty-sub">Making your life easier is what matter.</div>
  <div className="chat-suggestions">
    {SUGGESTIONS.map(s => (
      <button key={s} className="suggestion-btn" onClick={() => send(s)}>
        {s}
      </button>
    ))}
  </div>
</div>
```

Replace with:

```tsx
<div className="chat-empty">
  <div className="chat-empty-logo" />
  <div className="chat-empty-title">BASED</div>
  <div className="chat-empty-sub">Your AI coding assistant. Describe what you want to build.</div>
  <div className="chat-suggestions">
    {SUGGESTIONS.map(s => (
      <button key={s} className="suggestion-btn" onClick={() => send(s)}>
        {s}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 2: Update empty state CSS in `app/globals.css`**

Find and replace all rules under `/* or near */ .chat-empty` and `.chat-empty-icon`, `.chat-empty-title`, `.chat-empty-sub`, `.suggestion-btn`:

```css
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--text3);
}
.chat-empty-logo {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, rgba(124, 106, 247, 0.25), rgba(106, 247, 200, 0.15));
  border-radius: 14px;
  border: 1px solid rgba(124, 106, 247, 0.3);
}
.chat-empty-title {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 3px;
  color: var(--text);
}
.chat-empty-sub {
  font-size: 14px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--text3);
  text-align: center;
  max-width: 280px;
  line-height: 1.7;
}
.chat-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 4px;
}
.suggestion-btn {
  padding: 7px 14px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text2);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}
.suggestion-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
```

- [ ] **Step 3: Verify visually**

Start a fresh browser session (or clear the project). Confirm:

- Gradient icon box (no ⬡ symbol)
- "BASED" in Space Mono with wide letter-spacing
- Subtitle reads "Your AI coding assistant. Describe what you want to build."
- Suggestion chips have no fill, just a border — hover turns them purple

- [ ] **Step 4: Commit**

```bash
git add components/ChatPanel.tsx app/globals.css
git commit -m "style: redesign chat empty state — new icon, fixed copy, cleaner chips"
```

---

## Task 5: No-project landing screen

Make the no-project screen consistent with the chat empty state.

**Files:**

- Modify: `app/page.tsx` (JSX)
- Modify: `app/globals.css` (no-project styles)

- [ ] **Step 1: Update no-project JSX in `app/page.tsx`**

Find:

```tsx
<div className="no-project">
  <div className="no-project-icon">⬡</div>
  <div className="no-project-title">Welcome to Based</div>
  <div className="no-project-sub">Create a new project to get started.</div>
  <button className="new-project-btn-large" onClick={newProject}>
    + New Project
  </button>
</div>
```

Replace with:

```tsx
<div className="no-project">
  <div className="chat-empty-logo" />
  <div className="no-project-title">BASED</div>
  <div className="no-project-sub">Open a project or start a new one.</div>
  <button className="new-project-btn-large" onClick={newProject}>
    + New Project
  </button>
</div>
```

- [ ] **Step 2: Update no-project CSS in `app/globals.css`**

Find and update the `.no-project` block. Remove `.no-project-icon` (replaced by `.chat-empty-logo`):

```css
.no-project {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--text3);
  max-width: 400px;
  margin: auto;
  width: 100%;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.no-project-title {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 3px;
  color: var(--text);
}
.no-project-sub {
  font-size: 14px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--text3);
  text-align: center;
  line-height: 1.7;
}
```

- [ ] **Step 3: Verify visually**

Reload the app without any project selected. Confirm the icon, title, and subtitle match the chat empty state style. The `+ New Project` button should still work.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/globals.css
git commit -m "style: unify no-project screen with chat empty state"
```

---

## Task 6: Header restructure

Replace the individual nav buttons with a pill tab switcher and a secondary controls cluster.

**Files:**

- Modify: `app/page.tsx` (header JSX)
- Modify: `app/globals.css` (header, tab, icon-btn styles)

- [ ] **Step 1: Restructure header JSX in `app/page.tsx`**

Find the entire `<header className="app-header">` block and replace it:

```tsx
<header className="app-header">
  <div className="logo">
    <button className="hamburger" onClick={() => setSidebarOpen(s => !s)}>
      ☰
    </button>
    <img src="/icon-192.png" className="logo-img" alt="Based" />
    <span className="logo-text">BASED</span>
    {currentProject && <span className="project-name-display">{currentProject.name}</span>}
  </div>
  <nav className="header-nav">
    <div className="tab-switcher">
      <button
        className={`tab-btn ${activePanel === 'chat' ? 'active' : ''}`}
        onClick={() => setActivePanel('chat')}
      >
        Chat
      </button>
      <button
        className={`tab-btn ${activePanel === 'editor' ? 'active' : ''}`}
        onClick={() => setActivePanel('editor')}
      >
        Editor
      </button>
      <button
        className={`tab-btn ${activePanel === 'preview' ? 'active' : ''}`}
        onClick={() => setActivePanel('preview')}
      >
        Preview
      </button>
    </div>
    <div className="header-controls">
      <button
        className={`icon-btn ${incognito ? 'incognito-active' : ''}`}
        onClick={() => {
          setIncognito(s => !s);
          setIncognitoMessages([]);
          setActivePanel('chat');
        }}
        title="Temp chat — no memory saved"
      >
        🕵️
      </button>
      <button
        className={`icon-btn ${showSettings ? 'active' : ''}`}
        onClick={() => setShowSettings(s => !s)}
      >
        ⚙
      </button>
      <div className="header-status">
        <span className={`status-dot ${isGenerating ? 'generating' : 'ready'}`}>●</span>
        <span className="status-text">{isGenerating ? 'Generating...' : 'Ready'}</span>
      </div>
    </div>
  </nav>
</header>
```

Also remove the old standalone `<div className="header-status">` block that appeared separately in the header — it is now inside `header-controls`.

- [ ] **Step 2: Add new header CSS to `app/globals.css`**

Replace the `.header-nav`, `.nav-btn`, `.nav-btn:hover`, `.nav-btn.active` rules with:

```css
.header-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.tab-switcher {
  display: flex;
  gap: 1px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 3px;
}
.tab-btn {
  padding: 5px 16px;
  background: transparent;
  border: none;
  color: var(--text2);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 1px;
  cursor: pointer;
  border-radius: 5px;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}
.tab-btn:hover:not(.active) {
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
}
.tab-btn.active {
  background: var(--accent);
  color: #fff;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.icon-btn {
  padding: 5px 8px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text2);
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}
.icon-btn:hover {
  border-color: var(--border);
  color: var(--text);
}
.icon-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}
.icon-btn.incognito-active {
  border-color: #ff6b6b;
  color: #ff6b6b;
}

.status-dot {
  font-size: 10px;
}
.status-dot.ready {
  color: var(--accent3);
}
.status-dot.generating {
  color: var(--accent3);
  animation: pulse 1s infinite;
}
.status-text {
  font-size: 11px;
  color: var(--text3);
}

.header-status {
  display: flex;
  align-items: center;
  gap: 6px;
  border-left: 1px solid var(--border);
  padding-left: 10px;
  margin-left: 2px;
}

@media (max-width: 768px) {
  .header-status {
    display: none;
  }
  .tab-btn {
    padding: 5px 10px;
    font-size: 10px;
  }
}
```

Update `.project-name-display` to use the divider treatment:

```css
.project-name-display {
  font-size: 12px;
  color: var(--text3);
  font-family: var(--font-mono);
  border-left: 1px solid var(--border);
  padding-left: 14px;
  margin-left: 4px;
}
```

- [ ] **Step 3: Verify visually**

Confirm:

- Three labelled tab buttons in a pill container (Chat / Editor / Preview)
- Active tab is a solid purple pill
- Incognito (🕵️) and settings (⚙) are icon-only with border on hover
- Status dot is always visible (teal when ready, animated teal when generating)
- Project name appears inline in the logo area when a project is open
- Hamburger still works on mobile

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/globals.css
git commit -m "style: replace nav buttons with pill tab switcher and icon controls cluster"
```

---

## Task 7: Sidebar active state polish

Update active item styles in the sidebar to match the new color system.

**Files:**

- Modify: `app/globals.css` (sidebar item active states, divider)

- [ ] **Step 1: Update sidebar active state CSS in `app/globals.css`**

Find and update the `.project-item.active`, `.file-item.active`, and `.sidebar-divider` rules:

```css
.project-item.active {
  background: rgba(124, 106, 247, 0.08);
  color: var(--accent);
  border-left-color: var(--accent);
}
.project-item:hover {
  background: var(--bg3);
  color: var(--text);
  border-left-color: var(--border);
}

.file-item.active {
  background: rgba(106, 247, 200, 0.06);
  color: var(--accent3);
  border-left-color: var(--accent3);
}
.file-item:hover {
  background: var(--bg3);
  color: var(--text);
  border-left-color: var(--border);
}

.sidebar-divider {
  height: 1px;
  background: #1e1e2a;
  margin: 4px 12px;
}
```

- [ ] **Step 2: Verify visually**

Open a project with multiple files. Confirm:

- Active project item has subtle purple left-border + background
- Active file has subtle teal left-border + background
- Divider between sections is inset (not edge-to-edge)
- Hover states work on inactive items

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: update sidebar active states to purple/teal, inset divider"
```

---

## Task 8: Color cleanup

Remove pink from all non-destructive uses; verify the accent2 variable is only used for the delete action hover.

**Files:**

- Modify: `app/globals.css`

- [ ] **Step 1: Audit pink usage**

```bash
grep -n "accent2\|f76a8a\|ff6b6b" app/globals.css
```

Expected results: only `.action-btn.danger:hover` using `var(--accent2)` or `#f76a8a`, and the incognito styles using `#ff6b6b`. All other uses should have been removed by earlier tasks.

- [ ] **Step 2: Remove any remaining non-destructive pink references**

If the grep reveals any pink in message styles, nav styles, or status indicators, remove or replace them with the appropriate purple or teal. The only acceptable pink usages are:

- `.action-btn.danger:hover { color: var(--accent2); }` (delete button in sidebar)
- `.icon-btn.incognito-active { border-color: #ff6b6b; color: #ff6b6b; }` (incognito warning state)

- [ ] **Step 3: Verify visually**

Check the app top-to-bottom. Nothing should appear pink except:

- Hovering the delete (✕) button on a project in the sidebar
- When incognito mode is active

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "style: restrict pink accent to destructive actions only"
```

---

## Task 9: Final visual pass

Run through the full app flow and catch any visual regressions.

**Files:**

- Modify: `app/globals.css` (minor tweaks only)

- [ ] **Step 1: Full flow walkthrough**

Check each of these in order:

1. App loads → no-project screen (gradient icon, "BASED", clean CTA)
2. Click "+ New Project" → sidebar opens, project created
3. Chat panel → empty state (gradient icon, suggestions)
4. Send a message → user message (purple left-border, sans-serif prose)
5. Receive a reply → assistant message (teal left-border, muted prose)
6. Switch to Editor tab via pill switcher → editor opens
7. Switch to Preview tab → preview opens
8. Toggle incognito → incognito banner appears, icon-btn turns red
9. Open settings → panel slides in
10. Mobile: resize to <768px → hamburger appears, tabs fit, sidebar slides in

- [ ] **Step 2: Fix any regressions found**

Common things to check for:

- Text that was readable before but lost contrast
- Buttons that lost their hover state
- Mobile layout breaks from the tab switcher (if needed, add a `@media (max-width: 768px)` rule to hide tab labels and show icons instead — but only if it actually breaks)

- [ ] **Step 3: Final commit**

```bash
git add app/globals.css
git commit -m "style: final visual pass — minor polish after redesign"
```

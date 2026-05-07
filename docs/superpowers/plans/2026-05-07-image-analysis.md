# Image Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vision support to the chat — users attach an image alongside their text, it is encoded as base64 and sent to Claude's vision API, and the image appears in the chat history.

**Architecture:** Four files are modified: `app/page.tsx` adds `ContentBlock` type + `contentToString` helper; `app/api/generate/route.ts` maps content blocks to Claude's vision format; `app/api/memory/route.ts` normalises content to text; `components/ChatPanel.tsx` adds the upload button, preview strip, image rendering, and updated send logic. New CSS classes go in `app/globals.css`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Anthropic SDK (vision already supported by `claude-opus-4-6`)

---

## File Map

| Action | Path | What changes |
|--------|------|-------------|
| Modify | `app/page.tsx:17-20` | Add `ContentBlock` type, update `Message.content`, add `contentToString` |
| Modify | `app/api/generate/route.ts:279,285-290` | Add `toClaudeContent()` + `msgToString()`, update message mapping |
| Modify | `app/api/memory/route.ts:25-27` | Normalise `content` to string before building conversation text |
| Modify | `app/globals.css` | Add `.chat-input-row`, `.upload-btn`, `.chat-image-preview`, `.img-clear-btn`, `.chat-img-thumb`; update `.chat-input-area` |
| Modify | `components/ChatPanel.tsx` | `pendingImage` state, `handleFileChange`, `clearPendingImage`, updated `send()`, updated JSX |

---

## Task 1: Add ContentBlock types to app/page.tsx

**Files:**
- Modify: `app/page.tsx:17-20`

- [ ] **Step 1: Replace the Message interface block**

Open `app/page.tsx`. The current lines 17–20 are:

```ts
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}
```

Replace that entire block with:

```ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string };

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export function contentToString(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | grep -v "^$"
```

Expected: the only new errors are in `ChatPanel.tsx` where `m.content` is passed as `string` to `ReactMarkdown` — those are fixed in Task 5. Errors in pre-existing files are pre-existing and can be ignored.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add ContentBlock type and contentToString to Message"
```

---

## Task 2: Update generate API route for vision

**Files:**
- Modify: `app/api/generate/route.ts:252,279,285-290`

- [ ] **Step 1: Add `msgToString` and `toClaudeContent` helper functions**

In `app/api/generate/route.ts`, after the `stripTags` function (which ends around line 252), add these two functions:

```ts
type ApiContentBlock = { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string };

function msgToString(content: string | ApiContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('\n');
}

function toClaudeContent(content: string | ApiContentBlock[], appendText?: string) {
  if (typeof content === 'string') {
    return appendText ? content + appendText : content;
  }
  const blocks: object[] = content.map(block =>
    block.type === 'text'
      ? { type: 'text', text: block.text }
      : { type: 'image', source: { type: 'base64', media_type: block.mediaType, data: block.data } }
  );
  if (appendText) blocks.push({ type: 'text', text: appendText });
  return blocks;
}
```

- [ ] **Step 2: Update lastUserMessage extraction**

Find this line (around line 279):

```ts
const lastUserMessage = recentMessages.filter((m: any) => m.role === 'user').pop()?.content ?? '';
```

Replace it with:

```ts
const lastUserMsg = recentMessages.filter((m: any) => m.role === 'user').pop();
const lastUserMessage = lastUserMsg ? msgToString(lastUserMsg.content) : '';
```

- [ ] **Step 3: Update anthropicMessages mapping**

Find this block (around lines 285–290):

```ts
const anthropicMessages = recentMessages.map((m: any, i: number) => ({
  role: m.role,
  content: i === recentMessages.length - 1 && m.role === 'user'
    ? m.content + context
    : m.content,
}));
```

Replace it with:

```ts
const anthropicMessages = recentMessages.map((m: any, i: number) => ({
  role: m.role,
  content: i === recentMessages.length - 1 && m.role === 'user'
    ? toClaudeContent(m.content, context || undefined)
    : toClaudeContent(m.content),
}));
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | grep "generate/route" | head -20
```

Expected: no errors in `generate/route.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/api/generate/route.ts
git commit -m "feat: add vision support to generate API route"
```

---

## Task 3: Fix memory route for ContentBlock content

**Files:**
- Modify: `app/api/memory/route.ts:25-27`

- [ ] **Step 1: Update conversation builder to normalise content**

Find this block (lines 25–27):

```ts
const conversation = messages
  .map((m: any) => `${m.role.toUpperCase()}: ${m.content}`)
  .join('\n');
```

Replace it with:

```ts
const conversation = messages
  .map((m: any) => {
    const text = typeof m.content === 'string'
      ? m.content
      : (m.content as any[]).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    return `${m.role.toUpperCase()}: ${text}`;
  })
  .join('\n');
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | grep "memory/route" | head -10
```

Expected: no errors in `memory/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/api/memory/route.ts
git commit -m "fix: normalise content blocks to text in memory route"
```

---

## Task 4: Add CSS for image upload UI

**Files:**
- Modify: `app/globals.css:146-148`

- [ ] **Step 1: Update `.chat-input-area` and add new classes**

Find the `.chat-input-area` rule (around line 146):

```css
.chat-input-area {
  padding: 16px 24px; border-top: 1px solid var(--border-subtle); background: var(--bg2);
  display: flex; gap: 12px; align-items: flex-end;
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}
```

Replace it with:

```css
.chat-input-area {
  padding: 16px 24px; border-top: 1px solid var(--border-subtle); background: var(--bg2);
  display: flex; flex-direction: column; gap: 8px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}

.chat-input-row {
  display: flex; gap: 12px; align-items: flex-end;
}
```

- [ ] **Step 2: Add upload button, preview strip, and thumbnail CSS**

Immediately after the `.send-btn:disabled` rule (around line 168), insert:

```css
.upload-btn {
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text2); font-size: 16px; width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0; transition: color 0.15s, border-color 0.15s;
  padding: 0;
}
.upload-btn:hover { color: var(--accent); border-color: var(--accent); }
.upload-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.chat-image-preview {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px;
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
}

.img-clear-btn {
  background: transparent; border: none; color: var(--text2);
  cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px;
  transition: color 0.15s;
}
.img-clear-btn:hover { color: var(--danger); }

.chat-img-thumb {
  width: 64px; height: 64px; object-fit: cover;
  border-radius: 6px; border: 1px solid var(--border); display: block;
}
```

- [ ] **Step 3: Verify the dev server still starts**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Expected: `200`

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat: add CSS for image upload button and preview strip"
```

---

## Task 5: Update ChatPanel with image upload UI and logic

**Files:**
- Modify: `components/ChatPanel.tsx`

This is the largest task. Make changes in order: imports, state, handlers, `send()`, JSX.

- [ ] **Step 1: Update the import line**

Find line 4:
```ts
import { Message, FileNode } from '@/app/page';
```

Replace with:
```ts
import { Message, FileNode, ContentBlock, contentToString } from '@/app/page';
```

- [ ] **Step 2: Add pendingImage state and fileInputRef**

After line 67 (`const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);`), add:

```ts
const [pendingImage, setPendingImage] = useState<{
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  previewUrl: string;
} | null>(null);
const fileInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 3: Add handleFileChange and clearPendingImage after autoResize**

After the `autoResize` function (which ends around line 76), add:

```ts
const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    const [prefix, data] = dataUrl.split(',');
    const mediaType = prefix.split(':')[1].split(';')[0] as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    setPendingImage({ data, mediaType, previewUrl: dataUrl });
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};

const clearPendingImage = () => {
  setPendingImage(null);
  if (fileInputRef.current) fileInputRef.current.value = '';
};
```

- [ ] **Step 4: Replace the `send` function opening lines**

The current `send` function starts (lines 92–99):

```ts
const send = async (text?: string) => {
  const content = text ?? input.trim();
  if (!content || isGenerating) return;
  setInput('');
  setGenProgress(null);
  const userMsg: Message = { role: 'user', content };
  const newMessages = [...messages, userMsg];
  setMessages(newMessages);
  setIsGenerating(true);
```

Replace with:

```ts
const send = async (text?: string) => {
  const trimmed = text ?? input.trim();
  if ((!trimmed && !pendingImage) || isGenerating) return;
  setInput('');
  setGenProgress(null);
  const msgContent: Message['content'] = pendingImage
    ? [
        { type: 'image', mediaType: pendingImage.mediaType, data: pendingImage.data },
        ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
      ]
    : trimmed;
  setPendingImage(null);
  const userMsg: Message = { role: 'user', content: msgContent };
  const newMessages = [...messages, userMsg];
  setMessages(newMessages);
  setIsGenerating(true);
```

- [ ] **Step 5: Update the memory extraction call in the finally block**

Find the memory call in the `finally` block (around lines 228–241):

```ts
if (!incognito) {
  try {
    const finalMessages = [...messages, { role: 'user', content }];
    const memRes = await fetch('/api/memory', {
```

Replace with:

```ts
if (!incognito) {
  try {
    const finalMessages = [...messages, { role: 'user', content: msgContent }].map(m => ({
      role: m.role,
      content: contentToString(m.content),
    }));
    const memRes = await fetch('/api/memory', {
```

- [ ] **Step 6: Update message content rendering**

Find this block (around lines 268–271):

```tsx
{m.role === 'assistant' && genProgress && i === messages.length - 1
  ? <ProgressBar progress={genProgress} />
  : <ReactMarkdown>{m.content}</ReactMarkdown>
}
```

Replace with:

```tsx
{m.role === 'assistant' && genProgress && i === messages.length - 1
  ? <ProgressBar progress={genProgress} />
  : typeof m.content === 'string'
    ? <ReactMarkdown>{m.content}</ReactMarkdown>
    : (m.content as ContentBlock[]).map((block, j) =>
        block.type === 'image'
          ? <img key={j} className="chat-img-thumb" src={`data:${block.mediaType};base64,${block.data}`} alt="uploaded image" />
          : <ReactMarkdown key={j}>{block.text}</ReactMarkdown>
      )
}
```

- [ ] **Step 7: Replace the chat-input-area JSX**

Find the entire `<div className="chat-input-area">` block (lines 278–292):

```tsx
<div className="chat-input-area">
  <textarea
    ref={textareaRef}
    className="chat-textarea"
    value={input}
    onChange={e => { setInput(e.target.value); autoResize(); }}
    onKeyDown={handleKey}
    placeholder="Ask Based anything..."
    rows={1}
    disabled={isGenerating}
  />
  <button className="send-btn" onClick={() => send()} disabled={isGenerating || !input.trim()}>
    Send
  </button>
</div>
```

Replace with:

```tsx
<div className="chat-input-area">
  {pendingImage && (
    <div className="chat-image-preview">
      <img className="chat-img-thumb" src={pendingImage.previewUrl} alt="preview" />
      <button className="img-clear-btn" onClick={clearPendingImage} title="Remove image">✕</button>
    </div>
  )}
  <div className="chat-input-row">
    <button
      className="upload-btn"
      onClick={() => fileInputRef.current?.click()}
      disabled={isGenerating}
      title="Attach image"
      aria-label="Attach image"
    >
      📎
    </button>
    <textarea
      ref={textareaRef}
      className="chat-textarea"
      value={input}
      onChange={e => { setInput(e.target.value); autoResize(); }}
      onKeyDown={handleKey}
      placeholder="Ask Based anything..."
      rows={1}
      disabled={isGenerating}
    />
    <button className="send-btn" onClick={() => send()} disabled={isGenerating || (!input.trim() && !pendingImage)}>
      Send
    </button>
  </div>
  <input
    ref={fileInputRef}
    type="file"
    accept="image/jpeg,image/png,image/webp,image/gif"
    style={{ display: 'none' }}
    onChange={handleFileChange}
  />
</div>
```

- [ ] **Step 8: Verify TypeScript is clean for the new files**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | grep -E "ChatPanel|page\.tsx|generate|memory" | head -20
```

Expected: no errors in any of the modified files.

- [ ] **Step 9: Smoke-test in browser**

The dev server is running at `http://localhost:3000`. Verify:
1. The 📎 button appears to the left of the textarea
2. Clicking 📎 opens a file picker
3. Selecting a JPG/PNG shows a thumbnail preview above the input
4. ✕ button removes the preview
5. Typing text and clicking Send with an image attached sends successfully
6. The image appears in the chat history above your text
7. Claude responds analysing the image
8. Sending text only (no image) still works normally
9. Sending image only (no text) works — 📎 image → Send with empty textarea

- [ ] **Step 10: Commit**

```bash
git add components/ChatPanel.tsx
git commit -m "feat: add image upload to chat with vision support"
```

---

## Task 6: Push to remote

- [ ] **Step 1: Push**

```bash
git push
```

Expected: all commits pushed to `origin/main`.

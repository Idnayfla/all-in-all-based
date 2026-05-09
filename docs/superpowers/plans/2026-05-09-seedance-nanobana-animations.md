# Seedance 2.0 + Nano Banana 2 + Framer Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Nano Banana 2 (image) and Seedance 2.0 (video) FAL models with an animated mode dropdown, fix image-reference generation, and apply Framer Motion animations throughout for a premium feel.

**Architecture:** Extend `/api/image` with a `model` param and `sourceImageData` support; add `/api/video` for Seedance; replace the `imageMode` boolean in ChatPanel with a `generationMode` enum; extract `ModeDropdown` and `GeneratedVideoCard` as new components; wrap all moving UI elements in Framer Motion `motion` primitives.

**Tech Stack:** Next.js 16 App Router, TypeScript, `@fal-ai/client`, Framer Motion v11 (`motion/react`)

---

## File Map

| File | Action | What it does |
|---|---|---|
| `app/page.tsx` | Modify | Add `generated-video` to `ContentBlock` union |
| `app/api/image/route.ts` | Modify | Add `model` param + `sourceImageData` → image-to-image routing |
| `app/api/video/route.ts` | Create | Seedance 2.0 text-to-video + image-to-video |
| `components/ModeDropdown.tsx` | Create | Animated 4-option generation mode dropdown |
| `components/GeneratedVideoCard.tsx` | Create | Option-B video player card with play button |
| `components/ChatPanel.tsx` | Modify | State, send functions, routing, new components, Framer Motion |
| `app/globals.css` | Modify | Styles for ModeDropdown and GeneratedVideoCard |

---

## Task 1: Add `generated-video` to the ContentBlock union

**Files:**
- Modify: `app/page.tsx:18-21`

- [ ] **Step 1: Add the new variant**

In `app/page.tsx`, change lines 18–21 from:
```ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }
  | { type: 'generated-image'; url: string; prompt: string };
```
To:
```ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }
  | { type: 'generated-image'; url: string; prompt: string }
  | { type: 'generated-video'; url: string; prompt: string };
```

- [ ] **Step 2: Type-check**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors introduced.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add generated-video ContentBlock type"
```

---

## Task 2: Extend `/api/image/route.ts` — model selector + image-reference fix

**Files:**
- Modify: `app/api/image/route.ts`

- [ ] **Step 1: Replace the file with the extended version**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 });
  }

  const { prompt, model = 'flux', sourceImageData, sourceMediaType } = await req.json();
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  fal.config({ credentials: process.env.FAL_KEY });

  try {
    let imageUrl: string | undefined;
    if (sourceImageData) {
      const buffer = Buffer.from(sourceImageData, 'base64');
      const blob = new Blob([buffer], { type: sourceMediaType ?? 'image/png' });
      imageUrl = await fal.storage.upload(blob);
    }

    let url: string | undefined;

    if (model === 'nano-banana') {
      if (imageUrl) {
        const result = await fal.subscribe('fal-ai/nano-banana-2/edit', {
          input: { image_url: imageUrl, prompt },
        });
        url = (result.data as any).images?.[0]?.url;
      } else {
        const result = await fal.subscribe('fal-ai/nano-banana-2', {
          input: { prompt, num_images: 1 },
        });
        url = (result.data as any).images?.[0]?.url;
      }
    } else {
      if (imageUrl) {
        const result = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
          input: {
            image_url: imageUrl,
            prompt,
            strength: 0.85,
            num_inference_steps: 28,
            guidance_scale: 3.5,
            num_images: 1,
            enable_safety_checker: true,
          },
        });
        url = (result.data as any).images?.[0]?.url;
      } else {
        const result = await fal.subscribe('fal-ai/flux/dev', {
          input: {
            prompt,
            image_size: 'landscape_4_3',
            num_inference_steps: 28,
            guidance_scale: 3.5,
            num_images: 1,
            enable_safety_checker: true,
          },
        });
        url = (result.data as any).images?.[0]?.url;
      }
    }

    if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });
    return NextResponse.json({ url, prompt });
  } catch (err: any) {
    const detail = err.body ? JSON.stringify(err.body) : (err.message ?? 'Generation failed');
    console.error('[image] FAL error:', err.status, detail);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/image/route.ts
git commit -m "feat: extend /api/image with model param and image-reference support"
```

---

## Task 3: Create `/api/video/route.ts`

**Files:**
- Create: `app/api/video/route.ts`

- [ ] **Step 1: Create the file**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 });
  }

  const { prompt, imageData, mediaType } = await req.json();
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  fal.config({ credentials: process.env.FAL_KEY });

  try {
    let url: string | undefined;

    if (imageData) {
      const buffer = Buffer.from(imageData, 'base64');
      const blob = new Blob([buffer], { type: mediaType ?? 'image/png' });
      const imageUrl = await fal.storage.upload(blob);
      const result = await fal.subscribe('bytedance/seedance-2.0/image-to-video', {
        input: { image_url: imageUrl, prompt },
      });
      url = (result.data as any).video?.url ?? (result.data as any).videos?.[0]?.url;
    } else {
      const result = await fal.subscribe('bytedance/seedance-2.0/text-to-video', {
        input: { prompt },
      });
      url = (result.data as any).video?.url ?? (result.data as any).videos?.[0]?.url;
    }

    if (!url) return NextResponse.json({ error: 'No video returned' }, { status: 500 });
    return NextResponse.json({ url, prompt });
  } catch (err: any) {
    const detail = err.body ? JSON.stringify(err.body) : (err.message ?? 'Video generation failed');
    console.error('[video] FAL error:', err.status, detail);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/video/route.ts
git commit -m "feat: add /api/video route for Seedance 2.0"
```

---

## Task 4: Create `components/ModeDropdown.tsx`

**Files:**
- Create: `components/ModeDropdown.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export type GenerationMode = 'chat' | 'flux' | 'nano-banana' | 'seedance';

const MODES: { value: GenerationMode; icon: string; label: string }[] = [
  { value: 'chat',        icon: '💬', label: 'Chat' },
  { value: 'flux',        icon: '🎨', label: 'Image · FLUX' },
  { value: 'nano-banana', icon: '🍌', label: 'Image · Nano Banana 2' },
  { value: 'seedance',    icon: '🎬', label: 'Video · Seedance 2.0' },
];

interface ModeDropdownProps {
  mode: GenerationMode;
  onChange: (m: GenerationMode) => void;
  disabled: boolean;
}

export default function ModeDropdown({ mode, onChange, disabled }: ModeDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const current = MODES.find(m => m.value === mode) ?? MODES[0];

  return (
    <div ref={ref} className="mode-dropdown">
      <motion.button
        className={`mode-dropdown-btn${mode !== 'chat' ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title="Switch generation mode"
        whileTap={{ scale: 0.93 }}
      >
        <span className="mode-dropdown-icon">{current.icon}</span>
        <motion.span
          className="mode-dropdown-arrow"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >▼</motion.span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="mode-dropdown-panel"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            {MODES.map(m => (
              <button
                key={m.value}
                className={`mode-dropdown-option${mode === m.value ? ' selected' : ''}`}
                onClick={() => { onChange(m.value); setOpen(false); }}
              >
                <span>{m.icon}</span>
                <span className="mode-dropdown-label">{m.label}</span>
                {mode === m.value && <span className="mode-dropdown-check">✓</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ModeDropdown.tsx
git commit -m "feat: add animated ModeDropdown component"
```

---

## Task 5: Create `components/GeneratedVideoCard.tsx`

**Files:**
- Create: `components/GeneratedVideoCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';
import { useState } from 'react';
import { motion } from 'motion/react';

interface GeneratedVideoCardProps {
  url: string;
  prompt: string;
}

export default function GeneratedVideoCard({ url, prompt }: GeneratedVideoCardProps) {
  const [playing, setPlaying] = useState(false);

  return (
    <motion.div
      className="generated-video-wrap"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 350, damping: 28 }}
    >
      <div className="generated-video-thumb">
        {playing ? (
          <video src={url} autoPlay controls className="generated-video-player" />
        ) : (
          <motion.button
            className="generated-video-play-btn"
            onClick={() => setPlaying(true)}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.92 }}
            aria-label="Play video"
          >
            ▶
          </motion.button>
        )}
      </div>
      <div className="generated-image-prompt">{prompt}</div>
      <div className="generated-image-actions">
        <a className="generated-image-download" href={url} download target="_blank" rel="noreferrer">↓ Download</a>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/GeneratedVideoCard.tsx
git commit -m "feat: add GeneratedVideoCard component with animated play button"
```

---

## Task 6: Add CSS for ModeDropdown and GeneratedVideoCard

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Replace `.image-mode-btn` block and add new styles**

Find the `.image-mode-btn` block in `app/globals.css` (around line 238) and replace it with:

```css
/* ── Mode Dropdown ── */
.mode-dropdown { position: relative; flex-shrink: 0; }

.mode-dropdown-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 10px 10px; background: var(--bg3); border: 1px solid var(--border);
  color: var(--text2); font-size: 16px; cursor: pointer; border-radius: 8px;
  transition: border-color 0.15s, color 0.15s, background 0.15s; line-height: 1;
}
.mode-dropdown-btn:hover { background: var(--bg); border-color: var(--accent); color: var(--accent); }
.mode-dropdown-btn.active { background: rgba(124,106,247,0.1); border-color: var(--accent); color: var(--accent); }
.mode-dropdown-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.mode-dropdown-arrow { font-size: 8px; color: var(--text3); display: inline-block; }

.mode-dropdown-panel {
  position: absolute; bottom: calc(100% + 8px); left: 0;
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 10px; padding: 6px; min-width: 210px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5); z-index: 200;
}

.mode-dropdown-option {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 8px 10px; background: none; border: none; border-radius: 7px;
  color: var(--text2); font-family: var(--font-mono); font-size: 12px;
  cursor: pointer; text-align: left; transition: background 0.12s, color 0.12s;
}
.mode-dropdown-option:hover { background: var(--bg3); color: var(--text); }
.mode-dropdown-option.selected { background: rgba(124,106,247,0.12); color: var(--accent); }

.mode-dropdown-label { flex: 1; }
.mode-dropdown-check { font-size: 11px; color: var(--accent); }
.mode-dropdown-icon { font-size: 16px; }
```

Also add the `.send-btn-image` override right after (keep it, just make sure it's still present):
```css
.send-btn-image { background: #9333ea !important; }
.send-btn-image:hover:not(:disabled) { background: #7e22ce !important; }
```

- [ ] **Step 2: Add video card styles after `.generated-image-download:hover`**

After the `.generated-image-download:hover` rule (around line 268), add:

```css
/* ── Generated Video Card ── */
.generated-video-wrap {
  display: flex; flex-direction: column; gap: 8px; max-width: 480px;
}

.generated-video-thumb {
  width: 100%; aspect-ratio: 16/9;
  background: linear-gradient(135deg, #1a1a2e, #16213e);
  border-radius: 10px; border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; position: relative;
}

.generated-video-player {
  width: 100%; height: 100%; display: block; border-radius: 10px;
}

.generated-video-play-btn {
  width: 56px; height: 56px;
  background: rgba(124,106,247,0.85); border: none; border-radius: 50%;
  color: #fff; font-size: 20px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding-left: 4px;
  box-shadow: 0 4px 20px rgba(124,106,247,0.4);
}
```

- [ ] **Step 3: Type-check + dev server sanity**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat: add CSS for ModeDropdown and GeneratedVideoCard"
```

---

## Task 7: Update `components/ChatPanel.tsx` — core changes

**Files:**
- Modify: `components/ChatPanel.tsx`

- [ ] **Step 1: Replace the imports block**

Replace the current imports at the top of `components/ChatPanel.tsx`:

```tsx
'use client';
import { useRef, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Message, FileNode, ContentBlock } from '@/app/page';
import ReactMarkdown from 'react-markdown';
import ImageEditorModal from './ImageEditorModal';
import ModeDropdown, { GenerationMode } from './ModeDropdown';
import GeneratedVideoCard from './GeneratedVideoCard';
```

- [ ] **Step 2: Replace `imageMode` state with `generationMode`**

Find:
```ts
const [imageMode, setImageMode] = useState(false);
```
Replace with:
```ts
const [generationMode, setGenerationMode] = useState<GenerationMode>('chat');
```

- [ ] **Step 3: Replace `sendImage()` — fix image-reference bug**

Replace the entire `sendImage` function:

```ts
const sendImage = async () => {
  const prompt = input.trim();
  if (!prompt || isGenerating || isGeneratingImage) return;
  setInput('');
  setIsGeneratingImage(true);

  const userMsg: Message = { role: 'user', content: prompt };
  const loadingMsg: Message = { role: 'assistant', content: [{ type: 'text', text: '🎨 Generating image...' }] };
  setMessages(prev => [...prev, userMsg, loadingMsg]);

  const body: Record<string, string> = { prompt, model: generationMode === 'nano-banana' ? 'nano-banana' : 'flux' };
  if (pendingImage) {
    body.sourceImageData = pendingImage.data;
    body.sourceMediaType = pendingImage.mediaType;
  }
  setPendingImage(null);

  try {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    setMessages(prev => [
      ...prev.slice(0, -1),
      { role: 'assistant', content: [{ type: 'generated-image', url: data.url, prompt }] },
    ]);
  } catch (err: any) {
    setMessages(prev => [
      ...prev.slice(0, -1),
      { role: 'assistant', content: `❌ Image generation failed: ${err.message}` },
    ]);
  } finally {
    setIsGeneratingImage(false);
  }
};
```

- [ ] **Step 4: Add `sendVideo()` after `sendImage()`**

```ts
const sendVideo = async () => {
  const prompt = input.trim();
  if (!prompt || isGenerating || isGeneratingImage) return;
  setInput('');
  setIsGeneratingImage(true);

  const userMsg: Message = { role: 'user', content: prompt };
  const loadingMsg: Message = { role: 'assistant', content: [{ type: 'text', text: '🎬 Generating video...' }] };
  setMessages(prev => [...prev, userMsg, loadingMsg]);

  const body: Record<string, string> = { prompt };
  if (pendingImage) {
    body.imageData = pendingImage.data;
    body.mediaType = pendingImage.mediaType;
  }
  setPendingImage(null);

  try {
    const res = await fetch('/api/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    setMessages(prev => [
      ...prev.slice(0, -1),
      { role: 'assistant', content: [{ type: 'generated-video', url: data.url, prompt }] },
    ]);
  } catch (err: any) {
    setMessages(prev => [
      ...prev.slice(0, -1),
      { role: 'assistant', content: `❌ Video generation failed: ${err.message}` },
    ]);
  } finally {
    setIsGeneratingImage(false);
  }
};
```

- [ ] **Step 5: Update send-routing helper**

Replace the `handleKey` function:
```ts
const handleKey = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (generationMode === 'seedance') sendVideo();
    else if (generationMode !== 'chat') sendImage();
    else send();
  }
};
```

- [ ] **Step 6: Add `generated-video` to `renderContent`**

Inside `renderContent`, after the `generated-image` block and before the `text` block, add:
```tsx
if (block.type === 'generated-video') {
  return <GeneratedVideoCard key={i} url={block.url} prompt={block.prompt} />;
}
```

- [ ] **Step 7: Replace the toolbar JSX**

In the JSX, replace the `<button className="image-mode-btn"...>` element with:
```tsx
<ModeDropdown
  mode={generationMode}
  onChange={setGenerationMode}
  disabled={isGenerating || isGeneratingImage}
/>
```

Update the send button to use `generationMode`:
```tsx
<button
  className={`send-btn${generationMode !== 'chat' ? ' send-btn-image' : ''}`}
  onClick={() => {
    if (generationMode === 'seedance') sendVideo();
    else if (generationMode !== 'chat') sendImage();
    else send();
  }}
  disabled={isGenerating || isGeneratingImage || (!input.trim() && !pendingImage)}
>
  {isGeneratingImage ? '⏳' : generationMode !== 'chat' ? 'Generate' : 'Send'}
</button>
```

Update the upload button disabled state (enable in all modes, not just when not in image-mode):
```tsx
<button
  className="upload-btn"
  onClick={() => fileInputRef.current?.click()}
  disabled={isGenerating || generationMode === 'chat'}
  title="Attach image"
>📎</button>
```

Update the textarea placeholder:
```tsx
placeholder={
  generationMode === 'seedance' ? 'Describe a video to generate...' :
  generationMode !== 'chat' ? 'Describe an image to generate...' :
  'Ask Based anything...'
}
```

Update the textarea `onKeyDown`:
```tsx
onKeyDown={handleKey}
```

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add components/ChatPanel.tsx
git commit -m "feat: wire ModeDropdown, sendVideo, image-reference fix into ChatPanel"
```

---

## Task 8: Add Framer Motion animations throughout ChatPanel

**Files:**
- Modify: `components/ChatPanel.tsx`

- [ ] **Step 1: Animate the messages list**

Find the messages `map` in the JSX (the block that renders `<div key={i} className={`message ${m.role}`}>`). Wrap the entire list in `<AnimatePresence>` and change each message `<div>` to `<motion.div>`:

```tsx
<AnimatePresence initial={false}>
  {messages.map((m, i) => (
    <motion.div
      key={i}
      className={`message ${m.role}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 35 }}
    >
      <div className="message-role">{m.role === 'user' ? 'YOU' : 'BASED'}</div>
      <div className="message-content">
        {m.role === 'assistant' && genProgress && i === messages.length - 1
          ? <ProgressBar progress={genProgress} />
          : renderContent(m.content)
        }
      </div>
    </motion.div>
  ))}
</AnimatePresence>
```

Note: `initial={false}` prevents the animation from playing on page load for pre-existing messages.

- [ ] **Step 2: Animate suggestion chips**

Find the `SUGGESTIONS.map` block inside `chat-empty`. Replace `<button>` with `<motion.button>`:

```tsx
{SUGGESTIONS.map((s, index) => (
  <motion.button
    key={s}
    className="suggestion-btn"
    onClick={() => send(s)}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.06, type: 'spring', stiffness: 400, damping: 30 }}
    whileHover={{ scale: 1.03 }}
    whileTap={{ scale: 0.97 }}
  >{s}</motion.button>
))}
```

- [ ] **Step 3: Animate the send button**

Change `<button className={`send-btn...`}` to `<motion.button` and add `whileTap={{ scale: 0.95 }}`:

```tsx
<motion.button
  className={`send-btn${generationMode !== 'chat' ? ' send-btn-image' : ''}`}
  onClick={() => {
    if (generationMode === 'seedance') sendVideo();
    else if (generationMode !== 'chat') sendImage();
    else send();
  }}
  disabled={isGenerating || isGeneratingImage || (!input.trim() && !pendingImage)}
  whileTap={{ scale: 0.95 }}
>
  {isGeneratingImage ? '⏳' : generationMode !== 'chat' ? 'Generate' : 'Send'}
</motion.button>
```

- [ ] **Step 4: Animate the pending image preview**

Find the `{pendingImage && (...)}` block. Wrap it in `<AnimatePresence>` and the inner div in `<motion.div>`:

```tsx
<AnimatePresence>
  {pendingImage && (
    <motion.div
      className="chat-image-preview"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <img className="chat-img-thumb" src={pendingImage.previewUrl} alt="pending upload" />
      <button className="img-clear-btn" onClick={clearPendingImage} title="Remove image">✕</button>
    </motion.div>
  )}
</AnimatePresence>
```

- [ ] **Step 5: Animate generated-image cards in `renderContent`**

Find the `generated-image` block in `renderContent`. Wrap its outer `<div>` in `<motion.div>`:

```tsx
if (block.type === 'generated-image') {
  return (
    <motion.div
      key={i}
      className="generated-image-wrap"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 350, damping: 28 }}
    >
      <img className="generated-image" src={block.url} alt={block.prompt} />
      <div className="generated-image-prompt">{block.prompt}</div>
      <div className="generated-image-actions">
        <a className="generated-image-download" href={block.url} download target="_blank" rel="noreferrer">↓ Download</a>
        <button className="generated-image-edit-btn" onClick={() => setEditingImageUrl(block.url)}>✏ Edit</button>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 6: Animate the progress bar fill**

In the `ProgressBar` component, find:
```tsx
<div className="gen-progress-bar-fill" style={{ width: `${pct}%` }} />
```
Replace with:
```tsx
<motion.div
  className="gen-progress-bar-fill"
  animate={{ width: `${pct}%` }}
  transition={{ type: 'spring', stiffness: 120, damping: 20 }}
/>
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add components/ChatPanel.tsx
git commit -m "feat: add Framer Motion animation layer to ChatPanel"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Manual verification checklist**

Open the app in the browser and verify:

1. **ModeDropdown** — click the mode button, dropdown animates open (spring pop). Click each option: Chat, FLUX, Nano Banana 2, Seedance. Arrow rotates 180° when open.
2. **Image mode (FLUX)** — select FLUX, type a prompt, hit Generate. Image appears with scale+fade animation.
3. **Image reference (FLUX)** — select FLUX, attach an image with 📎, type a prompt, Generate. Should use image-to-image.
4. **Nano Banana 2** — select Nano Banana 2, generate an image from text.
5. **Video mode** — select Seedance 2.0, type a prompt, Generate. Video card appears with gradient thumbnail + play button.
6. **Video playback** — click play button, video loads inline.
7. **Messages animate** — new messages slide up from y:12 with spring.
8. **Suggestion chips** — on empty state, chips stagger-fade in.
9. **Send button** — tap produces scale-down spring.
10. **Pending image** — attach image, preview pops in with scale animation; click ✕, it pops out.
11. **Progress bar** — trigger a code generation, bar fill animates smoothly.
12. **Return to chat** — select Chat from dropdown, send/placeholder text returns to default.

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix: address issues found during final verification"
```

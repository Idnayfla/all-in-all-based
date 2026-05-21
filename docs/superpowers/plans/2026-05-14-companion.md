# Based Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent slide-out chat companion with screen capture that overlays any panel in getbased.dev without switching tabs.

**Architecture:** A floating trigger button (fixed, bottom-left) toggles a Framer Motion spring-animated drawer (300px, slides from right). The drawer has its own session-only chat, a lightweight `/api/companion` streaming endpoint (sonnet, no planner pipeline), and two capture modes: preview source snapshot (no permissions) and `getDisplayMedia` screen share.

**Tech Stack:** Next.js App Router, Framer Motion, Anthropic SDK (`claude-sonnet-4-6`), Supabase auth, Web APIs (`getDisplayMedia`)

---

## File Map

| File                             | Action | Responsibility                                                                                            |
| -------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `app/api/companion/route.ts`     | Create | Lightweight SSE streaming endpoint — sonnet + vision, no planner                                          |
| `hooks/useScreenCapture.ts`      | Create | `capturePreview(files)` returns source snapshot; `captureScreen()` returns base64 PNG via getDisplayMedia |
| `components/CompanionDrawer.tsx` | Create | Full drawer UI — messages, capture cards, streaming chat, input                                           |
| `app/globals.css`                | Modify | Companion CSS: drawer surfaces, message bubbles, trigger animations, scan-line, cursor                    |
| `app/page.tsx`                   | Modify | Add `showCompanion` + `isCompanionGenerating` state; render fixed trigger button + `CompanionDrawer`      |

---

## Task 1: API endpoint — `/api/companion/route.ts`

**Files:**

- Create: `app/api/companion/route.ts`

- [ ] **Step 1: Create the file**

```typescript
import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId } from '@/app/api/_auth';

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.APP_ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { messages, personality, memory, screenshot, previewSource } = await req.json();

  const systemParts = [personality];
  if (memory) systemParts.push(`User memory:\n${memory}`);
  const system = systemParts.join('\n\n');

  // Inject screenshot or previewSource into the last user message
  const apiMessages = (messages as Array<{ role: string; content: string }>).map((m, i) => {
    if (i !== messages.length - 1 || m.role !== 'user') return m;

    if (screenshot) {
      const base64 = screenshot.replace(/^data:image\/\w+;base64,/, '');
      return {
        role: 'user' as const,
        content: [
          {
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: 'image/png' as const, data: base64 },
          },
          { type: 'text' as const, text: m.content },
        ],
      };
    }

    if (previewSource) {
      return {
        role: 'user' as const,
        content: `Here is the current preview source:\n\n${previewSource}\n\n${m.content}`,
      };
    }

    return m;
  });

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system,
    messages: apiMessages as Parameters<typeof client.messages.stream>[0]['messages'],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
            );
          }
        }
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

- [ ] **Step 2: Verify the endpoint exists and TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no errors related to `app/api/companion/route.ts`

- [ ] **Step 3: Manual smoke test — start dev server and POST to the endpoint**

Run: `npm run dev`

In a second terminal:

```bash
curl -X POST http://localhost:3000/api/companion \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SKIP_FOR_NOW" \
  -d '{"messages":[{"role":"user","content":"Say hi"}],"personality":"You are Based.","memory":""}'
```

Expected: `401 Unauthorized` (because the token is invalid — auth guard is working). This confirms the route is reachable and auth fires.

- [ ] **Step 4: Commit**

```bash
git add app/api/companion/route.ts
git commit -m "feat: add /api/companion streaming endpoint"
```

---

## Task 2: Screen capture hook — `hooks/useScreenCapture.ts`

**Files:**

- Create: `hooks/useScreenCapture.ts`

- [ ] **Step 1: Create the file**

```typescript
import { FileNode } from '@/app/page';

export interface PreviewCapture {
  source: string;
  label: string;
}

export function capturePreview(files: FileNode[]): PreviewCapture | null {
  const htmlFile = files.find(f => f.language === 'html');
  const cssFile = files.find(f => f.language === 'css');
  const jsFile = files.find(f => f.language === 'javascript' || f.language === 'js');

  if (!htmlFile && !cssFile && !jsFile) return null;

  const parts: string[] = [];
  if (htmlFile) parts.push(`\`\`\`html\n${htmlFile.content}\n\`\`\``);
  if (cssFile) parts.push(`\`\`\`css\n${cssFile.content}\n\`\`\``);
  if (jsFile) parts.push(`\`\`\`js\n${jsFile.content}\n\`\`\``);

  return {
    source: parts.join('\n\n'),
    label: `${files.length} file${files.length !== 1 ? 's' : ''} captured`,
  };
}

export async function captureScreen(): Promise<string | null> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const video = document.createElement('video');
    video.srcObject = stream;
    await new Promise<void>(resolve => {
      video.onloadedmetadata = () => resolve();
    });
    await video.play();

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);

    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;

    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no errors related to `hooks/useScreenCapture.ts`

- [ ] **Step 3: Commit**

```bash
git add hooks/useScreenCapture.ts
git commit -m "feat: add useScreenCapture hook (preview source + getDisplayMedia)"
```

---

## Task 3: CSS — add companion styles to `app/globals.css`

**Files:**

- Modify: `app/globals.css`

- [ ] **Step 1: Append companion styles to the end of `app/globals.css`**

```css
/* ── Companion ─────────────────────────────────────────────────────────── */

/* Floating trigger */
.companion-trigger {
  position: fixed;
  bottom: 24px;
  left: 24px;
  z-index: 9999;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.companion-trigger-rings {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.companion-trigger-ring {
  position: absolute;
  inset: -7px;
  border-radius: 50%;
  border: 1px solid rgba(124, 58, 237, 0.22);
  animation: companion-breathe 3s ease-in-out infinite;
}

.companion-trigger-ring-outer {
  inset: -14px;
  border-color: rgba(124, 58, 237, 0.09);
  animation-delay: 0.5s;
}

.companion-trigger.responding .companion-trigger-ring {
  border-color: rgba(124, 58, 237, 0.6);
  animation: companion-pulse 1s ease-in-out infinite;
}

.companion-trigger.responding .companion-trigger-ring-outer {
  display: none;
}

.companion-trigger-core {
  position: relative;
  z-index: 1;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #7c3aed, #4f46e5);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 800;
  color: white;
  box-shadow: 0 4px 20px rgba(124, 58, 237, 0.45);
  transition:
    box-shadow 0.2s ease,
    transform 0.15s ease;
}

.companion-trigger:hover .companion-trigger-core {
  transform: scale(1.06);
  box-shadow: 0 6px 28px rgba(124, 58, 237, 0.6);
}

.companion-trigger.responding .companion-trigger-core {
  box-shadow: 0 4px 28px rgba(124, 58, 237, 0.7);
}

@keyframes companion-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.6;
  }
  50% {
    transform: scale(1.1);
    opacity: 1;
  }
}

@keyframes companion-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.15);
    opacity: 0.7;
  }
}

/* Drawer */
.companion-drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: 300px;
  height: 100vh;
  z-index: 9998;
  background: #0e0e1a;
  border-left: 1px solid rgba(124, 58, 237, 0.2);
  box-shadow: -1px 0 32px rgba(124, 58, 237, 0.08);
  display: flex;
  flex-direction: column;
}

.companion-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px;
  border-bottom: 1px solid rgba(124, 58, 237, 0.12);
  background: linear-gradient(180deg, #12121e 0%, #0e0e1a 100%);
  flex-shrink: 0;
}

.companion-brand {
  display: flex;
  align-items: center;
  gap: 7px;
}

.companion-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, #7c3aed, #4f46e5);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
  color: white;
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.4);
}

.companion-name {
  font-size: 11px;
  font-weight: 700;
  color: #c4b5fd;
  letter-spacing: 0.08em;
}

.companion-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.companion-session-badge {
  font-size: 8px;
  color: #3a3a5e;
  background: #16162a;
  border: 1px solid #1e1e3e;
  border-radius: 3px;
  padding: 2px 6px;
}

.companion-close {
  background: none;
  border: none;
  color: #444;
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  transition: color 0.15s;
}

.companion-close:hover {
  color: #888;
}

/* Messages */
.companion-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scroll-behavior: smooth;
}

.companion-empty {
  font-size: 12px;
  color: #3a3a5e;
  text-align: center;
  margin-top: 24px;
  line-height: 1.6;
}

.companion-msg-user {
  align-self: flex-end;
  background: rgba(124, 58, 237, 0.15);
  border: 1px solid rgba(124, 58, 237, 0.25);
  border-radius: 10px 10px 2px 10px;
  padding: 8px 11px;
  max-width: 90%;
  font-size: 12px;
  color: #c4b5fd;
  line-height: 1.5;
  word-break: break-word;
}

.companion-msg-assistant {
  align-self: flex-start;
  background: #16162a;
  border-radius: 10px 10px 10px 2px;
  padding: 8px 11px;
  max-width: 95%;
  font-size: 12px;
  color: #8888aa;
  line-height: 1.6;
  word-break: break-word;
}

.companion-msg-assistant code {
  background: #1e1e3e;
  color: #a78bfa;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
}

.companion-cursor {
  display: inline-block;
  width: 7px;
  height: 13px;
  background: #7c3aed;
  border-radius: 1px;
  vertical-align: middle;
  margin-left: 2px;
  animation: companion-blink 1s step-end infinite;
}

@keyframes companion-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* Capture cards */
.companion-capture-card {
  background: #12121e;
  border: 1px solid rgba(124, 58, 237, 0.2);
  border-radius: 10px;
  overflow: hidden;
}

.companion-capture-label {
  padding: 6px 10px;
  font-size: 9px;
  font-weight: 700;
  color: #7c3aed;
  letter-spacing: 0.08em;
  border-bottom: 1px solid rgba(124, 58, 237, 0.1);
  background: rgba(124, 58, 237, 0.05);
}

.companion-capture-thumb {
  position: relative;
  height: 80px;
  overflow: hidden;
  background: #0d0d18;
}

.companion-capture-thumb.scanning::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #7c3aed, transparent);
  animation: companion-scan 1.8s ease-in-out 1 forwards;
}

@keyframes companion-scan {
  0% {
    top: 0;
    opacity: 0;
  }
  8% {
    opacity: 1;
  }
  92% {
    opacity: 1;
  }
  100% {
    top: 100%;
    opacity: 0;
  }
}

.companion-thumb-iframe {
  width: 200%;
  height: 200%;
  transform: scale(0.5);
  transform-origin: top left;
  border: none;
  pointer-events: none;
}

.companion-thumb-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 10px;
  color: #3a3a5e;
}

.companion-capture-img {
  width: 100%;
  height: auto;
  max-height: 100px;
  object-fit: cover;
  display: block;
}

/* Input area */
.companion-input-area {
  padding: 10px 12px;
  border-top: 1px solid rgba(124, 58, 237, 0.1);
  background: #0c0c18;
  flex-shrink: 0;
}

.companion-capture-btns {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.companion-capture-btn {
  flex: 1;
  background: #12121e;
  border: 1px solid #1e1e3e;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 10px;
  color: #555;
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.companion-capture-btn:hover:not(:disabled) {
  border-color: rgba(124, 58, 237, 0.4);
  color: #a78bfa;
}

.companion-capture-btn-active {
  border-color: rgba(124, 58, 237, 0.4);
  color: #a78bfa;
}

.companion-capture-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.companion-input-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.companion-input {
  flex: 1;
  background: #12121e;
  border: 1px solid #1e1e3e;
  border-radius: 7px;
  padding: 8px 11px;
  font-size: 12px;
  color: var(--text1);
  outline: none;
  transition: border-color 0.15s;
}

.companion-input:focus {
  border-color: rgba(124, 58, 237, 0.4);
}

.companion-input::placeholder {
  color: #3a3a5e;
}

.companion-send {
  width: 32px;
  height: 32px;
  border-radius: 7px;
  background: linear-gradient(135deg, #7c3aed, #4f46e5);
  border: none;
  color: white;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.4);
  transition:
    opacity 0.15s,
    transform 0.15s;
}

.companion-send:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
}

.companion-send:not(:disabled):hover {
  transform: scale(1.05);
}
```

- [ ] **Step 2: Verify dev server still compiles without errors**

Run: `npm run dev`

Expected: no CSS parse errors, dev server starts normally.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat: add companion CSS — drawer, trigger, scan-line, cursor"
```

---

## Task 4: Companion Drawer component — `components/CompanionDrawer.tsx`

**Files:**

- Create: `components/CompanionDrawer.tsx`

- [ ] **Step 1: Create the component**

```typescript
'use client';
import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileNode } from '@/app/page';
import { capturePreview, captureScreen, PreviewCapture } from '@/hooks/useScreenCapture';
import { supabase } from '@/lib/supabase';

type CompanionMsg =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string; streaming: boolean }
  | { type: 'capture-preview'; capture: PreviewCapture; previewHtml: string | null }
  | { type: 'capture-screen'; dataUrl: string };

type PendingCapture =
  | { kind: 'preview'; data: PreviewCapture }
  | { kind: 'screen'; dataUrl: string };

interface Props {
  personality: string;
  globalMemory: string;
  activePanel: string;
  files: FileNode[];
  onClose: () => void;
  onGeneratingChange: (v: boolean) => void;
}

export default function CompanionDrawer({
  personality, globalMemory, activePanel, files, onClose, onGeneratingChange,
}: Props) {
  const [messages, setMessages] = useState<CompanionMsg[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [scanningIdx, setScanningIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const setGen = (v: boolean) => {
    setIsGenerating(v);
    onGeneratingChange(v);
  };

  const buildPreviewHtml = (): string | null => {
    const html = files.find(f => f.language === 'html');
    const css = files.find(f => f.language === 'css');
    const js = files.find(f => f.language === 'javascript' || f.language === 'js');
    if (!html) return null;
    let out = html.content;
    if (css) out = out.replace('</head>', `<style>${css.content}</style></head>`);
    if (js) out = out.replace('</body>', `<script>${js.content}</script></body>`);
    return out;
  };

  const handleCapturePreview = () => {
    const capture = capturePreview(files);
    if (!capture) return;
    const idx = messages.length;
    setMessages(prev => [...prev, { type: 'capture-preview', capture, previewHtml: buildPreviewHtml() }]);
    setScanningIdx(idx);
    setTimeout(() => setScanningIdx(null), 1900);
    setPending({ kind: 'preview', data: capture });
  };

  const handleCaptureScreen = async () => {
    const dataUrl = await captureScreen();
    if (!dataUrl) return;
    setMessages(prev => [...prev, { type: 'capture-screen', dataUrl }]);
    setPending({ kind: 'screen', dataUrl });
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput('');

    const capture = pending;
    setPending(null);

    setMessages(prev => [...prev, { type: 'user', text }]);
    setGen(true);
    setMessages(prev => [...prev, { type: 'assistant', text: '', streaming: true }]);

    const apiMessages = messages
      .filter((m): m is Extract<CompanionMsg, { type: 'user' | 'assistant' }> =>
        m.type === 'user' || m.type === 'assistant')
      .map(m => ({ role: m.type, content: m.text }));
    apiMessages.push({ role: 'user', content: text });

    const { data: { session } } = await supabase.auth.getSession();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token ?? ''}`,
    };

    const body: Record<string, unknown> = { messages: apiMessages, personality, memory: globalMemory };
    if (capture?.kind === 'preview') body.previewSource = capture.data.source;
    if (capture?.kind === 'screen') body.screenshot = capture.dataUrl;

    try {
      const res = await fetch('/api/companion', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.body) throw new Error('No body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const raw = decoder.decode(value);
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try {
            const { text: chunk } = JSON.parse(payload) as { text: string };
            setMessages(prev => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.type === 'assistant') next[next.length - 1] = { ...last, text: last.text + chunk };
              return next;
            });
          } catch { /* ignore malformed chunks */ }
        }
      }
    } catch (e) {
      console.error('[Companion] stream error', e);
    }

    setMessages(prev => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last.type === 'assistant') next[next.length - 1] = { ...last, streaming: false };
      return next;
    });
    setGen(false);
  };

  return (
    <motion.div
      className="companion-drawer"
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 300, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
    >
      {/* Header */}
      <div className="companion-header">
        <div className="companion-brand">
          <div className="companion-icon">B</div>
          <span className="companion-name">BASED</span>
        </div>
        <div className="companion-meta">
          <span className="companion-session-badge">session</span>
          <button className="companion-close" onClick={onClose} aria-label="Close companion">×</button>
        </div>
      </div>

      {/* Messages */}
      <div className="companion-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="companion-empty">
            Capture your preview or ask Based anything.
          </div>
        )}
        {messages.map((msg, i) => {
          if (msg.type === 'capture-preview') {
            return (
              <div key={i} className="companion-capture-card">
                <div className="companion-capture-label">📷 Preview captured</div>
                <div className={`companion-capture-thumb${scanningIdx === i ? ' scanning' : ''}`}>
                  {msg.previewHtml ? (
                    <iframe
                      srcDoc={msg.previewHtml}
                      sandbox="allow-scripts"
                      className="companion-thumb-iframe"
                      title="preview thumbnail"
                    />
                  ) : (
                    <div className="companion-thumb-placeholder">{msg.capture.label}</div>
                  )}
                </div>
              </div>
            );
          }
          if (msg.type === 'capture-screen') {
            return (
              <div key={i} className="companion-capture-card">
                <div className="companion-capture-label">🖥 Screen captured</div>
                <img src={msg.dataUrl} className="companion-capture-img" alt="screen capture" />
              </div>
            );
          }
          if (msg.type === 'user') {
            return <div key={i} className="companion-msg-user">{msg.text}</div>;
          }
          if (msg.type === 'assistant') {
            return (
              <div key={i} className="companion-msg-assistant">
                {msg.text}
                {msg.streaming && <span className="companion-cursor" />}
              </div>
            );
          }
          return null;
        })}
      </div>

      {/* Input */}
      <div className="companion-input-area">
        <div className="companion-capture-btns">
          <button
            className={`companion-capture-btn${activePanel === 'preview' ? ' companion-capture-btn-active' : ''}`}
            onClick={handleCapturePreview}
            disabled={files.length === 0}
            title={files.length === 0 ? 'No project files to capture' : 'Capture preview source'}
          >
            📷 Capture preview
          </button>
          <button
            className="companion-capture-btn"
            onClick={handleCaptureScreen}
            title="Share your screen"
          >
            🖥 Share screen
          </button>
        </div>
        <div className="companion-input-row">
          <input
            className="companion-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask Based anything…"
            disabled={isGenerating}
          />
          <button
            className="companion-send"
            onClick={sendMessage}
            disabled={isGenerating || !input.trim()}
            aria-label="Send"
          >↑</button>
        </div>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no errors in `components/CompanionDrawer.tsx`

- [ ] **Step 3: Commit**

```bash
git add components/CompanionDrawer.tsx
git commit -m "feat: add CompanionDrawer component"
```

---

## Task 5: Wire up in `app/page.tsx`

**Files:**

- Modify: `app/page.tsx`

- [ ] **Step 1: Add imports at the top of `app/page.tsx`**

Find the existing import block and add:

```typescript
import CompanionDrawer from '@/components/CompanionDrawer';
```

- [ ] **Step 2: Add companion state to the `Home` component**

Find the line:

```typescript
const [createError, setCreateError] = useState<string | null>(null);
```

Add after it:

```typescript
const [showCompanion, setShowCompanion] = useState(false);
const [isCompanionGenerating, setIsCompanionGenerating] = useState(false);
```

- [ ] **Step 3: Add the fixed floating trigger button**

Find the closing `</div>` of the `app-root` div (the very last `</div>` before the final `return` closing). It's just before:

```tsx
    </div>
  );
}
```

Add the trigger and drawer just before the closing `</div>` of `app-root`:

```tsx
{
  /* Companion trigger */
}
{
  !showSplash && (
    <button
      className={`companion-trigger${isCompanionGenerating ? ' responding' : ''}`}
      onClick={() => setShowCompanion(s => !s)}
      aria-label="Toggle Based companion"
    >
      <div className="companion-trigger-rings">
        <div className="companion-trigger-ring" />
        <div className="companion-trigger-ring companion-trigger-ring-outer" />
      </div>
      <div className="companion-trigger-core">B</div>
    </button>
  );
}

{
  /* Companion drawer */
}
<AnimatePresence>
  {showCompanion && (
    <CompanionDrawer
      personality={personality}
      globalMemory={globalMemory}
      activePanel={activePanel}
      files={files}
      onClose={() => setShowCompanion(false)}
      onGeneratingChange={setIsCompanionGenerating}
    />
  )}
</AnimatePresence>;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no errors in `app/page.tsx`

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: wire companion trigger and drawer into page"
```

---

## Task 6: Manual QA

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Open `http://localhost:3000` in browser. Complete the splash screen.

- [ ] **Step 2: Verify the trigger button appears**

Expected: A purple "B" circle with two breathing rings appears at bottom-left. It does not appear during the splash screen.

- [ ] **Step 3: Verify drawer opens and closes with spring animation**

Click the trigger. Expected: Drawer slides in from the right with a spring feel (slightly overshoots, settles). Click × or the trigger again. Expected: Drawer slides back out smoothly.

- [ ] **Step 4: Verify empty state and basic chat**

With drawer open and no project loaded: empty state text "Capture your preview or ask Based anything." is visible. Both capture buttons should be disabled (grayed out, Capture preview shows tooltip "No project files to capture").

Log in, create a project, send a message to generate some files. Open companion, type a question ("What does this app do?"), hit Enter. Expected: response streams word-by-word with blinking cursor, cursor disappears when done. Trigger pulses while generating.

- [ ] **Step 5: Verify Capture Preview**

With a project that has generated files, switch to Preview panel and open companion. Expected: "Capture preview" button has purple highlight (active state). Click it. Expected: capture card appears with scan-line animation sweeping down, mini iframe thumbnail renders the preview. Type "What's wrong with this layout?" and send. Expected: Based responds with code analysis referencing the actual HTML/CSS.

- [ ] **Step 6: Verify Share Screen**

Click "Share screen". Expected: browser opens screen share picker. Select a window. Expected: screenshot thumbnail appears in the capture card. Send a message. Expected: Based analyzes the screenshot visually.

- [ ] **Step 7: Verify companion is session-only**

Refresh the page. Expected: companion chat history is gone. Main project chat is unaffected.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: Phase 3B — Based ambient companion complete"
```

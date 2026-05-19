# Image Editing Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add FAL-powered image editing and inpainting to the Based chat — full-screen modal with Transform and Inpaint modes, before/after split view, download, and chain-edit support.

**Architecture:** New `/api/image/edit` route selects between two FAL models (`flux/dev/image-to-image` for transform, `flux-pro/inpainting` for inpaint) based on `mode`. New `ImageEditorModal` component is a full-screen overlay with a split left/right canvas area and brush drawing for inpaint masks. `ChatPanel` gets an "Edit" button on every `generated-image` block and mounts the modal.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, `@fal-ai/client` ^1.10.1, HTML Canvas API

---

## File Map

| Action | File                              | Responsibility                                                                             |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------ |
| Create | `app/api/image/edit/route.ts`     | POST endpoint — validates input, uploads mask to FAL storage, calls FAL, returns `{ url }` |
| Create | `components/ImageEditorModal.tsx` | Full-screen editor — tabs, canvas brush, result panel, generate/download/chain/confirm     |
| Modify | `app/globals.css`                 | Append image editor CSS classes                                                            |
| Modify | `components/ChatPanel.tsx`        | Add "Edit" button on `generated-image` blocks + mount modal                                |

---

## Task 1: API Route `/api/image/edit`

**Files:**

- Create: `app/api/image/edit/route.ts`

- [ ] **Step 1: Create the route file**

```ts
// app/api/image/edit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 });
  }

  const body = await req.json();
  const { mode, sourceImageUrl, prompt, maskDataUrl } = body as {
    mode: 'transform' | 'inpaint';
    sourceImageUrl: string;
    prompt: string;
    maskDataUrl?: string;
  };

  if (!mode || !sourceImageUrl || !prompt?.trim()) {
    return NextResponse.json(
      { error: 'mode, sourceImageUrl, and prompt are required' },
      { status: 400 }
    );
  }
  if (mode === 'inpaint' && !maskDataUrl) {
    return NextResponse.json(
      { error: 'maskDataUrl is required for inpaint mode' },
      { status: 400 }
    );
  }

  fal.config({ credentials: process.env.FAL_KEY });

  try {
    if (mode === 'transform') {
      const result = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
        input: {
          image_url: sourceImageUrl,
          prompt,
          strength: 0.85,
          image_size: 'landscape_4_3',
          num_inference_steps: 28,
          guidance_scale: 3.5,
          num_images: 1,
          enable_safety_checker: true,
        },
      });
      const url = (result.data as any).images?.[0]?.url;
      if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });
      return NextResponse.json({ url });
    }

    // inpaint: upload mask data URL to FAL storage, then call inpainting model
    const base64 = maskDataUrl!.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    const maskBlob = new Blob([buffer], { type: 'image/png' });
    const maskUrl = await fal.storage.upload(maskBlob);

    const result = await fal.subscribe('fal-ai/flux-pro/inpainting', {
      input: {
        image_url: sourceImageUrl,
        mask_url: maskUrl,
        prompt,
        num_images: 1,
        enable_safety_checker: true,
      },
    });
    const url = (result.data as any).images?.[0]?.url;
    if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 500 });
    return NextResponse.json({ url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Edit failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit
```

Expected: no new errors (pre-existing errors unrelated to this file are fine).

- [ ] **Step 3: Commit**

```bash
git add app/api/image/edit/route.ts
git commit -m "feat: add /api/image/edit route for transform and inpaint"
```

---

## Task 2: Modal CSS

**Files:**

- Modify: `app/globals.css` (append to end)

- [ ] **Step 1: Append image editor CSS to the bottom of `app/globals.css`**

Add the following block after the last existing rule:

```css
/* ── Image Editor Modal ──────────────────────────── */
.image-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(10, 10, 15, 0.97);
  display: flex;
  flex-direction: column;
}
.image-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  flex-shrink: 0;
}
.image-editor-title {
  font-size: 12px;
  color: var(--accent);
  font-weight: 600;
  letter-spacing: 2px;
  font-family: var(--font-mono);
}
.image-editor-tabs {
  display: flex;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}
.image-editor-tab {
  padding: 5px 16px;
  background: transparent;
  border: none;
  color: var(--text2);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 1px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
}
.image-editor-tab.active {
  background: var(--accent);
  color: #fff;
}
.image-editor-close {
  background: none;
  border: none;
  color: var(--text3);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: color 0.15s;
  line-height: 1;
}
.image-editor-close:hover {
  color: var(--text);
}
.image-editor-canvas-area {
  flex: 1;
  display: flex;
  min-height: 0;
}
.image-editor-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 10px;
  min-height: 0;
}
.image-editor-pane + .image-editor-pane {
  border-left: 1px solid var(--border);
}
.image-editor-pane-label {
  font-size: 9px;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-family: var(--font-mono);
  flex-shrink: 0;
}
.image-editor-image-wrap {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: var(--bg3);
  border-radius: 8px;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}
.image-editor-source {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  display: block;
  user-select: none;
}
.image-editor-canvas {
  position: absolute;
  cursor: crosshair;
  touch-action: none;
}
.image-editor-brush-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.image-editor-brush-btn {
  padding: 5px 10px;
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--text2);
  font-size: 11px;
  cursor: pointer;
  border-radius: 5px;
  font-family: var(--font-mono);
  transition: all 0.15s;
}
.image-editor-brush-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.image-editor-brush-size {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--text3);
  font-family: var(--font-mono);
}
.image-editor-brush-size input[type='range'] {
  width: 80px;
  accent-color: var(--accent);
  cursor: pointer;
}
.image-editor-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--text3);
  font-size: 12px;
  font-family: var(--font-mono);
}
.image-editor-result {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  display: block;
}
.image-editor-result-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.image-editor-error {
  color: var(--danger);
  font-size: 12px;
  font-family: var(--font-mono);
  padding: 8px 12px;
  background: rgba(255, 107, 107, 0.08);
  border-radius: 6px;
  border: 1px solid rgba(255, 107, 107, 0.2);
  flex-shrink: 0;
}
.image-editor-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}
.image-editor-prompt {
  flex: 1;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text);
  font-family: var(--font-mono);
  outline: none;
  resize: none;
  height: 42px;
  transition: border-color 0.15s;
}
.image-editor-prompt:focus {
  border-color: var(--accent);
}
.image-editor-generate-btn {
  padding: 10px 20px;
  background: var(--accent);
  border: none;
  color: #fff;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 1px;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}
.image-editor-generate-btn:hover:not(:disabled) {
  background: #6857e0;
}
.image-editor-generate-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.image-editor-confirm-btn {
  padding: 10px 16px;
  background: var(--bg3);
  border: 1px solid var(--accent3);
  color: var(--accent3);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}
.image-editor-confirm-btn:hover:not(:disabled) {
  background: rgba(106, 247, 200, 0.1);
}
.image-editor-confirm-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.image-editor-chain-btn {
  padding: 5px 10px;
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--text2);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
  border-radius: 5px;
  transition: all 0.15s;
}
.image-editor-chain-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.image-editor-download-link {
  font-size: 11px;
  color: var(--accent);
  text-decoration: none;
  padding: 5px 10px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  transition: all 0.15s;
  font-family: var(--font-mono);
}
.image-editor-download-link:hover {
  background: rgba(124, 106, 247, 0.15);
}
.generated-image-edit-btn {
  font-size: 11px;
  color: var(--text2);
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 4px 8px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: var(--font-mono);
  align-self: flex-start;
}
.generated-image-edit-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "feat: add image editor modal CSS"
```

---

## Task 3: `ImageEditorModal` Component

**Files:**

- Create: `components/ImageEditorModal.tsx`

**Key implementation notes:**

- `clearCanvas` and `positionCanvas` must be `useCallback` so they can be safely listed as deps in `useEffect`
- Canvas `width`/`height` attributes are set to the image's `naturalWidth`/`naturalHeight` so the exported mask PNG aligns pixel-perfectly with the source image when sent to FAL
- Canvas CSS position is calculated from `getBoundingClientRect()` relative to its parent so it overlays the image element exactly regardless of flex centering
- A second `useEffect` handles the case where the user switches to Inpaint mode after the image has already loaded (re-calls `positionCanvas`)

- [ ] **Step 1: Create the component**

```tsx
// components/ImageEditorModal.tsx
'use client';
import { useRef, useState, useEffect, useCallback } from 'react';

interface ImageEditorModalProps {
  sourceImageUrl: string;
  onConfirm: (resultUrl: string, prompt: string) => void;
  onClose: () => void;
}

type Mode = 'transform' | 'inpaint';

export default function ImageEditorModal({
  sourceImageUrl,
  onConfirm,
  onClose,
}: ImageEditorModalProps) {
  const [mode, setMode] = useState<Mode>('transform');
  const [prompt, setPrompt] = useState('');
  const [currentSourceUrl, setCurrentSourceUrl] = useState(sourceImageUrl);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(24);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const strokeHistory = useRef<ImageData[]>([]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokeHistory.current = [];
  }, []);

  const positionCanvas = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const rect = img.getBoundingClientRect();
    const parentRect = img.parentElement!.getBoundingClientRect();
    canvas.style.left = `${rect.left - parentRect.left}px`;
    canvas.style.top = `${rect.top - parentRect.top}px`;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }, []);

  // Reset result + canvas when source or mode changes
  useEffect(() => {
    setResultUrl(null);
    setError(null);
    clearCanvas();
  }, [currentSourceUrl, mode, clearCanvas]);

  // Re-position canvas when switching to inpaint if image already loaded
  useEffect(() => {
    if (mode === 'inpaint' && imgRef.current?.complete) {
      positionCanvas();
    }
  }, [mode, positionCanvas]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    strokeHistory.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    isDrawing.current = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = brushSize * (canvas.width / rect.width);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    isDrawing.current = false;
  };

  const undoStroke = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const prev = strokeHistory.current.pop();
    if (prev) ctx.putImageData(prev, 0, 0);
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setResultUrl(null);

    const maskDataUrl =
      mode === 'inpaint' && canvasRef.current
        ? canvasRef.current.toDataURL('image/png')
        : undefined;

    try {
      const res = await fetch('/api/image/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, sourceImageUrl: currentSourceUrl, prompt, maskDataUrl }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResultUrl(data.url);
    } catch (err: any) {
      setError(err.message ?? 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleChain = () => {
    if (!resultUrl) return;
    setCurrentSourceUrl(resultUrl);
    // useEffect on currentSourceUrl clears result + canvas
  };

  const handleConfirm = () => {
    if (!resultUrl) return;
    onConfirm(resultUrl, prompt);
    onClose();
  };

  return (
    <div className="image-editor-overlay">
      <div className="image-editor-header">
        <div className="image-editor-title">✏ EDIT IMAGE</div>
        <div className="image-editor-tabs">
          <button
            className={`image-editor-tab${mode === 'transform' ? ' active' : ''}`}
            onClick={() => setMode('transform')}
          >
            Transform
          </button>
          <button
            className={`image-editor-tab${mode === 'inpaint' ? ' active' : ''}`}
            onClick={() => setMode('inpaint')}
          >
            Inpaint
          </button>
        </div>
        <button className="image-editor-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="image-editor-canvas-area">
        <div className="image-editor-pane">
          <div className="image-editor-pane-label">Original</div>
          <div className="image-editor-image-wrap">
            <img
              ref={imgRef}
              src={currentSourceUrl}
              alt="source"
              className="image-editor-source"
              onLoad={positionCanvas}
              draggable={false}
            />
            {mode === 'inpaint' && (
              <canvas
                ref={canvasRef}
                className="image-editor-canvas"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
            )}
          </div>
          {mode === 'inpaint' && (
            <div className="image-editor-brush-tools">
              <button className="image-editor-brush-btn" onClick={undoStroke}>
                ↩ Undo
              </button>
              <button className="image-editor-brush-btn" onClick={clearCanvas}>
                ⬜ Clear
              </button>
              <div className="image-editor-brush-size">
                <span>Size</span>
                <input
                  type="range"
                  min={8}
                  max={60}
                  value={brushSize}
                  onChange={e => setBrushSize(Number(e.target.value))}
                />
                <span>{brushSize}px</span>
              </div>
            </div>
          )}
        </div>

        <div className="image-editor-pane">
          <div className="image-editor-pane-label">Result</div>
          <div className="image-editor-image-wrap">
            {isGenerating ? (
              <div className="image-editor-placeholder">⏳ Generating…</div>
            ) : resultUrl ? (
              <img src={resultUrl} alt="result" className="image-editor-result" />
            ) : (
              <div className="image-editor-placeholder">generate to see result</div>
            )}
          </div>
          {resultUrl && !isGenerating && (
            <div className="image-editor-result-actions">
              <a
                className="image-editor-download-link"
                href={resultUrl}
                download
                target="_blank"
                rel="noreferrer"
              >
                ↓ Download
              </a>
              <button className="image-editor-chain-btn" onClick={handleChain}>
                ↺ Edit this
              </button>
            </div>
          )}
          {error && <div className="image-editor-error">❌ {error}</div>}
        </div>
      </div>

      <div className="image-editor-footer">
        <textarea
          className="image-editor-prompt"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={
            mode === 'inpaint'
              ? 'Describe what to put in the masked area…'
              : 'Describe how to transform the image…'
          }
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleGenerate();
            }
          }}
        />
        <button
          className="image-editor-generate-btn"
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
        >
          {isGenerating ? '⏳' : 'Generate'}
        </button>
        <button
          className="image-editor-confirm-btn"
          onClick={handleConfirm}
          disabled={!resultUrl || isGenerating}
        >
          Confirm ✓
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/ImageEditorModal.tsx
git commit -m "feat: add ImageEditorModal — transform/inpaint/chain/download/confirm"
```

---

## Task 4: ChatPanel Integration

**Files:**

- Modify: `components/ChatPanel.tsx`

Four edits in this file:

1. Add import for `ImageEditorModal`
2. Add `editingImageUrl` state
3. Add "✏ Edit" button inside the `generated-image` renderer in `renderContent`
4. Mount `<ImageEditorModal>` at the bottom of the `chat-panel` div

- [ ] **Step 1: Add import**

At the top of `components/ChatPanel.tsx`, after the last existing import line, add:

```ts
import ImageEditorModal from './ImageEditorModal';
```

- [ ] **Step 2: Add state**

Inside the `ChatPanel` function body, after the existing `const [pendingImage, setPendingImage] = useState<...>(null);` declaration, add:

```ts
const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null);
```

- [ ] **Step 3: Add "Edit" button to `generated-image` blocks**

In `renderContent`, find the `if (block.type === 'generated-image')` branch. The current return is:

```tsx
return (
  <div key={i} className="generated-image-wrap">
    <img className="generated-image" src={block.url} alt={block.prompt} />
    <div className="generated-image-prompt">{block.prompt}</div>
    <a
      className="generated-image-download"
      href={block.url}
      download
      target="_blank"
      rel="noreferrer"
    >
      ↓ Download
    </a>
  </div>
);
```

Replace the entire branch with:

```tsx
return (
  <div key={i} className="generated-image-wrap">
    <img className="generated-image" src={block.url} alt={block.prompt} />
    <div className="generated-image-prompt">{block.prompt}</div>
    <div style={{ display: 'flex', gap: '8px' }}>
      <a
        className="generated-image-download"
        href={block.url}
        download
        target="_blank"
        rel="noreferrer"
      >
        ↓ Download
      </a>
      <button className="generated-image-edit-btn" onClick={() => setEditingImageUrl(block.url)}>
        ✏ Edit
      </button>
    </div>
  </div>
);
```

- [ ] **Step 4: Mount the modal**

In the `ChatPanel` return statement, the outermost element is `<div className="chat-panel">`. Add the modal just before its closing tag:

```tsx
{
  editingImageUrl && (
    <ImageEditorModal
      sourceImageUrl={editingImageUrl}
      onConfirm={(resultUrl, confirmedPrompt) => {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: [{ type: 'generated-image', url: resultUrl, prompt: confirmedPrompt }],
          },
        ]);
        setEditingImageUrl(null);
      }}
      onClose={() => setEditingImageUrl(null)}
    />
  );
}
```

- [ ] **Step 5: Type-check and lint**

```bash
cd /workspaces/all-in-all-based && npx tsc --noEmit && npm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/ChatPanel.tsx
git commit -m "feat: wire ImageEditorModal into ChatPanel — Edit button on generated images"
```

---

## Manual Smoke Test

After all four tasks are committed, run `npm run dev` and verify:

1. Open a project → Chat tab → switch to image mode (🎨)
2. Type `a serene mountain lake at dawn` → Generate → wait for image
3. Click **✏ Edit** on the generated image — modal opens full-screen
4. **Transform tab active by default** — no brush tools visible
5. Type `make the sky purple and add stars` → Generate
6. Right panel shows ⏳ then result image
7. Click **↓ Download** — file downloads
8. Click **↺ Edit this** — left panel source swaps to result, right panel clears
9. Click **Inpaint** tab — brush tools appear below left panel
10. Paint a white stroke over part of the image with the mouse
11. Type `replace with a glowing portal` → Generate
12. Click **Confirm ✓** — modal closes, new chat message appears with edited image and **✏ Edit** + **↓ Download** buttons

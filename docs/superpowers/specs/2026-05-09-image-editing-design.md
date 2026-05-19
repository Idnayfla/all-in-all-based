# Image Editing Feature — Design Spec

**Date:** 2026-05-09  
**Status:** Approved  
**Stack:** Next.js App Router, TypeScript, FAL AI (`@fal-ai/client`)

---

## Overview

Add image editing and inpainting to the Based chat interface, modelled on ChatGPT's image editing UX. Users can click "Edit" on any generated image to open a full-screen editor modal with two modes: Transform (rewrite the whole image) and Inpaint (paint a mask over a region, then rewrite just that area). Results appear side-by-side with the original; users confirm to send the result as a new chat message, download it, or chain another edit from it.

---

## Architecture

### New files

| File                              | Purpose                               |
| --------------------------------- | ------------------------------------- |
| `app/api/image/edit/route.ts`     | POST endpoint for transform + inpaint |
| `components/ImageEditorModal.tsx` | Full-screen editor modal              |

### Existing files touched

| File                       | Change                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| `components/ChatPanel.tsx` | Add "Edit" button on `generated-image` blocks; add modal open/close state |

No changes to `app/api/image/route.ts`, `app/api/generate/route.ts`, or any other existing file.

---

## API Route — `/api/image/edit`

### Request

```ts
POST /api/image/edit
{
  mode: 'transform' | 'inpaint';
  sourceImageUrl: string;   // FAL CDN URL from a previous generation
  prompt: string;
  maskDataUrl?: string;     // base64 PNG data URL, inpaint mode only
}
```

### FAL models

| Mode      | FAL model                        |
| --------- | -------------------------------- |
| transform | `fal-ai/flux/dev/image-to-image` |
| inpaint   | `fal-ai/flux-pro/inpainting`     |

### Response

```ts
{
  url: string;
} // success
{
  error: string;
} // failure — 400 or 500
```

The response shape is identical to `/api/image` so `ChatPanel` can handle both the same way.

### Error handling

- Missing `FAL_KEY` → 500
- Missing required fields → 400 with descriptive message
- FAL throws → catch, return `{ error: err.message }` with status 500
- Expired/unreachable `sourceImageUrl` → FAL will error; surfaced as 500 with FAL's message

---

## Component — `ImageEditorModal`

### Props

```ts
interface ImageEditorModalProps {
  sourceImageUrl: string;
  onConfirm: (resultUrl: string, prompt: string) => void;
  onClose: () => void;
}
```

### Layout

Full-screen overlay (fixed inset-0, z-index above everything). Three zones:

1. **Header bar** — "EDIT IMAGE" title, Transform/Inpaint tab toggle, close (✕) button
2. **Canvas area** — split 50/50 left (Original) / right (Result)
   - Left: source image displayed; in Inpaint mode, a transparent canvas overlay enables brush painting
   - Right: shows result image once generated; empty placeholder before first generation
3. **Footer bar** — prompt textarea, Generate button, Download link (once result exists), Confirm button (once result exists)

### Inpaint canvas

- HTML `<canvas>` element positioned absolute over the source image, same display dimensions
- Canvas internal resolution matches source image _natural_ dimensions (`naturalWidth` × `naturalHeight`) so the mask aligns pixel-perfectly when sent to FAL
- Mouse/touch events draw white semi-transparent strokes (the mask)
- Brush size: slider (8–60px range), default 24px
- Undo: stores stroke history, pops last stroke on click
- Clear: wipes canvas entirely
- On Generate: `canvas.toDataURL('image/png')` sent as `maskDataUrl`

### Transform mode

Brush tools hidden. Source image displayed read-only. Prompt + Generate only.

### Result panel states

| State         | Display                                                              |
| ------------- | -------------------------------------------------------------------- |
| No result yet | Dim placeholder: "generate to see result"                            |
| Generating    | Spinner / "Generating…" text                                         |
| Result ready  | Result image + Download link + "↺ Edit this" button + Confirm button |
| Error         | Red error message inline                                             |

### Chaining edits ("↺ Edit this")

The modal tracks `currentSourceUrl` as internal state, initialized from the `sourceImageUrl` prop. This allows the source to be swapped without closing and reopening the modal.

Clicking "↺ Edit this" on a result:

- Sets `currentSourceUrl` to the result URL (re-renders left canvas with new source)
- Clears mask canvas
- Clears result panel
- Keeps modal open, keeps current mode and prompt

### Confirm flow

`onConfirm(resultUrl, prompt)` is called. `ChatPanel` appends:

```ts
{ role: 'assistant', content: [{ type: 'generated-image', url: resultUrl, prompt }] }
```

Same `ContentBlock` type already rendered by `renderContent()` — no new rendering logic needed.

---

## ChatPanel changes

- `generated-image` blocks get a small "✏ Edit" button rendered below the image (alongside existing Download link)
- New state: `editingImageUrl: string | null`
- When "Edit" clicked: `setEditingImageUrl(block.url)`
- `ImageEditorModal` rendered conditionally when `editingImageUrl !== null`
- `onConfirm`: append new assistant message, close modal
- `onClose`: `setEditingImageUrl(null)`

---

## Out of scope

- Model selection UI (models are fixed per mode)
- Brush hardness / opacity controls
- Zoom / pan on canvas
- Saving edit history across sessions
- Uploading a new image from disk directly into the editor (existing upload button in chat is separate)

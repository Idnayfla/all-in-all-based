# Design: Seedance 2.0 + Nano Banana 2 + Framer Motion Animations

**Date:** 2026-05-09  
**Status:** Approved

## Summary

Add two new FAL AI generation models (Nano Banana 2 for images, Seedance 2.0 for video) to the chat interface, replace the existing image-mode toggle with an animated multi-model dropdown, fix the image-reference bug in image generation, and apply Framer Motion animations throughout the app for a premium feel.

---

## 1. Backend

### 1a. Extend `/api/image/route.ts`

Accept two additional optional fields in the request body:

- `model: 'flux' | 'nano-banana'` (default: `'flux'`)
- `sourceImageData: string` — base64-encoded image (no data-URL prefix)
- `sourceMediaType: string` — e.g. `'image/png'`

**Routing logic:**

| model | sourceImageData present? | FAL model called |
|---|---|---|
| `flux` | no | `fal-ai/flux/dev` (existing) |
| `flux` | yes | `fal-ai/flux/dev/image-to-image` (upload base64 to FAL storage first) |
| `nano-banana` | no | `fal-ai/nano-banana-2` |
| `nano-banana` | yes | `fal-ai/nano-banana-2/edit` (upload base64 to FAL storage first) |

Input shapes:
- `fal-ai/nano-banana-2`: `{ prompt, num_images: 1 }`
- `fal-ai/nano-banana-2/edit`: `{ image_url, prompt }` — maskless semantic editing, no mask required
- `fal-ai/flux/dev/image-to-image`: `{ image_url, prompt, strength: 0.85, num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, enable_safety_checker: true }`

When `sourceImageData` is present: upload a `Blob` to `fal.storage.upload()` to get a URL, then pass that URL as `image_url`.

Response shape unchanged: `{ url, prompt }`.

### 1b. New `/api/video/route.ts`

Request body: `{ prompt: string, imageData?: string, mediaType?: string }`

**Routing logic:**

- If `imageData` present: upload to FAL storage → call `bytedance/seedance-2.0/image-to-video` with `{ image_url, prompt }`
- Otherwise: call `bytedance/seedance-2.0/text-to-video` with `{ prompt }`

Response: `{ url, prompt }`

Error handling: same pattern as existing routes (check `FAL_KEY`, validate required fields, return `err.message` on catch with console.error of `err.body`).

---

## 2. Types (`app/page.tsx`)

Add `generated-video` to the `ContentBlock` union:

```ts
| { type: 'generated-video'; url: string; prompt: string }
```

---

## 3. Frontend — ChatPanel

### 3a. State change

Replace:
```ts
const [imageMode, setImageMode] = useState(false);
```
With:
```ts
type GenerationMode = 'chat' | 'flux' | 'nano-banana' | 'seedance';
const [generationMode, setGenerationMode] = useState<GenerationMode>('chat');
```

### 3b. `sendImage()` fix — use pendingImage as reference

When `pendingImage` is set and `generationMode` is `'flux'` or `'nano-banana'`, include `sourceImageData` and `sourceMediaType` in the `/api/image` POST body. After sending, clear `pendingImage`.

When `generationMode` is `'seedance'`, call `sendVideo()` instead (see below).

### 3c. `sendVideo()`

New function mirroring `sendImage()`:
- Loading message: `'🎬 Generating video...'`
- POST to `/api/video` with `{ prompt, imageData?, mediaType? }` (include pending image data if present)
- On success: append `{ type: 'generated-video', url, prompt }` content block
- On error: same error message pattern as `sendImage()`
- Clears `pendingImage` after call

### 3d. Send routing

```ts
// on Enter / Send button click:
if (generationMode === 'chat') send();
else if (generationMode === 'seedance') sendVideo();
else sendImage(); // flux or nano-banana
```

Placeholder text by mode:
- `chat`: `'Ask Based anything...'`
- `flux` / `nano-banana`: `'Describe an image to generate...'`
- `seedance`: `'Describe a video to generate...'`

Send button label by mode:
- `chat`: `'Send'`
- `flux` / `nano-banana`: `'Generate'`
- `seedance`: `'Generate'`

### 3e. Upload button

Disable `📎` when `generationMode === 'chat'` (existing behaviour). Enable for all generation modes — uploaded image becomes a reference input for image-to-image or image-to-video.

---

## 4. New Component — `ModeDropdown`

**File:** `components/ModeDropdown.tsx`

Props:
```ts
{ mode: GenerationMode; onChange: (m: GenerationMode) => void; disabled: boolean }
```

Renders a button showing the current mode icon + `▼`. On click, toggles `open` state.

Dropdown panel uses Framer Motion `AnimatePresence` + `motion.div`:
- `initial={{ opacity: 0, y: -8, scale: 0.97 }}`
- `animate={{ opacity: 1, y: 0, scale: 1 }}`
- `exit={{ opacity: 0, y: -8, scale: 0.97 }}`
- `transition={{ type: 'spring', stiffness: 400, damping: 30 }}`

Options (top to bottom):
| Choice | Icon | Label |
|---|---|---|
| `chat` | 💬 | Chat |
| `flux` | 🎨 | Image · FLUX |
| `nano-banana` | 🍌 | Image · Nano Banana 2 |
| `seedance` | 🎬 | Video · Seedance 2.0 |

Clicking an option sets the mode and closes the dropdown. A `useEffect` with `mousedown` listener on `document` closes the dropdown when clicking outside.

Active option shown with a highlighted background + checkmark.

Replace the existing `<button className="image-mode-btn">` in ChatPanel with `<ModeDropdown ... />`.

---

## 5. New Component — `GeneratedVideoCard`

**File:** `components/GeneratedVideoCard.tsx` (or inline in ChatPanel `renderContent`)

Props: `{ url: string; prompt: string }`

**Anatomy:**
- `motion.div` wrapper: entry animation `initial={{ opacity: 0, scale: 0.95 }}` → `animate={{ opacity: 1, scale: 1 }}`, spring transition
- Thumbnail area: dark gradient placeholder (`background: linear-gradient(135deg, #1a1a2e, #16213e)`)
  - When `playing === false`: centred purple play button (Framer Motion `whileHover={{ scale: 1.1 }}`, `whileTap={{ scale: 0.95 }}`)
  - When `playing === true`: `<video src={url} autoPlay controls className="generated-video" />`
- Prompt caption below
- Download link (`<a href={url} download target="_blank">↓ Download</a>`)

Local state: `const [playing, setPlaying] = useState(false)`. Clicking the play button sets `playing = true`.

---

## 6. Framer Motion Animation Layer

Apply to existing components in ChatPanel:

### Messages
Wrap the messages list with `<AnimatePresence>`. Each message `<div>` becomes:
```tsx
<motion.div
  key={i}
  initial={{ opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ type: 'spring', stiffness: 400, damping: 35 }}
>
```

### Generated image cards
Wrap the `generated-image` block in:
```tsx
<motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
  transition={{ type: 'spring', stiffness: 350, damping: 28 }} />
```

### Suggestion chips
Wrap each chip in `motion.button` with staggered entry:
```tsx
<motion.button
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: index * 0.06, type: 'spring', stiffness: 400, damping: 30 }}
  whileHover={{ scale: 1.03 }}
  whileTap={{ scale: 0.97 }}
/>
```

### Send button
Add `whileTap={{ scale: 0.95 }}` via `motion.button`.

### Progress bar fill
Replace the CSS-width div with:
```tsx
<motion.div
  className="gen-progress-bar-fill"
  animate={{ width: `${pct}%` }}
  transition={{ type: 'spring', stiffness: 120, damping: 20 }}
/>
```

### Image preview (pending upload)
Wrap in `motion.div` with `initial={{ opacity: 0, scale: 0.9 }}` → `animate={{ opacity: 1, scale: 1 }}`.

---

## 7. Files Changed / Created

| File | Change |
|---|---|
| `app/api/image/route.ts` | Add `model` + `sourceImageData` support |
| `app/api/video/route.ts` | New — Seedance 2.0 text-to-video + image-to-video |
| `app/page.tsx` | Add `generated-video` to `ContentBlock` union |
| `components/ChatPanel.tsx` | Replace imageMode, add sendVideo, wire animations, use ModeDropdown |
| `components/ModeDropdown.tsx` | New — animated model picker dropdown |
| `components/GeneratedVideoCard.tsx` | New — Option B video player card |
| `app/globals.css` | Add styles for video card, mode dropdown |

---

## Out of Scope

- Nano Banana 2 edit endpoint in `ImageEditorModal` (existing FLUX edit flow unchanged)
- Seedance image-to-video from an already-generated image (only from uploaded pending image)
- Audio display for Seedance videos with native audio
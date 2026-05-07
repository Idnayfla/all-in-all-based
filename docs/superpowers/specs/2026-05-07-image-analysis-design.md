# Image Analysis — Design Spec

**Date:** 2026-05-07
**Status:** Approved

---

## Overview

Add vision/image support to the chat input. Users can attach a JPG, PNG, WebP, or GIF image alongside their text message. The image is sent to the Claude API using its native vision (base64) format. The image and text appear together in the chat history.

---

## Decisions

| Decision | Choice |
|---|---|
| Content model | Union type: `string \| ContentBlock[]` on `Message.content` |
| Image encoding | `FileReader.readAsDataURL` → extract base64 + mediaType client-side |
| Upload trigger | Paperclip button left of textarea → hidden `<input type="file">` |
| Preview | 64×64 thumbnail strip above input, ✕ to clear, disappears after send |
| History display | Inline `<img>` rendered from `data:` URL inside message bubble |
| API format | `{ type: 'image', source: { type: 'base64', media_type, data } }` (Anthropic SDK native) |
| Model change | None — `claude-opus-4-6` already supports vision |
| New files | None — all changes to existing files |

---

## Architecture

**Modified files:**
- `app/page.tsx` — `ContentBlock` type, updated `Message` interface, `contentToString` helper
- `components/ChatPanel.tsx` — upload button, `pendingImage` state, preview strip, content block rendering
- `app/api/generate/route.ts` — `toClaudeContent()` mapper, `contentToString` usage for memory
- `app/globals.css` — `.chat-image-preview`, `.chat-img-thumb` classes

No new files. No new npm dependencies.

---

## Data Model

```ts
// app/page.tsx

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

`content` is `string` for all assistant messages and for user messages without an image. It is `ContentBlock[]` only for user messages that include an image.

---

## ChatPanel Component

### New state

```ts
const [pendingImage, setPendingImage] = useState<{
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  previewUrl: string;
} | null>(null);
const fileInputRef = useRef<HTMLInputElement>(null);
```

### Upload flow

1. Paperclip button (`📎`) added to the left of the textarea, disabled when `isGenerating`.
2. A hidden `<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" ref={fileInputRef}>` is placed outside the visible layout.
3. On file select: `FileReader.readAsDataURL` → parse `data:[mediaType];base64,[data]` → set `pendingImage`.
4. Only the first selected file is processed; the file input is reset after selection so the same file can be re-selected.

### Preview strip

When `pendingImage !== null`, render above the textarea:

```
┌──────────────────────────────────┐
│ [img 64×64]  ✕                   │
└──────────────────────────────────┘
```

- `✕` button calls `setPendingImage(null)` and resets the file input value.
- Strip hidden when `pendingImage === null`.

### Send behaviour

```ts
const content: Message['content'] = pendingImage
  ? [
      { type: 'image', mediaType: pendingImage.mediaType, data: pendingImage.data },
      { type: 'text', text: input.trim() },
    ]
  : input.trim();
```

`setPendingImage(null)` is called alongside clearing the input on send.

### Message history rendering

Replace the current `message.content` string render with:

```tsx
function renderContent(content: string | ContentBlock[]) {
  if (typeof content === 'string') return <span>{content}</span>;
  return (
    <>
      {content.map((block, i) =>
        block.type === 'image'
          ? <img key={i} className="chat-img-thumb" src={`data:${block.mediaType};base64,${block.data}`} alt="uploaded image" />
          : <span key={i}>{block.text}</span>
      )}
    </>
  );
}
```

---

## API Route (`/api/generate`)

### Content mapper

```ts
function toClaudeContent(content: string | ContentBlock[]) {
  if (typeof content === 'string') return content;
  return content.map(block =>
    block.type === 'text'
      ? { type: 'text' as const, text: block.text }
      : {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: block.mediaType, data: block.data },
        }
  );
}
```

### Usage

When building the `messages` array for `anthropic.messages.stream()` / `anthropic.messages.create()`:

```ts
messages: msgs.map(m => ({ role: m.role, content: toClaudeContent(m.content) }))
```

### Memory extraction

All calls to `message.content` used as a string (for the memory API POST) switch to `contentToString(message.content)`.

---

## CSS

```css
/* app/globals.css */

.chat-image-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 6px;
}

.chat-img-thumb {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border);
  display: block;
}
```

---

## Supported Formats

`image/jpeg`, `image/png`, `image/webp`, `image/gif`

---

## Out of Scope

- Multiple images per message
- Image size validation or compression
- Drag-and-drop upload
- Paste-from-clipboard upload
- Displaying images in the assistant's response (Claude never returns images)

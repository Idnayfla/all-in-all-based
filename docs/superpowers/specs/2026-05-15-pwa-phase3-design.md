# Based — PWA Phase 3 Design Spec

**Date:** 2026-05-15  
**Status:** Approved — ready for implementation  
**Scope:** Complete the PWA so Based feels native when installed on Android and iOS

---

## Context

The core PWA plumbing already exists: `manifest.json`, `sw.js`, `ServiceWorkerInit.tsx`, icons at 192×192 and 512×512, and all essential `<meta>` tags including `viewport-fit=cover`. Six gaps remain before the installed experience feels genuinely native.

---

## Piece 1 — Safe Area Insets

### Problem
`viewport-fit=cover` is already set, which lets content extend behind the iPhone notch and Dynamic Island. Without compensating CSS, the header gets clipped at the top and the chat input bar sits behind the home indicator at the bottom.

### Solution
Add CSS custom properties that read the environment insets and apply them to the two affected zones.

**`app/globals.css` additions:**
```css
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
}

.app-header {
  padding-top: var(--safe-top);
}

.chat-input-bar {
  padding-bottom: var(--safe-bottom);
}
```

No layout changes. Existing structure is preserved. The values are `0px` on desktop and in non-PWA browser views.

---

## Piece 2 — Launch Splash + Welcome Audio

### Behaviour
- **Triggers:** every launch when running as an installed PWA (detected via `window.matchMedia('(display-mode: standalone)').matches` on Android/Chrome, and `navigator.standalone === true` on iOS Safari)
- **Does not trigger:** regular browser visits, desktop browser, Codespace
- **Flow:** overlay appears instantly → user sees "Based" wordmark with a slow pulse animation → user taps anywhere → audio plays → overlay fades out over 400ms → main app is interactive

### Components

**`lib/welcomeAudio.ts`**  
Synthesizes the welcome sound using the Web Audio API. No audio file — works offline.

Three-layer sound, total duration ~1.2s:
- **Layer 1 — Bass hit:** OscillatorNode at 60 Hz, sine wave, sharp attack (0ms), decay to silence over 600ms
- **Layer 2 — Rising sweep:** OscillatorNode at 200 Hz → 900 Hz over 800ms, sine wave, volume envelope 0→0.3→0
- **Layer 3 — Chord shimmer:** Two OscillatorNodes at 440 Hz and 554 Hz (A4 + C#5), triangle wave, volume 0→0.15→0 over 1s

All nodes routed through a shared `GainNode` master at 0.8 gain. `AudioContext` is created on demand (required by browser policy — must be inside a user gesture handler). If `AudioContext` construction throws (unsupported browser), the error is swallowed silently — the splash fades out normally without sound.

```ts
export function playWelcomeAudio(): void {
  const ctx = new AudioContext()
  // ... synthesis implementation
}
```

**`components/LaunchSplash.tsx`**  
Client component. Mounts as the first child inside `<body>` in `layout.tsx`.

State machine:
- `idle` → check if PWA mode on mount → if yes, enter `waiting`
- `waiting` → show overlay, listen for tap/click
- `playing` → call `playWelcomeAudio()`, enter `fading` after 400ms
- `fading` → CSS opacity transition to 0
- `done` → unmount (return null)

Visual design:
- Full-screen fixed overlay, `background: var(--bg)` (respects theme)
- "Based" wordmark centered, `--fs-hero` size, `--accent` color
- Tagline below: *"Your personal AI studio"*, `--fs-sm`, `--text3`
- Slow radial pulse animation behind the wordmark (CSS keyframes, 2s infinite)
- "Tap anywhere to enter" hint at bottom, `--fs-xs`, `--text3`, fade-in after 800ms delay
- `z-index: 9999` — above everything

No localStorage flag — resets every launch intentionally.

---

## Piece 3 — Install Prompt

**`components/InstallPrompt.tsx`**  
Client component. Renders a bottom banner when conditions are met.

### Show conditions (all must be true)
- Not already in standalone mode
- Not dismissed this session (`sessionStorage` key `install-prompt-dismissed`)
- On Android/Chrome: `beforeinstallprompt` event has fired
- On iOS: `navigator.userAgent` matches iOS Safari and not standalone

### Android/Chrome flow
1. `window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); storeEvent(e) })`
2. Banner appears after 3s delay (don't interrupt initial load)
3. Banner: *"Install Based for the full experience"* + **Install** button + **×** dismiss
4. Install button: calls `deferredPrompt.prompt()`, awaits `userChoice`, hides banner

### iOS flow
Banner text: *"Install Based: tap **Share** then **Add to Home Screen**"*  
Shows the iOS Share icon inline. Dismiss button saves to `sessionStorage`.

### Visual
Bottom of screen, slides up with Framer Motion spring. Matches app surface styles (`--bg2`, `--border`, `--r-lg`, `--sp-3` padding). Does not overlap the chat input bar — sits above it with `bottom: calc(var(--safe-bottom) + 64px)`.

---

## Piece 4 — iOS Splash Screens

Apple requires `<link rel="apple-touch-startup-image">` for each device resolution. Without these, iOS shows a white flash for ~1–2 seconds on every launch.

### Approach
Generate splash images programmatically using a build script (`scripts/generate-splashes.ts`) that draws on an HTML5 Canvas: solid `#0a0a0f` background, centered "Based" wordmark in `--accent` color (`#7c6af7`), same visual as the JS splash overlay.

Sizes to cover (portrait only — `orientation: any` handles landscape):

| Device | Width × Height |
|--------|---------------|
| iPhone SE (3rd gen) | 750 × 1334 |
| iPhone 15 | 1179 × 2556 |
| iPhone 15 Plus | 1284 × 2778 |
| iPhone 15 Pro Max | 1290 × 2796 |
| iPad (10th gen) | 1640 × 2360 |
| iPad Pro 11" | 1668 × 2388 |
| iPad Pro 13" | 2048 × 2732 |

Output: `public/splash/splash-{width}x{height}.png`

**`app/layout.tsx` additions:**
```tsx
<link rel="apple-touch-startup-image" media="(device-width: 390px) and (-webkit-device-pixel-ratio: 3)" href="/splash/splash-1179x2556.png" />
// ... one per device
```

Script runs once via `npm run generate-splashes`. Requires `canvas` devDependency (`npm i -D canvas`) for server-side Canvas rendering. Images are static assets committed to `public/splash/`.

---

## Piece 5 — SW Update Notification

### Problem
When `sw.js` is updated (new deploy), the new SW installs and calls `skipWaiting()` immediately. `ServiceWorkerInit` detects the `controllerchange` event but currently does nothing with it.

### Solution
Extend `ServiceWorkerInit.tsx` to show a toast when the SW changes.

**State:** `updateAvailable: boolean` — set to true on `controllerchange`

**Toast UI** (inline in `ServiceWorkerInit`, no separate component needed):
- Fixed bottom-right, above safe area: `bottom: calc(var(--safe-bottom) + 16px); right: 16px`
- Text: *"Based updated"* + **Reload** button
- Framer Motion slide-in from bottom-right
- Clicking Reload: `window.location.reload()`
- Auto-dismisses after 10s if ignored

---

## Piece 6 — Maskable Icon

### Problem
`icon-512.png` is used as both the regular icon and the maskable icon in `manifest.json`. Android adaptive icons crop to a circle/squircle inside a 72% safe zone — the current icon has no padding, so the logo gets clipped.

### Solution
Create `public/icon-512-maskable.png`: same logo, but scaled to fit within the inner 72% of the 512×512 canvas, with `#0a0a0f` fill on the outer 28%.

Update `manifest.json`:
```json
{
  "src": "/icon-512-maskable.png",
  "sizes": "512x512",
  "type": "image/png",
  "purpose": "maskable"
}
```

The `any` entry keeps pointing to `icon-512.png` (no padding, full bleed — correct for non-adaptive contexts).

---

## File Changes Summary

| Action | File |
|--------|------|
| Create | `lib/welcomeAudio.ts` |
| Create | `components/LaunchSplash.tsx` |
| Create | `components/InstallPrompt.tsx` |
| Create | `scripts/generate-splashes.ts` |
| Create | `public/splash/*.png` (7 files, generated) |
| Create | `public/icon-512-maskable.png` |
| Modify | `app/globals.css` — safe area vars + header/input padding |
| Modify | `app/layout.tsx` — add LaunchSplash, InstallPrompt, splash links |
| Modify | `components/ServiceWorkerInit.tsx` — update notification |
| Modify | `public/manifest.json` — separate maskable icon entry |

---

## Testing Checklist

- [ ] Safe area: test on iPhone in Safari with PWA installed — header and input not clipped
- [ ] Splash audio: install on Android → open from home screen → tap → hear audio → app appears
- [ ] Splash audio: install on iOS → open from home screen → tap → hear audio → app appears
- [ ] Install prompt: visit in Chrome Android (not installed) → banner appears after 3s → Install works
- [ ] Install prompt: visit in iOS Safari (not installed) → iOS instructions shown
- [ ] Install prompt: already installed → no banner
- [ ] iOS splash: install on iPhone → open → no white flash
- [ ] SW update: deploy new version → open app → see "Based updated" toast → Reload works
- [ ] Maskable icon: check Android home screen → logo not clipped in adaptive icon shape

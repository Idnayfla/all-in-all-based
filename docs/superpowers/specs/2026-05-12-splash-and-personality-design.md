# Splash Screen + Personality Tab Redesign

**Date:** 2026-05-12  
**Status:** Approved

---

## Overview

Two features shipping together:

1. **Cinematic splash screen** — particle assembly animation with Web Audio synthesis, shown every page load, dismissed automatically after ~3.2s or on click
2. **Personality tab redesign** — replace raw default-prompt textarea with a locked identity card + 4 interactive sliders + extra notes field

Brand symbol convention: use `◆` `▸` `✦` `[ ]` and `B>` — never emoji.

---

## Feature 1: Splash Screen

### Architecture

New component: `components/SplashScreen.tsx`

Mounted in `app/page.tsx` (not layout, so it only shows on the main app shell — not on `/auth/*` pages). It renders as a fixed full-screen overlay above all other content, z-index 9999. Once dismissed it unmounts entirely.

No session-storage skip — shows every page load as requested.

### Animation Sequence (total ~3.2s)

| Time     | Event                                                              |
| -------- | ------------------------------------------------------------------ |
| 0s       | 120 particles scattered across black screen, begin drifting inward |
| 0–1.2s   | Particles converge to centre with eased trajectories               |
| 1.2s     | `B>` snaps to full opacity + pulse ring expands outward            |
| 1.4–2.0s | "All in All Based" tagline fades up                                |
| 2.0–2.8s | Hold: film-grain overlay at 4% opacity, particles fully dissolved  |
| 2.8–3.2s | Full-screen wipe blade (left→right) reveals the app beneath        |

**Particle system (canvas):**

- 120 particles, each with a random start position, random target within a 100×50px region centred on canvas
- Easing: `easeInOutQuad` on `progress` per particle
- Per-particle random delay (0–0.4s) and speed (0.02–0.05 per frame) for organic feel
- Colour: `rgba(124,106,247, alpha)` — fades to 0 once particle reaches target
- Canvas sized to full viewport, redrawn each frame via `requestAnimationFrame`

**Logo reveal:**

- `B>` at 72px monospace, opacity transition from 0→1 at t=1.2s (`scale(0.8)→scale(1)`, 0.6s ease)
- Pulse ring: 1px solid purple border, scale 0.5→2.5, opacity 0.8→0 over 1.2s
- Tagline: 11px monospace, letter-spacing 6px, `#5a5a8a`, fade up 8px over 0.6s

**Wipe transition:**

- A full-screen `#050508` div, `transform: scaleX(1)` → `scaleX(0)`, `transform-origin` flips left→right
- Duration: 0.5s, `cubic-bezier(0.7, 0, 0.3, 1)`
- Accompanied by a 2px vertical blade (`background: linear-gradient(180deg, transparent, #7c6af7, transparent)`) that races across

**Grain overlay:**

- Inline SVG `feTurbulence` noise at 4% opacity, `position: absolute; inset: 0; pointer-events: none`

### Audio (Web Audio API — no audio files)

All sounds synthesised at runtime. No external files, no bundle impact.

| Time | Sound               | Implementation                                                                                      |
| ---- | ------------------- | --------------------------------------------------------------------------------------------------- |
| 0s   | Sub-bass drone      | OscillatorNode 40Hz, sine, gain 0→0.3 over 0.5s, sustains to 1.2s                                   |
| 0.8s | Rising sweep        | OscillatorNode 80Hz→200Hz frequency ramp over 0.4s, gain 0.2                                        |
| 1.2s | Impact thud         | Two detuned oscillators: 80Hz + 84Hz, gain 0.5→0 over 0.3s                                          |
| 1.2s | Crystalline chord   | Three OscillatorNodes: 466Hz (Bb4) + 587Hz (D5) + 740Hz (F#5), triangle wave, gain 0.15→0 over 0.8s |
| 1.4s | Shimmer             | BufferSourceNode (white noise), BiquadFilterNode highpass 3000Hz, gain burst 0→0.1→0 over 50ms      |
| 2.8s | All gains fade to 0 | Ramp all active nodes to 0 before wipe completes                                                    |

**Autoplay handling:**

- Create `AudioContext` on component mount
- Call `context.resume()` — succeeds if user has previously interacted with the page, suspended otherwise
- If `context.state === 'suspended'` after mount: render a small `▸` icon (bottom-right, `position: absolute`, `z-index: 10000`) with a subtle pulse animation
- On click of `▸` icon: `context.resume()` then replay audio from current animation timestamp
- Icon disappears once audio context is running

### Dismissal

- Auto-dismiss: after the wipe completes (~3.2s) — call `onDone` prop which removes the component
- Click-to-skip: clicking anywhere on the splash triggers the wipe immediately (audio fades quickly over 0.3s)
- `onDone` prop sets a state flag in `page.tsx` that controls render

### Files Changed

- `components/SplashScreen.tsx` — new component
- `app/page.tsx` — import + mount `<SplashScreen onDone={() => setShowSplash(false)} />`

---

## Feature 2: Personality Tab Redesign

### Current State

The settings panel has a "Personality" tab showing the full raw default system prompt in an open `<textarea>`. Users can edit the entire prompt, including Based's core identity.

### Target State

Hide the base identity. Let users only tune personality parameters layered on top.

### Layout (top to bottom)

```
[ B> CORE IDENTITY — FIXED ]
  Based is an AI dev studio...   ← not shown, just the label
  [◆ Identity is managed by Based]

Tone
  Casual ————●————————— Formal

Response Length
  Concise —●——————————— Detailed

Humour
  Dry ————————●———————— Playful

Technicality
  Simplified ——————————●Expert

Extra notes
  [ anything else... textarea ]
```

### Slider Component

Each slider is a controlled `<div>`-based track (not `<input type="range">`) for full styling control:

- Track: 3px height, `#2a2a4a` background, `border-radius: 2px`
- Fill: gradient `#7c6af7 → #9c8af7` from left to thumb position
- Thumb: 14px circle, white fill, `2px solid #7c6af7` border, `box-shadow: 0 0 8px rgba(124,106,247,0.5)`
- Drag via `mousedown`/`mousemove`/`mouseup` + `touchstart`/`touchmove`/`touchend`
- Value: 0–100, stored as integer

### Data Model

Stored in `localStorage` under key `based_personality`:

```json
{
  "tone": 30,
  "length": 25,
  "humour": 65,
  "technicality": 75,
  "notes": ""
}
```

Default values set on first render if key absent.

### Prompt Injection

In `components/ChatPanel.tsx`, before sending the system prompt to the API, read `based_personality` from localStorage and append:

```
Personality modifiers: tone=casual-leaning, length=concise, humour=dry-leaning, technicality=expert. [notes if non-empty]
```

The base identity prompt in `app/api/generate/route.ts` stays untouched.

### Locked Identity Card

Replaces the current editable textarea header. Styled card:

- Background: `rgba(124,106,247, 0.06)`, border: `1px solid rgba(124,106,247, 0.2)`, `border-radius: 12px`
- Left content: `◆ Core identity` label in purple, `[FIXED]` tag in muted text
- No click interaction

### Files Changed

- Wherever the current Personality tab lives (Settings panel component) — replace textarea with slider UI
- `components/ChatPanel.tsx` — read personality from localStorage and append to system prompt

---

## Out of Scope

- Server-side personality persistence (localStorage only for now)
- More than 4 sliders
- Audio settings / mute toggle in settings panel
- Splash skip preference stored in settings

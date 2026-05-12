# Splash Screen + Personality Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cinematic particle-assembly splash screen with synthesised audio on every page load, and replace the raw personality textarea in settings with a locked identity card + 4 interactive sliders.

**Architecture:** SplashScreen is a self-contained `position: fixed` overlay mounted in `app/page.tsx`; it owns its canvas, AudioContext, and all timers and calls `onDone` when finished. PersonalityPanel is extracted from the inline settings JSX into `components/PersonalityPanel.tsx`; it reads/writes `localStorage['based_personality']` and calls `onPersonalityChange(modifier)` with a built string that replaces the raw `personality` prop — no changes to the API or generate route needed.

**Tech Stack:** React 18, TypeScript, Web Audio API (no audio files), Canvas 2D, CSS animations, `localStorage`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `components/SplashScreen.tsx` | Particle canvas, Web Audio, timers, mute button, exit wipe |
| Create | `components/PersonalityPanel.tsx` | Locked card, 4 sliders, notes, builds personality modifier string |
| Modify | `app/page.tsx` | Mount SplashScreen, replace personality textarea with PersonalityPanel |
| Modify | `app/globals.css` | Styles for splash and personality panel |

---

## Task 1: Splash screen CSS

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add splash styles to globals.css**

Append to the end of `app/globals.css`:

```css
/* ─── Splash Screen ──────────────────────────────────────────── */
.splash-root {
  position: fixed; inset: 0; z-index: 9999;
  background: #050508;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.splash-root.exiting {
  animation: splashWipe 0.5s cubic-bezier(0.7, 0, 0.3, 1) forwards;
}
@keyframes splashWipe {
  from { clip-path: inset(0 0% 0 0); }
  to   { clip-path: inset(0 100% 0 0); }
}

.splash-canvas { position: absolute; inset: 0; pointer-events: none; }

.splash-center {
  position: relative; z-index: 2;
  display: flex; flex-direction: column; align-items: center;
  pointer-events: none;
}

.splash-mark {
  font-family: var(--font-display); font-size: 72px; font-weight: 800;
  color: #fff; letter-spacing: -2px;
  opacity: 0; transform: scale(0.85);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.splash-mark.visible { opacity: 1; transform: scale(1); }

.splash-ring {
  position: absolute; top: 50%; left: 50%;
  width: 120px; height: 120px; border-radius: 50%;
  border: 1px solid var(--accent);
  opacity: 0; pointer-events: none;
}
.splash-ring.pulse {
  animation: splashRing 1.2s ease-out forwards;
}
@keyframes splashRing {
  0%   { opacity: 0.8; transform: translate(-50%, -50%) scale(0.5); }
  100% { opacity: 0;   transform: translate(-50%, -50%) scale(2.5); }
}

.splash-tagline {
  font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 6px; text-transform: uppercase;
  color: #4a4a6a; margin-top: 16px;
  opacity: 0; transform: translateY(8px);
  transition: opacity 0.6s ease 0.1s, transform 0.6s ease 0.1s;
}
.splash-tagline.visible { opacity: 0.6; transform: translateY(0); }

.splash-grain {
  position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: 0.04;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

.splash-mute {
  position: absolute; bottom: 24px; right: 24px; z-index: 10;
  width: 34px; height: 34px; border-radius: 50%;
  border: 1px solid rgba(124, 106, 247, 0.4);
  background: rgba(124, 106, 247, 0.08);
  color: var(--accent); font-family: var(--font-mono); font-size: 15px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  animation: mutePulse 1.8s ease-in-out infinite;
  pointer-events: all;
}
@keyframes mutePulse {
  0%, 100% { opacity: 0.4; }
  50%       { opacity: 1; }
}

/* ─── Personality Panel ──────────────────────────────────────── */
.personality-locked {
  background: rgba(124, 106, 247, 0.06);
  border: 1px solid rgba(124, 106, 247, 0.2);
  border-radius: 10px; padding: 12px 14px;
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 4px;
}
.personality-locked-label { font-size: 11px; color: var(--accent); letter-spacing: 1px; }
.personality-locked-sub { font-size: 10px; color: var(--text3); margin-top: 2px; }

.personality-slider-row { display: flex; flex-direction: column; gap: 5px; }
.personality-slider-ends {
  display: flex; justify-content: space-between;
  font-size: 10px; color: var(--text3);
}
.personality-slider-track {
  height: 3px; background: var(--border); border-radius: 2px;
  position: relative; cursor: pointer; user-select: none;
}
.personality-slider-fill {
  height: 100%; background: linear-gradient(90deg, var(--accent), #9c8af7);
  border-radius: 2px; pointer-events: none;
}
.personality-slider-thumb {
  position: absolute; top: -5.5px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #fff; border: 2px solid var(--accent);
  box-shadow: 0 0 8px rgba(124, 106, 247, 0.5);
  cursor: grab; transform: translateX(-50%);
}
.personality-slider-thumb:active { cursor: grabbing; }
```

- [ ] **Step 2: Verify no visual regressions**

Start the dev server (`npm run dev`) and confirm the existing settings panel still looks correct. The new classes don't affect anything yet.

---

## Task 2: SplashScreen shell + particle canvas

**Files:**
- Create: `components/SplashScreen.tsx`

- [ ] **Step 1: Create the component with canvas particle system**

Create `components/SplashScreen.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Particle {
  x: number; y: number;
  tx: number; ty: number;
  size: number; alpha: number;
  progress: number; delay: number; speed: number;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

interface Props { onDone: () => void; }

export default function SplashScreen({ onDone }: Props) {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const exitedRef     = useRef(false);
  const [logoIn,    setLogoIn]    = useState(false);
  const [taglineIn, setTaglineIn] = useState(false);
  const [ringPulse, setRingPulse] = useState(false);
  const [exiting,   setExiting]   = useState(false);
  const [showMute,  setShowMute]  = useState(false);

  const exit = useCallback(() => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    const ctx = audioCtxRef.current;
    const gain = masterGainRef.current;
    if (ctx && gain) {
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    }
    setExiting(true);
    setTimeout(onDone, 500);
  }, [onDone]);

  /* ── Particle canvas ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const W = (canvas.width  = window.innerWidth);
    const H = (canvas.height = window.innerHeight);
    const cx = W / 2, cy = H / 2;

    const particles: Particle[] = Array.from({ length: 120 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      tx: cx + (Math.random() - 0.5) * 100,
      ty: cy + (Math.random() - 0.5) * 50,
      size:     Math.random() * 1.5 + 0.3,
      alpha:    Math.random() * 0.7 + 0.3,
      progress: 0,
      delay:    Math.random() * 0.4,
      speed:    0.02 + Math.random() * 0.03,
    }));

    let t = 0;
    const animate = () => {
      ctx.clearRect(0, 0, W, H);
      t += 0.008;
      for (const p of particles) {
        if (t < p.delay) continue;
        p.progress = Math.min(1, p.progress + p.speed);
        const e  = easeInOutQuad(p.progress);
        const px = p.x + (p.tx - p.x) * e;
        const py = p.y + (p.ty - p.y) * e;
        const a  = p.progress > 0.85
          ? ((1 - p.progress) / 0.15) * p.alpha
          : p.alpha;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(124,106,247,${(a * 0.8).toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ── Reveal timers ── */
  useEffect(() => {
    const t1 = setTimeout(() => { setLogoIn(true);    setRingPulse(true); }, 1200);
    const t2 = setTimeout(() => setTaglineIn(true), 1800);
    const t3 = setTimeout(exit, 3200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [exit]);

  /* ── Audio ── */
  useEffect(() => {
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    if (audioCtx.state === 'suspended') {
      setShowMute(true);
      return;
    }
    masterGainRef.current = startAudio(audioCtx);
  }, []);

  const unmute = () => {
    audioCtxRef.current?.resume().then(() => {
      if (audioCtxRef.current) {
        masterGainRef.current = startAudio(audioCtxRef.current);
      }
      setShowMute(false);
    });
  };

  return (
    <div className={`splash-root${exiting ? ' exiting' : ''}`} onClick={exit}>
      <canvas ref={canvasRef} className="splash-canvas" />
      <div className="splash-center">
        <div className="splash-ring-wrap" style={{ position: 'relative' }}>
          <div className={`splash-ring${ringPulse ? ' pulse' : ''}`} />
          <div className={`splash-mark${logoIn ? ' visible' : ''}`}>B&gt;</div>
        </div>
        <div className={`splash-tagline${taglineIn ? ' visible' : ''}`}>
          All in All Based
        </div>
      </div>
      <div className="splash-grain" />
      {showMute && (
        <button
          className="splash-mute"
          onClick={e => { e.stopPropagation(); unmute(); }}
          title="Unmute"
        >▸</button>
      )}
    </div>
  );
}

function startAudio(ctx: AudioContext): GainNode {
  const now    = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(1, now);
  master.connect(ctx.destination);

  /* sub-bass drone: 40 Hz, fades in then out before impact */
  const bass     = ctx.createOscillator();
  const bassGain = ctx.createGain();
  bass.frequency.setValueAtTime(40, now);
  bass.type = 'sine';
  bassGain.gain.setValueAtTime(0, now);
  bassGain.gain.linearRampToValueAtTime(0.3, now + 0.5);
  bassGain.gain.linearRampToValueAtTime(0,   now + 1.4);
  bass.connect(bassGain);
  bassGain.connect(master);
  bass.start(now);
  bass.stop(now + 1.5);

  /* rising frequency sweep: 80→200 Hz at t=0.8s */
  const sweep     = ctx.createOscillator();
  const sweepGain = ctx.createGain();
  sweep.frequency.setValueAtTime(80,  now + 0.8);
  sweep.frequency.linearRampToValueAtTime(200, now + 1.2);
  sweepGain.gain.setValueAtTime(0.2, now + 0.8);
  sweepGain.gain.linearRampToValueAtTime(0, now + 1.2);
  sweep.connect(sweepGain);
  sweepGain.connect(master);
  sweep.start(now + 0.8);
  sweep.stop(now + 1.3);

  /* impact thud at t=1.2s: two detuned sines */
  for (const freq of [80, 84]) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(freq, now + 1.2);
    gain.gain.setValueAtTime(0.45, now + 1.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + 1.2);
    osc.stop(now + 1.6);
  }

  /* crystalline chord at t=1.2s: Bb4=466 Hz, D5=587 Hz, F#5=740 Hz */
  for (const freq of [466, 587, 740]) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + 1.2);
    gain.gain.setValueAtTime(0.12, now + 1.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.1);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + 1.2);
    osc.stop(now + 2.2);
  }

  /* white-noise shimmer at t=1.4s */
  const bufLen  = Math.ceil(ctx.sampleRate * 0.06);
  const buffer  = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data    = buffer.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const noise       = ctx.createBufferSource();
  const noiseFilter = ctx.createBiquadFilter();
  const noiseGain   = ctx.createGain();
  noise.buffer = buffer;
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.setValueAtTime(3000, now + 1.4);
  noiseGain.gain.setValueAtTime(0, now + 1.4);
  noiseGain.gain.linearRampToValueAtTime(0.1, now + 1.42);
  noiseGain.gain.linearRampToValueAtTime(0,   now + 1.46);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(now + 1.4);

  return master;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors in `components/SplashScreen.tsx`.

---

## Task 3: Mount SplashScreen in page.tsx

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add showSplash state and import**

At the top of `app/page.tsx`, add the import:

```tsx
import SplashScreen from '@/components/SplashScreen';
```

Inside the `Home` component, add the state alongside the other `useState` calls (around line 63):

```tsx
const [showSplash, setShowSplash] = useState(true);
```

- [ ] **Step 2: Render SplashScreen above everything else**

Find the return statement opening in page.tsx — it starts with `<div className="app-root">`. Add SplashScreen as the first child:

```tsx
return (
  <div className="app-root">
    {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
    {/* ... rest of existing JSX unchanged ... */}
```

- [ ] **Step 3: Fix remaining ⏳ emoji in ChatPanel**

In `components/ChatPanel.tsx` around line 287, replace:

```tsx
setMessages(prev => [...prev, { role: 'assistant', content: '⏳ Working...' }]);
```

with:

```tsx
setMessages(prev => [...prev, { role: 'assistant', content: '... Working' }]);
```

- [ ] **Step 4: Manual smoke test**

Run `npm run dev`, open `http://localhost:3000`. You should see:
- Black screen with purple particles drifting inward
- `B>` snaps in at ~1.2s with a pulse ring
- "All in All Based" tagline fades up at ~1.8s
- Auto-dismisses at ~3.2s with a left-wipe reveal
- Clicking anywhere skips to the wipe immediately
- If browser blocked audio: `▸` icon pulses in bottom-right; clicking it replays audio

- [ ] **Step 5: Commit**

```bash
git add components/SplashScreen.tsx app/page.tsx app/globals.css components/ChatPanel.tsx
git commit -m "feat: add cinematic particle splash screen with Web Audio synthesis"
```

---

## Task 4: PersonalityPanel — types and slider utility

**Files:**
- Create: `components/PersonalityPanel.tsx`

- [ ] **Step 1: Create the file with types and pure utility functions**

Create `components/PersonalityPanel.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';

export interface PersonalitySettings {
  tone:          number;  // 0=Casual, 100=Formal
  length:        number;  // 0=Concise, 100=Detailed
  humour:        number;  // 0=Dry, 100=Playful
  technicality:  number;  // 0=Simplified, 100=Expert
  notes:         string;
}

const DEFAULTS: PersonalitySettings = {
  tone: 30, length: 25, humour: 65, technicality: 75, notes: '',
};

const LS_KEY = 'based_personality';

function load(): PersonalitySettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function save(s: PersonalitySettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

function label(value: number, low: string, high: string): string {
  if (value <= 20)  return low;
  if (value <= 40)  return `${low}-leaning`;
  if (value <= 60)  return 'balanced';
  if (value <= 80)  return `${high}-leaning`;
  return high;
}

export function buildPersonalityModifier(s: PersonalitySettings): string {
  const parts = [
    `tone=${label(s.tone, 'casual', 'formal')}`,
    `length=${label(s.length, 'concise', 'detailed')}`,
    `humour=${label(s.humour, 'dry', 'playful')}`,
    `technicality=${label(s.technicality, 'simplified', 'expert')}`,
  ];
  const notes = s.notes.trim();
  return `Personality modifiers: ${parts.join(', ')}.${notes ? ` ${notes}` : ''}`;
}
```

- [ ] **Step 2: Verify the pure functions manually**

You can spot-check in the browser console or by adding a quick `console.log`:

```
buildPersonalityModifier({ tone: 30, length: 25, humour: 65, technicality: 75, notes: '' })
// → "Personality modifiers: tone=casual-leaning, length=concise, humour=playful-leaning, technicality=expert-leaning."

buildPersonalityModifier({ tone: 0, length: 100, humour: 50, technicality: 100, notes: 'Always use TypeScript.' })
// → "Personality modifiers: tone=casual, length=detailed, humour=balanced, technicality=expert. Always use TypeScript."
```

---

## Task 5: PersonalityPanel — Slider component + full UI

**Files:**
- Modify: `components/PersonalityPanel.tsx`

- [ ] **Step 1: Add the Slider sub-component and full PersonalityPanel**

Append to `components/PersonalityPanel.tsx` (after the utility functions):

```tsx
interface SliderProps {
  value:      number;
  onChange:   (v: number) => void;
  leftLabel:  string;
  rightLabel: string;
}

function Slider({ value, onChange, leftLabel, rightLabel }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const compute = (clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  };

  useEffect(() => {
    const move = (e: PointerEvent) => { if (dragging.current) onChange(compute(e.clientX)); };
    const up   = ()                 => { dragging.current = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup',   up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup',   up);
    };
  }, [onChange]);

  return (
    <div className="personality-slider-row">
      <div className="personality-slider-ends">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div
        ref={trackRef}
        className="personality-slider-track"
        onPointerDown={e => { dragging.current = true; onChange(compute(e.clientX)); }}
      >
        <div className="personality-slider-fill" style={{ width: `${value}%` }} />
        <div className="personality-slider-thumb" style={{ left: `${value}%` }} />
      </div>
    </div>
  );
}

interface PersonalityPanelProps {
  onPersonalityChange: (modifier: string) => void;
}

export default function PersonalityPanel({ onPersonalityChange }: PersonalityPanelProps) {
  const [settings, setSettings] = useState<PersonalitySettings>(DEFAULTS);

  /* load from localStorage on mount and emit the initial modifier */
  useEffect(() => {
    const s = load();
    setSettings(s);
    onPersonalityChange(buildPersonalityModifier(s));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (partial: Partial<PersonalitySettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    save(next);
    onPersonalityChange(buildPersonalityModifier(next));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Locked identity card */}
      <div className="personality-locked">
        <span style={{ fontSize: 14, color: 'var(--accent)' }}>◆</span>
        <div>
          <div className="personality-locked-label">Core identity — [FIXED]</div>
          <div className="personality-locked-sub">Based knows who it is. You shape the style.</div>
        </div>
      </div>

      <div className="settings-label">Tone</div>
      <Slider
        value={settings.tone}
        onChange={v => update({ tone: v })}
        leftLabel="Casual"
        rightLabel="Formal"
      />

      <div className="settings-label">Response length</div>
      <Slider
        value={settings.length}
        onChange={v => update({ length: v })}
        leftLabel="Concise"
        rightLabel="Detailed"
      />

      <div className="settings-label">Humour</div>
      <Slider
        value={settings.humour}
        onChange={v => update({ humour: v })}
        leftLabel="Dry"
        rightLabel="Playful"
      />

      <div className="settings-label">Technicality</div>
      <Slider
        value={settings.technicality}
        onChange={v => update({ technicality: v })}
        leftLabel="Simplified"
        rightLabel="Expert"
      />

      <div className="settings-label" style={{ marginTop: 4 }}>Extra notes</div>
      <textarea
        className="settings-textarea"
        rows={2}
        placeholder="Anything else — e.g. 'Always suggest tests'"
        value={settings.notes}
        onChange={e => update({ notes: e.target.value })}
      />
      <div className="settings-hint">Changes apply immediately to every new message.</div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 6: Wire PersonalityPanel into page.tsx

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Import PersonalityPanel**

Add to the imports at the top of `app/page.tsx`:

```tsx
import PersonalityPanel from '@/components/PersonalityPanel';
```

- [ ] **Step 2: Replace the personality textarea in the settings panel**

Find this block in `app/page.tsx` (around line 326–343):

```tsx
<div className="settings-section">
  <label className="settings-label">AI Personality</label>
  <textarea
    className="settings-textarea"
    value={personality}
    onChange={async e => {
      setPersonality(e.target.value);
      const headers = await getHeaders();
      fetch('/api/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ personality: e.target.value }),
      }).catch(() => {});
    }}
    rows={6}
    placeholder="Describe how Based should behave..."
  />
  <div className="settings-hint">This shapes how Based talks and thinks. Changes apply immediately.</div>
</div>
```

Replace it with:

```tsx
<div className="settings-section">
  <label className="settings-label">AI Personality</label>
  <PersonalityPanel
    onPersonalityChange={async (modifier) => {
      setPersonality(modifier);
      const headers = await getHeaders();
      fetch('/api/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ personality: modifier }),
      }).catch(() => {});
    }}
  />
</div>
```

- [ ] **Step 3: Manual smoke test**

Open settings (◈ button). Personality section should show:
- `◆ Core identity — [FIXED]` locked card
- Four labeled sliders with purple fill + white thumb
- "Extra notes" textarea
- Moving a slider immediately updates the modifier (check network tab: PUT `/api/settings` fires with the built string)
- Reload the page — sliders should restore to the saved positions from localStorage

- [ ] **Step 4: Verify personality modifier reaches the chat**

Send a message in the chat. In the browser network tab, inspect the POST to `/api/generate`. The request body should contain a `personality` field with the built modifier string, e.g.:

```
"personality": "Personality modifiers: tone=casual-leaning, length=concise, humour=playful-leaning, technicality=expert-leaning."
```

- [ ] **Step 5: Commit**

```bash
git add components/PersonalityPanel.tsx app/page.tsx
git commit -m "feat: replace personality textarea with sliders — locked identity + 4 trait controls"
```

---

## Task 7: Final pass + push

**Files:**
- All modified files

- [ ] **Step 1: TypeScript + lint check**

```bash
npx tsc --noEmit && npm run lint
```

Expected: clean.

- [ ] **Step 2: End-to-end walkthrough**

1. Hard-refresh `localhost:3000` — splash plays, audio fires (or `▸` icon if blocked)
2. Click before auto-dismiss — wipe fires immediately
3. Open a project, send a chat message — `... Working` appears (not `⏳`)
4. Open settings ◈ — AI Personality shows sliders, not raw textarea
5. Drag "Technicality" to max — inspect network, personality modifier updates
6. Close and reopen settings — slider positions persist

- [ ] **Step 3: Push to trigger Vercel deploy**

```bash
git push
```

---

## Self-Review Notes

- Spec §Audio: `▸` mute icon — implemented as `splash-mute` button with `▸` symbol. ✓
- Spec §Wipe: left-to-right blade reveal — implemented via `clip-path: inset(0 N% 0 0)` animation. ✓
- Spec §Grain: SVG fractalNoise at 4% — implemented as `splash-grain` overlay. ✓
- Spec §Locked card: `◆` symbol, not editable — `personality-locked` card with no input. ✓
- Spec §Sliders: drag via mouse and touch — implemented with `pointerdown`/`pointermove`/`pointerup`. ✓
- Spec §localStorage key `based_personality` — used exactly. ✓
- Spec §Prompt injection: modifier appended as `personality` in ChatPanel fetch — handled via `onPersonalityChange` calling `setPersonality` in page.tsx, which is already wired to ChatPanel prop. ✓
- No emoji anywhere — all symbols use the brand set. ✓
- `DEFAULT_PERSONALITY` constant in page.tsx becomes stale on first render (PersonalityPanel overwrites it via `onPersonalityChange` in its mount effect). No change needed — it's just the initial value before the effect fires. ✓

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Particle {
  x: number;
  y: number;
  tx: number;
  ty: number;
  size: number;
  alpha: number;
  progress: number;
  delay: number;
  speed: number;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

interface Props {
  onDone: () => void;
}

export default function SplashScreen({ onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const exitedRef = useRef(false);
  const [logoIn, setLogoIn] = useState(false);
  const [taglineIn, setTaglineIn] = useState(false);
  const [subIn, setSubIn] = useState(false);
  const [tapHintIn, setTapHintIn] = useState(false);
  const [ringPulse, setRingPulse] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [ripple, setRipple] = useState(false);

  const exit = useCallback(() => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    // Start audio on tap — guaranteed user interaction unlocks AudioContext.
    // Wrapped in try/catch because AudioContext can throw on iOS 16 Safari and
    // some Android WebViews. A failure must never block the exit flow.
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        audioCtx
          .resume()
          .then(() => startAudio(audioCtx))
          .catch(() => {});
      }
    } catch {
      // Audio unavailable — continue silently
    }
    setExiting(true);
    setRipple(true);
    setTimeout(onDone, 500);
  }, [onDone]);

  /* ── Particle canvas ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const W = (canvas.width = window.innerWidth);
    const H = (canvas.height = window.innerHeight);
    const cx = W / 2,
      cy = H / 2;

    const particles: Particle[] = Array.from({ length: 120 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      tx: cx + (Math.random() - 0.5) * 100,
      ty: cy + (Math.random() - 0.5) * 50,
      size: Math.random() * 1.5 + 0.3,
      alpha: Math.random() * 0.7 + 0.3,
      progress: 0,
      delay: Math.random() * 0.4,
      speed: 0.02 + Math.random() * 0.03,
    }));

    let t = 0;
    const animate = () => {
      ctx.clearRect(0, 0, W, H);
      t += 0.008;
      for (const p of particles) {
        if (t < p.delay) continue;
        p.progress = Math.min(1, p.progress + p.speed);
        const e = easeInOutQuad(p.progress);
        const px = p.x + (p.tx - p.x) * e;
        const py = p.y + (p.ty - p.y) * e;
        const a = p.progress > 0.85 ? ((1 - p.progress) / 0.15) * p.alpha : p.alpha;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(201,168,124,${(a * 0.8).toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ── Reveal timers — no auto-exit, wait for tap ── */
  useEffect(() => {
    const t1 = setTimeout(() => {
      setLogoIn(true);
      setRingPulse(true);
    }, 1200);
    const t2 = setTimeout(() => setTaglineIn(true), 1800);
    const t3 = setTimeout(() => setSubIn(true), 2200);
    const t4 = setTimeout(() => setTapHintIn(true), 2800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  return (
    <div className={`splash-root${exiting ? ' exiting' : ''}`} onClick={exit}>
      <canvas ref={canvasRef} className="splash-canvas" />
      <div className="splash-center">
        <div className="splash-ring-wrap" style={{ position: 'relative' }}>
          <div className={`splash-ring${ringPulse ? ' pulse' : ''}`} />
          <img
            src="/brand-icon-animated.svg"
            className={`splash-mark${logoIn ? ' visible' : ''}`}
            alt="Based"
            width={128}
            height={128}
          />
        </div>
        <div className={`splash-tagline${taglineIn ? ' visible' : ''}`}>based</div>
        <div className={`splash-sub${subIn ? ' visible' : ''}`}>Your Personal Assistant AI</div>
      </div>
      <div className="splash-grain" />
      <div className={`splash-tap-hint${tapHintIn ? ' visible' : ''}`}>tap anywhere to enter</div>
      <div className={`splash-ripple${ripple ? ' active' : ''}`} />
    </div>
  );
}

function startAudio(ctx: AudioContext): GainNode {
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.9, now);
  master.connect(ctx.destination);

  function noiseBuffer(seconds: number) {
    const len = Math.ceil(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* sub rumble — filtered noise, not oscillator */
  const rumble = ctx.createBufferSource();
  const rumbleLPF = ctx.createBiquadFilter();
  const rumbleGain = ctx.createGain();
  rumble.buffer = noiseBuffer(1.1);
  rumbleLPF.type = 'lowpass';
  rumbleLPF.frequency.setValueAtTime(90, now);
  rumbleLPF.frequency.exponentialRampToValueAtTime(35, now + 0.9);
  rumbleGain.gain.setValueAtTime(0, now);
  rumbleGain.gain.linearRampToValueAtTime(0.28, now + 0.12);
  rumbleGain.gain.linearRampToValueAtTime(0, now + 1.0);
  rumble.connect(rumbleLPF);
  rumbleLPF.connect(rumbleGain);
  rumbleGain.connect(master);
  rumble.start(now);

  /* whoosh riser — bandpass noise sweep, not oscillator */
  const whoosh = ctx.createBufferSource();
  const whooshBPF = ctx.createBiquadFilter();
  const whooshGain = ctx.createGain();
  whoosh.buffer = noiseBuffer(0.7);
  whooshBPF.type = 'bandpass';
  whooshBPF.Q.value = 1.2;
  whooshBPF.frequency.setValueAtTime(120, now + 0.55);
  whooshBPF.frequency.exponentialRampToValueAtTime(2400, now + 1.1);
  whooshGain.gain.setValueAtTime(0, now + 0.55);
  whooshGain.gain.linearRampToValueAtTime(0.2, now + 0.85);
  whooshGain.gain.linearRampToValueAtTime(0, now + 1.12);
  whoosh.connect(whooshBPF);
  whooshBPF.connect(whooshGain);
  whooshGain.connect(master);
  whoosh.start(now + 0.55);

  /* impact — noise transient body + pitch-drop sub punch */
  const impactNoise = ctx.createBufferSource();
  const impactHPF = ctx.createBiquadFilter();
  const impactNoiseGain = ctx.createGain();
  impactNoise.buffer = noiseBuffer(0.25);
  impactHPF.type = 'bandpass';
  impactHPF.frequency.setValueAtTime(180, now + 1.13);
  impactHPF.Q.value = 0.6;
  impactNoiseGain.gain.setValueAtTime(0.6, now + 1.13);
  impactNoiseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.32);
  impactNoise.connect(impactHPF);
  impactHPF.connect(impactNoiseGain);
  impactNoiseGain.connect(master);
  impactNoise.start(now + 1.13);

  const punch = ctx.createOscillator();
  const punchGain = ctx.createGain();
  punch.type = 'sine';
  punch.frequency.setValueAtTime(130, now + 1.13);
  punch.frequency.exponentialRampToValueAtTime(32, now + 1.5);
  // Tiny hard attack then exponential drop — a real membrane snaps, it doesn't fade in.
  punchGain.gain.setValueAtTime(0, now + 1.13);
  punchGain.gain.linearRampToValueAtTime(0.6, now + 1.137);
  punchGain.gain.exponentialRampToValueAtTime(0.001, now + 1.55);
  punch.connect(punchGain);
  punchGain.connect(master);
  punch.start(now + 1.13);
  punch.stop(now + 1.6);

  /* chord — 3 detuned oscillators per note, strummed (not block-struck), so it
     sounds like a hand played it. Each note enters a few ms later than the last
     and every voice gets a touch of random gain/detune so no two are identical. */
  const notes = [466, 587, 740];
  const detuneCents = [-7, 0, 7];
  notes.forEach((base, noteIndex) => {
    // Low note first, top note last — a real upward strum spans ~14ms per string.
    const strum = noteIndex * 0.014 + (Math.random() - 0.5) * 0.006;
    const noteStart = now + 1.16 + strum;
    for (const cents of detuneCents) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = cents === 0 ? 'sine' : 'triangle';
      // Base detune plus a tiny random drift so the chorus never phase-locks.
      const drift = (Math.random() - 0.5) * 4;
      osc.frequency.setValueAtTime(base * Math.pow(2, (cents + drift) / 1200), noteStart);
      // Per-voice gain humanization — fingers never hit two strings equally hard.
      const baseVol = cents === 0 ? 0.08 : 0.05;
      const vol = baseVol * (0.85 + Math.random() * 0.3);
      g.gain.setValueAtTime(0, noteStart);
      g.gain.linearRampToValueAtTime(vol, noteStart + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, now + 2.6);
      osc.connect(g);
      g.connect(master);
      osc.start(noteStart);
      osc.stop(now + 2.7);
    }
  });

  /* shimmer tail — longer air decay, not a click */
  const shimmer = ctx.createBufferSource();
  const shimmerHPF = ctx.createBiquadFilter();
  const shimmerGain = ctx.createGain();
  shimmer.buffer = noiseBuffer(1.4);
  shimmerHPF.type = 'highpass';
  shimmerHPF.frequency.setValueAtTime(5000, now + 1.2);
  shimmerGain.gain.setValueAtTime(0, now + 1.2);
  shimmerGain.gain.linearRampToValueAtTime(0.07, now + 1.3);
  shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
  shimmer.connect(shimmerHPF);
  shimmerHPF.connect(shimmerGain);
  shimmerGain.connect(master);
  shimmer.start(now + 1.2);

  /* pop — warm thud at ripple expand (~0.42s after tap, lines up with the bloom) */
  const pop = ctx.createOscillator();
  const popGain = ctx.createGain();
  pop.type = 'sine';
  pop.frequency.setValueAtTime(90, now + 0.42);
  pop.frequency.exponentialRampToValueAtTime(28, now + 0.62);
  popGain.gain.setValueAtTime(0, now + 0.42);
  popGain.gain.linearRampToValueAtTime(0.5, now + 0.425);
  popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
  pop.connect(popGain);
  popGain.connect(master);
  pop.start(now + 0.42);
  pop.stop(now + 0.7);

  const popNoise = ctx.createBufferSource();
  const popNoiseBPF = ctx.createBiquadFilter();
  const popNoiseGain = ctx.createGain();
  popNoise.buffer = noiseBuffer(0.2);
  popNoiseBPF.type = 'bandpass';
  popNoiseBPF.frequency.setValueAtTime(220, now + 0.42);
  popNoiseBPF.Q.value = 1.5;
  popNoiseGain.gain.setValueAtTime(0.25, now + 0.42);
  popNoiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
  popNoise.connect(popNoiseBPF);
  popNoiseBPF.connect(popNoiseGain);
  popNoiseGain.connect(master);
  popNoise.start(now + 0.42);

  return master;
}

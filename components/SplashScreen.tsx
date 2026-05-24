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

  const exit = useCallback(() => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    // Start audio on tap — guaranteed user interaction unlocks AudioContext
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    audioCtx.resume().then(() => startAudio(audioCtx));
    setExiting(true);
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
            width={96}
            height={96}
          />
        </div>
        <div className={`splash-tagline${taglineIn ? ' visible' : ''}`}>based</div>
        <div className={`splash-sub${subIn ? ' visible' : ''}`}>Your Personal Assistant AI</div>
      </div>
      <div className="splash-grain" />
      <div className={`splash-tap-hint${tapHintIn ? ' visible' : ''}`}>tap anywhere to enter</div>
    </div>
  );
}

function startAudio(ctx: AudioContext): GainNode {
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(1, now);
  master.connect(ctx.destination);

  /* sub-bass drone */
  const bass = ctx.createOscillator();
  const bassGain = ctx.createGain();
  bass.frequency.setValueAtTime(40, now);
  bass.type = 'sine';
  bassGain.gain.setValueAtTime(0, now);
  bassGain.gain.linearRampToValueAtTime(0.3, now + 0.5);
  bassGain.gain.linearRampToValueAtTime(0, now + 1.4);
  bass.connect(bassGain);
  bassGain.connect(master);
  bass.start(now);
  bass.stop(now + 1.5);

  /* rising frequency sweep */
  const sweep = ctx.createOscillator();
  const sweepGain = ctx.createGain();
  sweep.frequency.setValueAtTime(80, now + 0.8);
  sweep.frequency.linearRampToValueAtTime(200, now + 1.2);
  sweepGain.gain.setValueAtTime(0.2, now + 0.8);
  sweepGain.gain.linearRampToValueAtTime(0, now + 1.2);
  sweep.connect(sweepGain);
  sweepGain.connect(master);
  sweep.start(now + 0.8);
  sweep.stop(now + 1.3);

  /* impact thud */
  for (const freq of [80, 84]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(freq, now + 1.2);
    gain.gain.setValueAtTime(0.45, now + 1.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + 1.2);
    osc.stop(now + 1.6);
  }

  /* crystalline chord */
  for (const freq of [466, 587, 740]) {
    const osc = ctx.createOscillator();
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

  /* white-noise shimmer */
  const bufLen = Math.ceil(ctx.sampleRate * 0.06);
  const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  const noiseFilter = ctx.createBiquadFilter();
  const noiseGain = ctx.createGain();
  noise.buffer = buffer;
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.setValueAtTime(3000, now + 1.4);
  noiseGain.gain.setValueAtTime(0, now + 1.4);
  noiseGain.gain.linearRampToValueAtTime(0.1, now + 1.42);
  noiseGain.gain.linearRampToValueAtTime(0, now + 1.46);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(now + 1.4);

  return master;
}

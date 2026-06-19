'use client';
import { useRef, useState, useCallback, useEffect, type ReactElement } from 'react';
import type * as ToneTypes from 'tone';
import * as ToneRuntime from 'tone';
import GeneratedMusicCard from './GeneratedMusicCard';

// ── Raw Web Audio helpers (no Tone.js — guaranteed cross-browser) ───────────
const NOTE_STEPS: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};
function noteToFreq(note: string): number {
  const m = note.match(/^([A-G](?:#|b)?)(\d+)$/);
  if (!m) return 440;
  const step = NOTE_STEPS[m[1]] ?? 0;
  const octave = parseInt(m[2]);
  return 440 * 2 ** ((step - 9 + (octave - 4) * 12) / 12);
}
const INST_OSC: Record<string, OscillatorType> = {
  piano: 'triangle',
  epiano: 'triangle',
  synth: 'sawtooth',
  pad: 'triangle',
  strings: 'triangle',
  organ: 'square',
  bass: 'sine',
  pluck: 'triangle',
  choir: 'sine',
  guitar: 'triangle',
  brass: 'sawtooth',
  flute: 'sine',
};
interface RawEffects {
  reverb: number;
  delay: number;
  distortion: number;
  pitchShift: number;
}

// Reverb impulse-response cache: reuse AudioBuffer across hits with same level
const _reverbIRCache = new WeakMap<AudioContext, Map<string, AudioBuffer>>();
function getReverbIR(ctx: AudioContext, amount: number): AudioBuffer {
  let ctxMap = _reverbIRCache.get(ctx);
  if (!ctxMap) {
    ctxMap = new Map();
    _reverbIRCache.set(ctx, ctxMap);
  }
  const key = amount.toFixed(2);
  const cached = ctxMap.get(key);
  if (cached) return cached;
  const sr = ctx.sampleRate;
  const decaySec = 0.4 + amount * 3.2;
  const bufLen = Math.floor(sr * decaySec);
  const buf = ctx.createBuffer(2, bufLen, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < bufLen; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 2);
    }
  }
  ctxMap.set(key, buf);
  return buf;
}

function makeDistortionCurve(amount: number): Float32Array {
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount * 400) * x) / (Math.PI + amount * 400 * Math.abs(x));
  }
  return curve;
}

function playRawNote(
  ctx: AudioContext,
  note: string,
  instrument: string,
  volume: number,
  pan: number,
  effects?: RawEffects
): void {
  const freq = noteToFreq(note);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  osc.type = INST_OSC[instrument] ?? 'sawtooth';
  // PitchShift: multiply frequency by semitone ratio
  const pitchRatio = effects?.pitchShift ? Math.pow(2, effects.pitchShift / 12) : 1;
  osc.frequency.value = freq * pitchRatio;
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  const now = ctx.currentTime;
  const peak = Math.max(0, Math.min(1, volume)) * 0.4;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(peak * 0.6, now + 0.12);
  gain.gain.setValueAtTime(peak * 0.6, now + 0.22);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
  osc.connect(gain);

  let lastNode: AudioNode = gain;

  // Distortion
  if (effects && effects.distortion > 0.01) {
    const ws = ctx.createWaveShaper();
    ws.curve = makeDistortionCurve(effects.distortion) as Float32Array<ArrayBuffer>;
    ws.oversample = '2x';
    lastNode.connect(ws);
    lastNode = ws;
  }

  // Delay — merge dry+wet into a sum node so reverb can chain after
  if (effects && effects.delay > 0.01) {
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const delayNode = ctx.createDelay(1.0);
    const fbGain = ctx.createGain();
    const postDelay = ctx.createGain();
    dry.gain.value = 1 - effects.delay * 0.5;
    wet.gain.value = effects.delay * 0.6;
    delayNode.delayTime.value = 0.25;
    fbGain.gain.value = 0.35;
    lastNode.connect(dry);
    lastNode.connect(delayNode);
    delayNode.connect(fbGain);
    fbGain.connect(delayNode);
    delayNode.connect(wet);
    dry.connect(postDelay);
    wet.connect(postDelay);
    lastNode = postDelay;
  }

  // Reverb — ConvolverNode with cached synthetic impulse response
  if (effects && effects.reverb > 0.01) {
    const ir = getReverbIR(ctx, effects.reverb);
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const dryG = ctx.createGain();
    const wetG = ctx.createGain();
    const postReverb = ctx.createGain();
    dryG.gain.value = 1 - effects.reverb * 0.7;
    wetG.gain.value = effects.reverb * 0.9;
    lastNode.connect(dryG);
    lastNode.connect(conv);
    conv.connect(wetG);
    dryG.connect(postReverb);
    wetG.connect(postReverb);
    lastNode = postReverb;
  }

  lastNode.connect(panner);
  panner.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.75);
}

// ── Raw drum synthesis ────────────────────────────────────────────────────
function drumKick(ctx: AudioContext, time: number, vol: number, dest: AudioNode) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol * 0.9, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(0.001, time + 0.4);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.5);
}

function drumSnare(ctx: AudioContext, time: number, vol: number, dest: AudioNode) {
  const bufLen = Math.floor(ctx.sampleRate * 0.2);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vol * 0.6, time);
  ng.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
  noise.connect(ng);
  ng.connect(dest);
  noise.start(time);
  noise.stop(time + 0.2);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 180;
  const og = ctx.createGain();
  og.gain.setValueAtTime(vol * 0.25, time);
  og.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
  osc.connect(og);
  og.connect(dest);
  osc.start(time);
  osc.stop(time + 0.1);
}

function drumHiHat(ctx: AudioContext, time: number, vol: number, decay: number, dest: AudioNode) {
  [400, 800, 1200, 1600, 2000, 2400].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime((vol * 0.06) / (1 + i * 0.2), time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    osc.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + decay + 0.01);
  });
}

function drumClap(ctx: AudioContext, time: number, vol: number, dest: AudioNode) {
  [0, 0.01, 0.02].forEach(offset => {
    const bufLen = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.5, time + offset);
    g.gain.exponentialRampToValueAtTime(0.001, time + offset + 0.09);
    noise.connect(g);
    g.connect(dest);
    noise.start(time + offset);
    noise.stop(time + offset + 0.1);
  });
}

function drumTom(ctx: AudioContext, time: number, vol: number, startFreq: number, dest: AudioNode) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startFreq, time);
  osc.frequency.exponentialRampToValueAtTime(startFreq * 0.4, time + 0.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol * 0.7, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + 0.45);
}

function playDrumHit(
  ctx: AudioContext,
  drumId: string,
  time: number,
  vol: number,
  dest: AudioNode
) {
  switch (drumId) {
    case 'kick':
      drumKick(ctx, time, vol, dest);
      break;
    case 'snare':
      drumSnare(ctx, time, vol, dest);
      break;
    case 'hhc':
      drumHiHat(ctx, time, vol, 0.05, dest);
      break;
    case 'hhopen':
      drumHiHat(ctx, time, vol, 0.4, dest);
      break;
    case 'clap':
      drumClap(ctx, time, vol, dest);
      break;
    case 'tom1':
      drumTom(ctx, time, vol, 200, dest);
      break;
    case 'tom2':
      drumTom(ctx, time, vol, 120, dest);
      break;
    case 'ride':
      drumHiHat(ctx, time, vol, 0.6, dest);
      break;
  }
}

// ── Tone state types ───────────────────────────────────────────────────────
interface ToneFxChain {
  reverb: ToneTypes.Reverb;
  delay: ToneTypes.FeedbackDelay;
  distortion: ToneTypes.Distortion;
  pitchShift: ToneTypes.PitchShift;
  panner: ToneTypes.Panner;
}

// Tone.js exports many instrument classes with mutually-incompatible TypeScript signatures
// due to contravariance on triggerAttackRelease. We store them as unknown and cast at
// the specific guarded call sites (all inside try{} blocks).
interface ToneState {
  Tone: typeof ToneTypes;
  synths: Record<string, unknown>;
  drums: Record<string, unknown>;
  synthFx: Record<string, ToneFxChain>;
  recorder: ToneTypes.Recorder;
  masterGain: ToneTypes.Gain;
}

// Minimal interface for calling common instrument methods
// Note/time args use string since Tone's Frequency/Time unit types are strings at runtime
interface PlayableInstrument {
  volume: { value: number };
  triggerAttackRelease: (
    noteOrDuration: string | string[],
    durationOrTime?: string | number,
    time?: number
  ) => unknown;
}

// ── Types ──────────────────────────────────────────────────────────────────
interface Track {
  id: string;
  name: string;
  type: 'instrument' | 'vocal' | 'audio';
  instrument: string;
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  color: string;
  drumPattern: boolean[][];
  audioUrl?: string;
  effects: { reverb: number; delay: number; distortion: number; pitchShift: number };
}

// ── Constants ──────────────────────────────────────────────────────────────
const TRACK_COLORS = [
  '#6366f1',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
];

const DRUM_ROWS = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'hhc', label: 'Hi-Hat' },
  { id: 'hhopen', label: 'Open HH' },
  { id: 'clap', label: 'Clap' },
  { id: 'tom1', label: 'Tom H' },
  { id: 'tom2', label: 'Tom L' },
  { id: 'ride', label: 'Ride' },
];

const INSTRUMENTS = [
  { id: 'piano', label: 'Grand Piano' },
  { id: 'epiano', label: 'Electric Piano' },
  { id: 'synth', label: 'Synth Lead' },
  { id: 'pad', label: 'Synth Pad' },
  { id: 'strings', label: 'Strings' },
  { id: 'organ', label: 'Organ' },
  { id: 'bass', label: 'Bass' },
  { id: 'pluck', label: 'Pluck' },
  { id: 'choir', label: 'Choir' },
  { id: 'guitar', label: 'Guitar' },
  { id: 'brass', label: 'Brass' },
  { id: 'flute', label: 'Flute' },
];

// white key order and which have black keys to the right
const WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const HAS_BLACK = { C: 'C#', D: 'D#', F: 'F#', G: 'G#', A: 'A#' } as Record<string, string>;

const MUSIC_GENRES = [
  'Cinematic',
  'Lo-fi',
  'Electronic',
  'Ambient',
  'Jazz',
  'Rock',
  'Orchestral',
  'Chill',
  'Epic',
  'Dark',
];

const DEFAULT_EFFECTS = { reverb: 0, delay: 0, distortion: 0, pitchShift: 0 };

function makeTrack(type: Track['type'], idx: number): Track {
  const labels: Record<Track['type'], string> = {
    instrument: `Track ${idx}`,
    vocal: `Vocal ${idx}`,
    audio: `Audio ${idx}`,
  };
  return {
    id: Date.now().toString() + Math.random(),
    name: labels[type],
    type,
    instrument: 'synth',
    volume: 0.8,
    pan: 0,
    muted: false,
    soloed: false,
    color: TRACK_COLORS[idx % TRACK_COLORS.length],
    drumPattern: DRUM_ROWS.map(() => Array(16).fill(false)),
    effects: { ...DEFAULT_EFFECTS },
  };
}

// ── Component ──────────────────────────────────────────────────────────────
export default function StudioPanel({
  authToken,
  subscriptionTier,
}: {
  authToken?: string;
  subscriptionTier?: 'free' | 'beta' | 'pro';
}) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [bpm, setBpm] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [selTrack, setSelTrack] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'piano' | 'drums' | 'effects' | 'mixer' | 'ai'>(
    'piano'
  );
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicGenre, setMusicGenre] = useState('');
  const [musicDuration, setMusicDuration] = useState(30);
  const [musicGenerating, setMusicGenerating] = useState(false);
  const [musicError, setMusicError] = useState('');
  const musicAbortRef = useRef<AbortController | null>(null);
  const [generatedTracks, setGeneratedTracks] = useState<{ url: string; prompt: string }[]>([]);
  const [octave, setOctave] = useState(4);
  const [litKeys, setLitKeys] = useState<Set<string>>(new Set());
  const [showC4Hint, setShowC4Hint] = useState(() =>
    typeof window !== 'undefined' ? !localStorage.getItem('studio_c4_hint_seen') : false
  );
  const showC4HintRef = useRef(showC4Hint);
  const [micLevel, setMicLevel] = useState(0);
  const [aiInput, setAiInput] = useState('');
  const [aiHint, setAiHint] = useState('');
  const [toneReady, setToneReady] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [exportUrl, setExportUrl] = useState('');
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState('');

  const tRef = useRef<ToneState | null>(null); // { Tone, synths, drums, fx }
  const rawCtxRef = useRef<AudioContext | null>(null); // raw Web Audio ctx for all audio
  const seqRef = useRef<ToneTypes.Sequence | null>(null);
  // Drum scheduler refs
  const nextNoteTimeRef = useRef(0);
  const currentStepRawRef = useRef(0);
  const schedulerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tracksRef = useRef<Track[]>([]);
  const bpmRef = useRef(120);
  const mrRef = useRef<MediaRecorder | null>(null);
  const micRafRef = useRef(0);
  const audioElRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const connectedSourcesRef = useRef<Map<string, MediaElementAudioSourceNode>>(new Map());
  // Per-vocal-track full Web Audio FX chain
  const vocalChainsRef = useRef<
    Map<
      string,
      {
        gain: GainNode;
        distWet: GainNode;
        distDry: GainNode;
        ws: WaveShaperNode;
        delayWet: GainNode;
        delayDry: GainNode;
        reverbWet: GainNode;
        reverbDry: GainNode;
        convolver: ConvolverNode;
        el: HTMLAudioElement;
        pitchNode: AudioWorkletNode | null;
      }
    >
  >(new Map());
  const workletReadyRef = useRef<Promise<void> | null>(null);

  // ── Tone.js lazy init ───────────────────────────────────────────────────
  const initTone = useCallback(async () => {
    if (tRef.current) return tRef.current;
    setStatus('Loading audio engine…');
    // Use statically imported module — no dynamic chunk fetch, no Turbopack HMR abort possible.
    const Tone = ToneRuntime as unknown as typeof ToneTypes;
    // Do NOT catch AbortError here. If start() throws, tRef.current is never set,
    // so the next key press retries the full init including AudioContext.resume().
    // Desktop Chrome has stricter autoplay enforcement and may fail on first attempt.
    await ToneRuntime.start();
    Tone.Transport.bpm.value = bpm;

    // Master bus — all audio forks to speakers and recorder
    const masterGain = new Tone.Gain(1).toDestination();
    const recorder = new Tone.Recorder();
    masterGain.connect(recorder);

    // Per-instrument fx chain: synth → reverb → delay → distortion → pitchShift → panner → master
    const mkFxChain = () => {
      const reverb = new Tone.Reverb({ decay: 3, wet: 0 });
      const delay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.35, wet: 0 });
      const distortion = new Tone.Distortion({ distortion: 0.5, wet: 0 });
      const pitchShift = new Tone.PitchShift({ pitch: 0, wet: 0 });
      const panner = new Tone.Panner(0).connect(masterGain);
      reverb.chain(delay, distortion, pitchShift, panner);
      return { reverb, delay, distortion, pitchShift, panner };
    };

    // ── Synths (each connected to its own fx chain) ────────────────────
    const pianoFx = mkFxChain();
    const piano = new Tone.Sampler({
      urls: {
        C4: 'C4.mp3',
        'D#4': 'Ds4.mp3',
        'F#4': 'Fs4.mp3',
        A4: 'A4.mp3',
        C5: 'C5.mp3',
        'D#5': 'Ds5.mp3',
        'F#5': 'Fs5.mp3',
        A5: 'A5.mp3',
        C3: 'C3.mp3',
        'D#3': 'Ds3.mp3',
        'F#3': 'Fs3.mp3',
        A3: 'A3.mp3',
        C6: 'C6.mp3',
        'D#6': 'Ds6.mp3',
        'F#6': 'Fs6.mp3',
        A6: 'A6.mp3',
      },
      release: 1,
      baseUrl: 'https://tonejs.github.io/audio/salamander/',
      onload: () => setStatus(''),
    }).connect(pianoFx.reverb);

    const leadFx = mkFxChain();
    const lead = new Tone.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.5 },
    }).connect(leadFx.reverb);

    const padFx = mkFxChain();
    const pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.8, decay: 0.3, sustain: 0.7, release: 1.5 },
    }).connect(padFx.reverb);

    const bassFx = mkFxChain();
    const bass = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.3 },
    }).connect(bassFx.reverb);

    const organFx = mkFxChain();
    const organ = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'square' },
      envelope: { attack: 0.01, sustain: 1, release: 0.1 },
    }).connect(organFx.reverb);

    const stringsFx = mkFxChain();
    const strings = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.4, decay: 0.2, sustain: 0.8, release: 1.2 },
    }).connect(stringsFx.reverb);

    const pluckFx = mkFxChain();
    const pluck = new Tone.PluckSynth({ attackNoise: 1, dampening: 4000, resonance: 0.75 }).connect(
      pluckFx.reverb
    );

    const epFx = mkFxChain();
    const epiano = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 10,
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.8 },
    }).connect(epFx.reverb);

    const choirFx = mkFxChain();
    const choir = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.6, sustain: 0.9, release: 1.5 },
    }).connect(choirFx.reverb);

    const guitarFx = mkFxChain();
    const guitar = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.8 },
    }).connect(guitarFx.reverb);

    const brassFx = mkFxChain();
    const brass = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    }).connect(brassFx.reverb);

    const fluteFx = mkFxChain();
    const flute = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.1, decay: 0.1, sustain: 0.8, release: 0.5 },
    }).connect(fluteFx.reverb);

    // ── Drums (direct to master) ────────────────────────────────────────
    const kick = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 6,
      envelope: { attack: 0.001, decay: 0.3 },
    }).connect(masterGain);
    const snare = new Tone.NoiseSynth({
      noise: { type: 'white' as const },
      envelope: { attack: 0.001, decay: 0.15 },
    }).connect(masterGain);
    const hhc = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.05 },
      resonance: 5000,
      harmonicity: 5.1,
      modulationIndex: 32,
      octaves: 1.5,
    }).connect(masterGain);
    hhc.frequency.value = 400;
    const hhopen = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.4 },
      resonance: 5000,
      harmonicity: 5.1,
      modulationIndex: 32,
      octaves: 1.5,
    }).connect(masterGain);
    hhopen.frequency.value = 400;
    const clap = new Tone.NoiseSynth({
      noise: { type: 'pink' as const },
      envelope: { attack: 0.005, decay: 0.1 },
    }).connect(masterGain);
    const tom1 = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 4 }).connect(masterGain);
    const tom2 = new Tone.MembraneSynth({ pitchDecay: 0.1, octaves: 3 }).connect(masterGain);
    const ride = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.5 },
      resonance: 3000,
      harmonicity: 5.1,
      modulationIndex: 16,
      octaves: 1.5,
    }).connect(masterGain);
    ride.frequency.value = 250;

    const synthFx: Record<string, ToneFxChain> = {
      piano: pianoFx,
      epiano: epFx,
      synth: leadFx,
      pad: padFx,
      strings: stringsFx,
      organ: organFx,
      bass: bassFx,
      pluck: pluckFx,
      choir: choirFx,
      guitar: guitarFx,
      brass: brassFx,
      flute: fluteFx,
    };

    const obj = {
      Tone,
      synths: {
        piano,
        lead,
        pad,
        bass,
        organ,
        strings,
        pluck,
        epiano,
        choir,
        guitar,
        brass,
        flute,
      },
      drums: { kick, snare, hhc, hhopen, clap, tom1, tom2, ride },
      synthFx,
      recorder,
      masterGain,
    };
    tRef.current = obj;
    setToneReady(true);
    setStatus('Loading Grand Piano samples…');
    return obj;
  }, [bpm]);

  const getSynth = (instrument: string): PlayableInstrument | null => {
    const map: Record<string, string> = {
      piano: 'piano',
      epiano: 'epiano',
      synth: 'lead',
      pad: 'pad',
      strings: 'strings',
      organ: 'organ',
      bass: 'bass',
      pluck: 'pluck',
      choir: 'choir',
      guitar: 'guitar',
      brass: 'brass',
      flute: 'flute',
    };
    return (tRef.current?.synths[map[instrument] ?? 'lead'] as PlayableInstrument) ?? null;
  };

  // Keep tracksRef / bpmRef / showC4HintRef always current so closures read live values
  useEffect(() => {
    showC4HintRef.current = showC4Hint;
  }, [showC4Hint]);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);
  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  // ── Play a note (raw Web Audio — no Tone.js context issues) ────────────
  const playNote = useCallback(
    (note: string) => {
      if (showC4HintRef.current) {
        setShowC4Hint(false);
        localStorage.setItem('studio_c4_hint_seen', '1');
      }
      // Create AudioContext synchronously on first call — Chrome requires this
      // to happen within a user gesture (click/touch). No awaits before it.
      if (!rawCtxRef.current) {
        rawCtxRef.current = new AudioContext();
      }
      const ctx = rawCtxRef.current;

      const track = tracks.find(tr => tr.id === selTrack);
      const instrument = track?.instrument ?? 'synth';
      const volume = track?.muted ? 0 : (track?.volume ?? 0.8);
      const pan = track?.pan ?? 0;
      const effects = track?.effects;

      // resume() is always safe to call — no-op if already running
      ctx.resume().then(() => {
        setAudioUnlocked(true);
        setToneReady(true);
        setStatus('');
        playRawNote(ctx, note, instrument, volume, pan, effects);
      });

      setLitKeys(s => new Set([...s, note]));
      setTimeout(
        () =>
          setLitKeys(s => {
            const n = new Set(s);
            n.delete(note);
            return n;
          }),
        200
      );
    },
    [selTrack, tracks]
  );

  // ── Transport — raw Web Audio lookahead scheduler ──────────────────────
  const scheduleStep = useCallback(() => {
    const ctx = rawCtxRef.current;
    if (!ctx) return;
    const LOOKAHEAD = 0.1; // seconds ahead to schedule
    const TICK_MS = 25; // how often to run (ms)

    while (nextNoteTimeRef.current < ctx.currentTime + LOOKAHEAD) {
      const step = currentStepRawRef.current;
      const t = nextNoteTimeRef.current;

      // UI update (draw) happens via setTimeout to avoid AudioContext scheduling conflicts
      const stepCopy = step;
      const timeDelta = Math.max(0, (t - ctx.currentTime) * 1000);
      setTimeout(() => setCurrentStep(stepCopy), timeDelta);

      const currentTracks = tracksRef.current;
      const anySoloed = currentTracks.some(tr => tr.soloed);
      currentTracks.forEach(track => {
        if (track.type !== 'instrument') return;
        const audible = anySoloed ? track.soloed : !track.muted;
        if (!audible) return;

        // Build per-track drum output bus (with reverb if configured)
        let drumDest: AudioNode = ctx.destination;
        if (track.effects.reverb > 0.01) {
          const bus = ctx.createGain();
          const dryG = ctx.createGain();
          const wetG = ctx.createGain();
          const conv = ctx.createConvolver();
          conv.buffer = getReverbIR(ctx, track.effects.reverb);
          dryG.gain.value = 1 - track.effects.reverb * 0.7;
          wetG.gain.value = track.effects.reverb * 0.9;
          bus.connect(dryG);
          bus.connect(conv);
          dryG.connect(ctx.destination);
          conv.connect(wetG);
          wetG.connect(ctx.destination);
          drumDest = bus;
        }

        track.drumPattern.forEach((row, ri) => {
          if (!row[step]) return;
          const drumId = DRUM_ROWS[ri]?.id;
          if (drumId) playDrumHit(ctx, drumId, t, track.volume, drumDest);
        });
      });

      const secPer16th = 60 / (bpmRef.current * 4);
      nextNoteTimeRef.current += secPer16th;
      currentStepRawRef.current = (step + 1) % 16;
    }

    schedulerTimerRef.current = setTimeout(scheduleStep, TICK_MS);
  }, []);

  const startPlayback = () => {
    if (!rawCtxRef.current) rawCtxRef.current = new AudioContext();
    const ctx = rawCtxRef.current;
    ctx.resume().then(() => {
      setAudioUnlocked(true);
      setToneReady(true);
      nextNoteTimeRef.current = ctx.currentTime + 0.05;
      currentStepRawRef.current = 0;
      scheduleStep();
      setPlaying(true);
    });
  };

  const stopPlayback = () => {
    if (schedulerTimerRef.current !== null) {
      clearTimeout(schedulerTimerRef.current);
      schedulerTimerRef.current = null;
    }
    setPlaying(false);
    setCurrentStep(-1);
  };

  const startExport = async () => {
    let toneState: ToneState;
    try {
      toneState = await initTone();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      throw e;
    }
    const { recorder, masterGain, Tone } = toneState;

    // Connect vocal/audio elements into the Tone audio graph so they get captured
    const anySoloed = tracks.some(tr => tr.soloed);
    const ctx = Tone.getContext().rawContext as AudioContext;
    tracks.forEach(track => {
      if ((track.type !== 'vocal' && track.type !== 'audio') || !track.audioUrl) return;
      const audible = anySoloed ? track.soloed : !track.muted;
      if (!audible) return;
      const el = audioElRefs.current.get(track.id);
      if (!el || connectedSourcesRef.current.has(track.id)) return;
      try {
        const src = ctx.createMediaElementSource(el);
        src.connect(masterGain.input); // into the recorded mix
        src.connect(ctx.destination); // also to speakers
        connectedSourcesRef.current.set(track.id, src);
      } catch {}
      el.currentTime = 0;
      el.volume = Math.min(1, track.volume);
      el.play().catch(() => {});
    });

    recorder.start();
    setExporting(true);
    setExportUrl('');
    if (!playing) startPlayback();
  };

  const stopExport = async () => {
    if (!tRef.current) return;
    const blob = await tRef.current.recorder.stop();
    setExportUrl(URL.createObjectURL(blob));
    setExporting(false);
    stopPlayback();
    audioElRefs.current.forEach(el => {
      el.pause();
      el.currentTime = 0;
    });
  };

  useEffect(() => {
    if (tRef.current) tRef.current.Tone.Transport.bpm.value = bpm;
  }, [bpm]);

  // Sync all vocal/audio FX to their Web Audio chains (or el.volume fallback before unlock)
  useEffect(() => {
    const ctx = rawCtxRef.current;
    tracks.forEach(track => {
      if (track.type !== 'vocal' && track.type !== 'audio') return;
      const chain = vocalChainsRef.current.get(track.id);
      if (chain) {
        // Volume
        chain.gain.gain.value = track.muted ? 0 : track.volume;
        // Distortion
        if (track.effects.distortion > 0.01) {
          chain.ws.curve = makeDistortionCurve(
            track.effects.distortion
          ) as Float32Array<ArrayBuffer>;
          chain.distDry.gain.value = 1 - track.effects.distortion * 0.5;
          chain.distWet.gain.value = track.effects.distortion * 0.7;
        } else {
          chain.distDry.gain.value = 1;
          chain.distWet.gain.value = 0;
        }
        // Delay
        chain.delayDry.gain.value = track.effects.delay > 0.01 ? 1 - track.effects.delay * 0.5 : 1;
        chain.delayWet.gain.value = track.effects.delay > 0.01 ? track.effects.delay * 0.6 : 0;
        // Reverb
        chain.reverbDry.gain.value =
          track.effects.reverb > 0.01 ? 1 - track.effects.reverb * 0.7 : 1;
        chain.reverbWet.gain.value = track.effects.reverb > 0.01 ? track.effects.reverb * 0.9 : 0;
        if (track.effects.reverb > 0.01 && ctx)
          chain.convolver.buffer = getReverbIR(ctx, track.effects.reverb);
        // Pitch via AudioWorklet OLA pitch-shifter (no tempo change)
        if (chain.pitchNode) {
          chain.pitchNode.port.postMessage({ pitch: Math.pow(2, track.effects.pitchShift / 12) });
        }
      } else {
        const el = audioElRefs.current.get(track.id);
        if (el) el.volume = track.muted ? 0 : Math.min(1, track.volume);
      }
    });
  }, [tracks]);

  // Wire vocal/audio elements through the full FX chain once audio is unlocked
  useEffect(() => {
    if (!audioUnlocked) return;
    const ctx = rawCtxRef.current;
    if (!ctx) return;

    // Load pitch-shifter AudioWorklet once (cached in workletReadyRef)
    // audioWorklet is undefined in non-secure contexts or unsupported browsers — skip gracefully
    if (!workletReadyRef.current) {
      workletReadyRef.current = ctx.audioWorklet
        ? ctx.audioWorklet.addModule('/pitch-worklet.js').catch(() => {})
        : Promise.resolve();
    }

    void workletReadyRef.current.then(() => {
      tracks.forEach(track => {
        if ((track.type !== 'vocal' && track.type !== 'audio') || !track.audioUrl) return;
        if (vocalChainsRef.current.has(track.id)) return;
        const el = audioElRefs.current.get(track.id);
        if (!el) return;
        try {
          const source = ctx.createMediaElementSource(el);

          // Volume
          const gainNode = ctx.createGain();
          gainNode.gain.value = track.muted ? 0 : track.volume;

          // Pitch shift — OLA AudioWorklet (no tempo change). Falls back to bypass on error.
          let pitchNode: AudioWorkletNode | null = null;
          try {
            pitchNode = new AudioWorkletNode(ctx, 'pitch-shifter');
            pitchNode.port.postMessage({ pitch: Math.pow(2, track.effects.pitchShift / 12) });
            gainNode.connect(pitchNode);
          } catch {
            pitchNode = null;
          }
          const preDist: AudioNode = pitchNode ?? gainNode;

          // Distortion bus: preDist → [ws wet + bypass dry] → postDist
          const ws = ctx.createWaveShaper();
          ws.curve = makeDistortionCurve(
            track.effects.distortion > 0.01 ? track.effects.distortion : 0.001
          ) as Float32Array<ArrayBuffer>;
          ws.oversample = '2x';
          const distDry = ctx.createGain();
          const distWet = ctx.createGain();
          const postDist = ctx.createGain();
          distDry.gain.value =
            track.effects.distortion > 0.01 ? 1 - track.effects.distortion * 0.5 : 1;
          distWet.gain.value = track.effects.distortion > 0.01 ? track.effects.distortion * 0.7 : 0;
          preDist.connect(distDry);
          preDist.connect(ws);
          ws.connect(distWet);
          distDry.connect(postDist);
          distWet.connect(postDist);

          // Delay bus: postDist → [delayNode feedback wet + dry] → postDelay
          const delayNode = ctx.createDelay(1.0);
          const delayFb = ctx.createGain();
          const delayDry = ctx.createGain();
          const delayWet = ctx.createGain();
          const postDelay = ctx.createGain();
          delayNode.delayTime.value = 0.25;
          delayFb.gain.value = 0.35;
          delayDry.gain.value = track.effects.delay > 0.01 ? 1 - track.effects.delay * 0.5 : 1;
          delayWet.gain.value = track.effects.delay > 0.01 ? track.effects.delay * 0.6 : 0;
          postDist.connect(delayDry);
          postDist.connect(delayNode);
          delayNode.connect(delayFb);
          delayFb.connect(delayNode);
          delayNode.connect(delayWet);
          delayDry.connect(postDelay);
          delayWet.connect(postDelay);

          // Reverb bus: postDelay → [conv wet + dry] → destination
          const conv = ctx.createConvolver();
          const reverbDry = ctx.createGain();
          const reverbWet = ctx.createGain();
          reverbDry.gain.value = track.effects.reverb > 0.01 ? 1 - track.effects.reverb * 0.7 : 1;
          reverbWet.gain.value = track.effects.reverb > 0.01 ? track.effects.reverb * 0.9 : 0;
          if (track.effects.reverb > 0.01) conv.buffer = getReverbIR(ctx, track.effects.reverb);
          postDelay.connect(reverbDry);
          postDelay.connect(conv);
          conv.connect(reverbWet);
          reverbDry.connect(ctx.destination);
          reverbWet.connect(ctx.destination);

          source.connect(gainNode);
          vocalChainsRef.current.set(track.id, {
            gain: gainNode,
            distWet,
            distDry,
            ws,
            delayWet,
            delayDry,
            reverbWet,
            reverbDry,
            convolver: conv,
            el,
            pitchNode,
          });
          connectedSourcesRef.current.set(track.id, source);
        } catch {}
      });
    });
  }, [audioUnlocked, tracks]);

  // Apply selected track's FX/volume/pan to Tone nodes whenever React state changes
  useEffect(() => {
    if (!toneReady || !tRef.current) return;
    const track = tracks.find(t => t.id === selTrack);
    if (!track || track.type !== 'instrument') return;
    const { synthFx, synths, Tone } = tRef.current;
    const synthKeyMap: Record<string, string> = {
      piano: 'piano',
      epiano: 'epiano',
      synth: 'lead',
      pad: 'pad',
      strings: 'strings',
      organ: 'organ',
      bass: 'bass',
      pluck: 'pluck',
      choir: 'choir',
      guitar: 'guitar',
      brass: 'brass',
      flute: 'flute',
    };
    const synth = synths[synthKeyMap[track.instrument] ?? 'lead'] as PlayableInstrument | undefined;
    const fx = synthFx[track.instrument];
    if (synth) synth.volume.value = track.muted ? -Infinity : Tone.gainToDb(track.volume);
    if (fx) {
      fx.reverb.wet.value = track.effects.reverb;
      fx.delay.wet.value = track.effects.delay;
      fx.distortion.wet.value = track.effects.distortion;
      fx.pitchShift.pitch = track.effects.pitchShift;
      fx.pitchShift.wet.value = track.effects.pitchShift !== 0 ? 1 : 0;
      fx.panner.pan.value = track.pan;
    }
  }, [tracks, selTrack, toneReady]);

  // ── Voice recording ─────────────────────────────────────────────────────
  const startRecording = async (existingTrackId?: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);

      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = e => chunks.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        if (existingTrackId) {
          // Update the placeholder track that addTrack already created
          setTracks(prev =>
            prev.map(t => (t.id === existingTrackId ? { ...t, audioUrl: url } : t))
          );
        } else {
          setTracks(prev => {
            const idx = prev.filter(t => t.type === 'vocal').length + 1;
            return [...prev, { ...makeTrack('vocal', idx), audioUrl: url }];
          });
        }
        stream.getTracks().forEach(t => t.stop());
        cancelAnimationFrame(micRafRef.current);
        setMicLevel(0);
      };

      const drawLevel = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        setMicLevel(data.reduce((a, b) => a + b, 0) / data.length / 128);
        micRafRef.current = requestAnimationFrame(drawLevel);
      };
      drawLevel();
      mr.start();
      mrRef.current = mr;
      setRecording(true);
    } catch {
      // If mic was denied and we had a placeholder, remove it
      if (existingTrackId) setTracks(prev => prev.filter(t => t.id !== existingTrackId));
      setAiHint('Microphone access denied. Allow mic access to record vocals.');
    }
  };

  const stopRecording = () => {
    mrRef.current?.stop();
    mrRef.current = null;
    setRecording(false);
  };

  // ── Upload audio file ───────────────────────────────────────────────────
  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setTracks(prev => {
      const idx = prev.filter(t => t.type === 'audio').length + 1;
      const track = makeTrack('audio', idx);
      track.name = file.name.replace(/\.[^.]+$/, '');
      track.audioUrl = url;
      return [...prev, track];
    });
    e.target.value = '';
  };

  // ── Track helpers ───────────────────────────────────────────────────────
  const addTrack = (type: Track['type']) => {
    const idx = tracks.filter(t => t.type === type).length + 1;
    const track = makeTrack(type, idx);
    setTracks(prev => [...prev, track]);
    setSelTrack(track.id);
    if (type === 'instrument') setActiveTab('piano');
    else if (type === 'vocal') {
      setActiveTab('piano');
      startRecording(track.id); // update the placeholder instead of creating a second track
    }
  };

  const removeTrack = (id: string) => {
    setTracks(prev => prev.filter(t => t.id !== id));
    if (selTrack === id) setSelTrack(null);
  };

  const updateTrack = (id: string, patch: Partial<Track>) =>
    setTracks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));

  const toggleDrumStep = (trackId: string, row: number, step: number) =>
    setTracks(prev =>
      prev.map(t => {
        if (t.id !== trackId) return t;
        const dp = t.drumPattern.map((r, ri) =>
          ri === row ? r.map((v, si) => (si === step ? !v : v)) : r
        );
        return { ...t, drumPattern: dp };
      })
    );

  // ── Computer keyboard → piano ───────────────────────────────────────────
  useEffect(() => {
    const map: Record<string, string> = {
      a: `C${octave}`,
      w: `C#${octave}`,
      s: `D${octave}`,
      e: `D#${octave}`,
      d: `E${octave}`,
      f: `F${octave}`,
      t: `F#${octave}`,
      g: `G${octave}`,
      y: `G#${octave}`,
      h: `A${octave}`,
      u: `A#${octave}`,
      j: `B${octave}`,
      k: `C${octave + 1}`,
      o: `C#${octave + 1}`,
      l: `D${octave + 1}`,
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.repeat) return;
      if (activeTab === 'piano' && map[e.key]) playNote(map[e.key]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [octave, activeTab, playNote]);

  // ── AI music generation ──────────────────────────────────────────────────
  const generateAiMusic = async (overridePrompt?: string) => {
    const base = (overridePrompt ?? musicPrompt).trim();
    if (!authToken || !base) return;
    const abort = new AbortController();
    musicAbortRef.current = abort;
    setMusicGenerating(true);
    setMusicError('');
    try {
      const fullPrompt = musicGenre ? `${musicGenre}: ${base}` : base;
      const res = await fetch('/api/music', {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ prompt: fullPrompt, duration: musicDuration }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Generation failed');
      const displayPrompt = data.enhanced || fullPrompt;
      setGeneratedTracks(prev => [{ url: data.url, prompt: displayPrompt }, ...prev]);
      setMusicPrompt('');
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setMusicError(e instanceof Error ? e.message : String(e));
    } finally {
      musicAbortRef.current = null;
      setMusicGenerating(false);
    }
  };

  // ── AI commands ─────────────────────────────────────────────────────────
  const applyAI = async () => {
    const s = aiInput.toLowerCase().trim();
    let matched = false;

    // BPM
    const bpmM = s.match(/(\d+)\s*bpm/);
    if (bpmM) {
      setBpm(parseInt(bpmM[1]));
      matched = true;
    }

    // Add track
    if (!matched && s.match(/add.*(drum|beat)/)) {
      addTrack('instrument');
      matched = true;
    }
    if (!matched && s.match(/add.*(piano|instrument|track)/)) {
      addTrack('instrument');
      matched = true;
    }
    if (!matched && s.match(/add.*(vocal|voice|mic)/)) {
      addTrack('vocal');
      matched = true;
    }

    // Drum presets
    const patterns: Record<string, boolean[][]> = {
      rock: [
        [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0].map(Boolean),
        [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0].map(Boolean),
        [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0].map(Boolean),
        Array(16).fill(false),
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0].map(Boolean),
        Array(16).fill(false),
        Array(16).fill(false),
        Array(16).fill(false),
      ],
      hiphop: [
        [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0].map(Boolean),
        [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0].map(Boolean),
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(Boolean),
        Array(16).fill(false),
        Array(16).fill(false),
        Array(16).fill(false),
        Array(16).fill(false),
        Array(16).fill(false),
      ],
      house: [
        [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0].map(Boolean),
        [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0].map(Boolean),
        [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0].map(Boolean),
        Array(16).fill(false),
        Array(16).fill(false),
        Array(16).fill(false),
        Array(16).fill(false),
        Array(16).fill(false),
      ],
    };

    // Normalise common multi-word genre spellings so "hip hop" matches "hiphop"
    const sNorm = s.replace(/hip\s*hop/g, 'hiphop');

    if (!matched) {
      for (const [name, pattern] of Object.entries(patterns)) {
        if (sNorm.includes(name)) {
          const drumTrack = tracks.find(tr => tr.type === 'instrument');
          if (drumTrack) {
            updateTrack(drumTrack.id, { drumPattern: pattern });
            setActiveTab('drums');
          } else {
            const idx = tracks.length + 1;
            const t = makeTrack('instrument', idx);
            t.drumPattern = pattern;
            setTracks(prev => [...prev, t]);
            setSelTrack(t.id);
            setActiveTab('drums');
          }
          matched = true;
          break;
        }
      }
    }

    // Chord preview
    if (!matched && (s.includes('chord') || s.includes('progression'))) {
      await initTone();
      const synth = getSynth(tracks.find(tr => tr.id === selTrack)?.instrument ?? 'piano');
      if (synth) {
        const progs: Record<string, string[][]> = {
          major: [
            ['C4', 'E4', 'G4'],
            ['F4', 'A4', 'C5'],
            ['G4', 'B4', 'D5'],
            ['C4', 'E4', 'G4'],
          ],
          minor: [
            ['A3', 'C4', 'E4'],
            ['D4', 'F4', 'A4'],
            ['E4', 'G#4', 'B4'],
            ['A3', 'C4', 'E4'],
          ],
          jazz: [
            ['C4', 'E4', 'G4', 'B4'],
            ['A3', 'C4', 'E4', 'G4'],
            ['D4', 'F4', 'A4', 'C5'],
            ['G3', 'B3', 'D4', 'F4'],
          ],
          blues: [
            ['A3', 'C4', 'E4'],
            ['A3', 'C4', 'E4'],
            ['D4', 'F4', 'A4'],
            ['A3', 'C4', 'E4'],
            ['E4', 'G4', 'B4'],
            ['A3', 'C4', 'E4'],
          ],
        };
        let key = 'major';
        if (s.includes('minor')) key = 'minor';
        if (s.includes('jazz')) key = 'jazz';
        if (s.includes('blues')) key = 'blues';
        progs[key].forEach((chord, i) => {
          setTimeout(() => {
            try {
              synth.triggerAttackRelease(chord, '2n');
            } catch {}
          }, i * 1200);
        });
      }
      matched = true;
    }

    if (matched) {
      setAiInput('');
      setAiHint('');
      return;
    }

    // No local control matched — treat it as a free-form music description.
    // Pro users get a full AI-generated track; everyone else gets guidance.
    if (subscriptionTier === 'pro') {
      const desc = aiInput.trim();
      setActiveTab('ai');
      setMusicPrompt(desc);
      setAiInput('');
      setAiHint('Generating a track from your description…');
      generateAiMusic(desc);
      return;
    }

    setAiHint(
      'Try: "120 BPM", "add drum track", "rock beat", "hip hop beat", "house beat", or "chord progression jazz". Full AI track generation is a Pro feature.'
    );
  };

  // Auto-clear the inline hint after a few seconds
  useEffect(() => {
    if (!aiHint) return;
    const id = setTimeout(() => setAiHint(''), 6000);
    return () => clearTimeout(id);
  }, [aiHint]);

  const sel = tracks.find(t => t.id === selTrack);

  // ── Audio unlock (Opera GX Incognito / strict autoplay browsers) ─────────
  // Some browsers block AudioContext.resume() unless it originates from a
  // direct, synchronous click handler with no async hops before it.
  // This button satisfies that requirement and unlocks audio for the session.
  const unlockAudio = () => {
    // Create and resume AudioContext synchronously within the click handler.
    // This is the only path that satisfies Chrome's strict autoplay policy.
    if (!rawCtxRef.current) rawCtxRef.current = new AudioContext();
    rawCtxRef.current.resume().then(() => {
      setAudioUnlocked(true);
      setToneReady(true);
      setStatus('');
    });
  };

  // ── Piano keyboard renderer ──────────────────────────────────────────────
  const renderPiano = (oct: number) => {
    const keys: ReactElement[] = [];
    WHITE_NOTES.forEach((note, wi) => {
      const fullNote = `${note}${oct}`;
      const isC4 = showC4Hint && fullNote === 'C4';
      keys.push(
        <div
          key={fullNote}
          className={`piano-white${litKeys.has(fullNote) ? ' lit' : ''}${isC4 ? ' c4-hint' : ''}`}
          style={isC4 ? { position: 'relative' } : undefined}
          onMouseDown={() => playNote(fullNote)}
          onTouchStart={e => {
            e.preventDefault();
            playNote(fullNote);
          }}
          title={fullNote}
        >
          {isC4 && <div className="piano-c4-tooltip">Try C4</div>}
        </div>
      );
      const sharp = HAS_BLACK[note];
      if (sharp) {
        const sharpNote = `${sharp}${oct}`;
        keys.push(
          <div
            key={sharpNote}
            className={`piano-black piano-black-pos-${wi}${litKeys.has(sharpNote) ? ' lit' : ''}`}
            onMouseDown={e => {
              e.stopPropagation();
              playNote(sharpNote);
            }}
            onTouchStart={e => {
              e.preventDefault();
              e.stopPropagation();
              playNote(sharpNote);
            }}
            title={sharpNote}
          />
        );
      }
    });
    return keys;
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="studio-panel">
      {!audioUnlocked && !toneReady && (
        <div className="studio-audio-unlock">
          <button className="studio-audio-unlock-btn" onClick={unlockAudio}>
            ▶ Click to enable audio
          </button>
        </div>
      )}
      {/* Header: transport + BPM + export */}
      <div className="studio-header">
        <span className="studio-logo">⬡ Studio</span>
        <div className="studio-transport">
          <button className="studio-transport-btn" onClick={playing ? stopPlayback : startPlayback}>
            {playing ? '⏹ Stop' : '▶ Play'}
          </button>
          <button
            className={`studio-transport-btn${recording ? ' recording' : ''}`}
            onClick={recording ? stopRecording : () => startRecording()}
          >
            {recording ? '⏹ Stop Rec' : '⏺ Record'}
          </button>
          {recording && (
            <div className="studio-mic-meter">
              <div className="studio-mic-level" style={{ width: `${micLevel * 100}%` }} />
            </div>
          )}
        </div>
        <div className="studio-bpm-row">
          <span className="studio-bpm-label">BPM</span>
          <input
            type="number"
            min={40}
            max={240}
            value={bpm}
            className="studio-bpm-input"
            onChange={e => setBpm(Math.max(40, Math.min(240, parseInt(e.target.value) || 120)))}
          />
          <input
            type="range"
            min={40}
            max={240}
            value={bpm}
            className="studio-bpm-slider"
            onChange={e => setBpm(parseInt(e.target.value))}
          />
        </div>
        <div className="studio-header-actions">
          {status && <span className="studio-status">{status}</span>}
          <label className="studio-btn studio-btn-sm" title="Upload audio file">
            ↑ Audio
            <input
              type="file"
              accept="audio/*"
              style={{ display: 'none' }}
              onChange={handleAudioUpload}
            />
          </label>
          <button
            className="studio-btn studio-btn-sm"
            onClick={exporting ? stopExport : startExport}
          >
            {exporting ? '⏹ Stop Export' : '⬇ Export Mix'}
          </button>
          {exportUrl && (
            <a className="studio-btn studio-btn-success" href={exportUrl} download="based-mix.webm">
              ↓ Download
            </a>
          )}
        </div>
      </div>

      {/* Main body */}
      <div className="studio-body">
        {/* Track list */}
        <div className="studio-tracks">
          <div className="studio-tracks-header">
            <span>Tracks</span>
            <button className="studio-btn studio-btn-sm" onClick={() => addTrack('instrument')}>
              + Instrument
            </button>
            <button className="studio-btn studio-btn-sm" onClick={() => addTrack('vocal')}>
              + Vocal
            </button>
          </div>

          {tracks.length === 0 && (
            <div className="studio-tracks-empty">
              Add a track to start.
              <br />
              <span style={{ opacity: 0.5, fontSize: 10 }}>Piano keys: A S D F G H J K</span>
            </div>
          )}

          {tracks.map(track => (
            <div
              key={track.id}
              className={`studio-track${selTrack === track.id ? ' selected' : ''}`}
              onClick={() => {
                setSelTrack(track.id);
                if (track.type === 'audio' || track.type === 'vocal') setActiveTab('mixer');
              }}
              style={{ borderLeft: `3px solid ${track.color}` }}
            >
              <div className="studio-track-top">
                <input
                  className="studio-track-name"
                  value={track.name}
                  onClick={e => e.stopPropagation()}
                  onChange={e => updateTrack(track.id, { name: e.target.value })}
                />
                <button
                  className="studio-track-del"
                  onClick={e => {
                    e.stopPropagation();
                    removeTrack(track.id);
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="studio-track-controls">
                <button
                  className={`studio-track-btn${track.muted ? ' active' : ''}`}
                  onClick={e => {
                    e.stopPropagation();
                    updateTrack(track.id, { muted: !track.muted });
                  }}
                  title="Mute"
                >
                  M
                </button>
                <button
                  className={`studio-track-btn${track.soloed ? ' active' : ''}`}
                  onClick={e => {
                    e.stopPropagation();
                    updateTrack(track.id, { soloed: !track.soloed });
                  }}
                  title="Solo"
                >
                  S
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={track.volume}
                  className="studio-track-vol"
                  title="Volume"
                  onClick={e => e.stopPropagation()}
                  onChange={e => {
                    e.stopPropagation();
                    updateTrack(track.id, { volume: parseFloat(e.target.value) });
                  }}
                />
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={track.pan}
                  className="studio-track-pan"
                  title="Pan"
                  onClick={e => e.stopPropagation()}
                  onChange={e => {
                    e.stopPropagation();
                    updateTrack(track.id, { pan: parseFloat(e.target.value) });
                  }}
                />
              </div>
              {track.type === 'instrument' && (
                <select
                  className="studio-instrument-sel"
                  value={track.instrument}
                  onClick={e => e.stopPropagation()}
                  onChange={e => {
                    e.stopPropagation();
                    updateTrack(track.id, { instrument: e.target.value });
                  }}
                >
                  {INSTRUMENTS.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </select>
              )}
              {(track.type === 'vocal' || track.type === 'audio') && track.audioUrl && (
                <audio
                  src={track.audioUrl}
                  controls
                  className="studio-track-audio"
                  ref={el => {
                    if (el) audioElRefs.current.set(track.id, el);
                    else audioElRefs.current.delete(track.id);
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Right panel */}
        <div className="studio-editor">
          {/* Panel tabs */}
          <div className="studio-tabs">
            {(['piano', 'drums', 'effects', 'mixer', 'ai'] as const).map(tab => (
              <button
                key={tab}
                className={`studio-tab${activeTab === tab ? ' active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'piano'
                  ? '⬡ Piano'
                  : tab === 'drums'
                    ? '◈ Drums'
                    : tab === 'effects'
                      ? '◉ FX'
                      : tab === 'mixer'
                        ? '⊙ Mixer'
                        : '◈ AI Gen'}
              </button>
            ))}
          </div>

          {/* Piano */}
          {activeTab === 'piano' && (
            <div className="studio-piano-wrap">
              <div className="studio-piano-toolbar">
                <span className="studio-piano-hint">
                  Mouse click or keyboard: A W S E D F T G Y H U J K
                </span>
                <div className="studio-octave-group">
                  <button
                    className="studio-btn studio-btn-sm"
                    onClick={() => setOctave(o => Math.max(1, o - 1))}
                  >
                    Oct –
                  </button>
                  <span className="studio-octave-label">Oct {octave}</span>
                  <button
                    className="studio-btn studio-btn-sm"
                    onClick={() => setOctave(o => Math.min(7, o + 1))}
                  >
                    Oct +
                  </button>
                </div>
              </div>
              <div className="studio-piano">
                <div className="piano-octave">{renderPiano(octave)}</div>
                <div className="piano-octave">{renderPiano(octave + 1)}</div>
              </div>
              {sel?.type === 'instrument' && (
                <div className="studio-piano-inst-row">
                  <span className="studio-piano-inst-label">Instrument:</span>
                  <select
                    className="studio-instrument-sel"
                    value={sel.instrument}
                    onChange={e => updateTrack(sel.id, { instrument: e.target.value })}
                  >
                    {INSTRUMENTS.map(i => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Drum machine */}
          {activeTab === 'drums' && (
            <div className="studio-drums">
              {!tracks.some(t => t.type === 'instrument') && (
                <div className="studio-drums-empty">
                  Add an instrument track first to use the drum sequencer.
                  <button
                    className="studio-btn studio-btn-sm"
                    style={{ marginTop: 8 }}
                    onClick={() => addTrack('instrument')}
                  >
                    + Add Track
                  </button>
                </div>
              )}
              {tracks
                .filter(t => t.type === 'instrument')
                .map(track => (
                  <div key={track.id} className="studio-drum-track">
                    <div className="studio-drum-track-label" style={{ color: track.color }}>
                      {track.name}
                    </div>
                    {DRUM_ROWS.map((row, ri) => (
                      <div key={row.id} className="studio-drum-row">
                        <span className="studio-drum-label">{row.label}</span>
                        <div className="studio-drum-steps">
                          {Array.from({ length: 16 }, (_, si) => (
                            <button
                              key={si}
                              className={`studio-drum-step${track.drumPattern[ri]?.[si] ? ' on' : ''}${currentStep === si && playing ? ' beat' : ''}${si % 4 === 0 ? ' bar' : ''}`}
                              onClick={() => toggleDrumStep(track.id, ri, si)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}

          {/* Effects rack */}
          {activeTab === 'effects' && (
            <div className="studio-effects">
              {!sel ? (
                <div className="studio-drums-empty">Select a track to edit its effects.</div>
              ) : (
                <>
                  <div className="studio-fx-title" style={{ borderColor: sel.color }}>
                    FX — {sel.name}
                  </div>
                  {[
                    { key: 'reverb', label: 'Reverb', min: 0, max: 1, step: 0.01 },
                    { key: 'delay', label: 'Delay', min: 0, max: 1, step: 0.01 },
                    { key: 'distortion', label: 'Distortion', min: 0, max: 1, step: 0.01 },
                    { key: 'pitchShift', label: 'Pitch', min: -12, max: 12, step: 1 },
                  ].map(fx => (
                    <div key={fx.key} className="studio-fx-row">
                      <span className="studio-fx-label">{fx.label}</span>
                      <input
                        type="range"
                        min={fx.min}
                        max={fx.max}
                        step={fx.step}
                        value={sel.effects[fx.key as keyof typeof sel.effects]}
                        className="studio-fx-slider"
                        onChange={e =>
                          updateTrack(sel.id, {
                            effects: { ...sel.effects, [fx.key]: parseFloat(e.target.value) },
                          })
                        }
                      />
                      <span className="studio-fx-value">
                        {fx.key === 'pitchShift'
                          ? `${sel.effects.pitchShift > 0 ? '+' : ''}${sel.effects.pitchShift} st`
                          : `${Math.round(sel.effects[fx.key as keyof typeof sel.effects] * 100)}%`}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* AI Music Generation */}
          {activeTab === 'ai' && (
            <div className="studio-ai-gen">
              {subscriptionTier !== 'pro' ? (
                <div className="studio-ai-gen-locked">
                  <div className="studio-ai-gen-lock-icon">◈</div>
                  <p>AI Music Generation is a Pro feature.</p>
                  <p className="studio-ai-gen-lock-sub">
                    Upgrade to generate full tracks from a description.
                  </p>
                </div>
              ) : (
                <>
                  <textarea
                    className="studio-ai-gen-prompt"
                    placeholder="Lo-fi hip hop for late night coding, 80 BPM, piano and drums..."
                    value={musicPrompt}
                    onChange={e => setMusicPrompt(e.target.value)}
                    rows={3}
                  />
                  <div className="studio-ai-gen-genres">
                    {MUSIC_GENRES.map(g => (
                      <button
                        key={g}
                        className={`studio-genre-chip${musicGenre === g ? ' active' : ''}`}
                        onClick={() => setMusicGenre(musicGenre === g ? '' : g)}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                  <div className="studio-ai-gen-controls">
                    <span className="studio-ai-gen-dur-label">Duration</span>
                    {[15, 30, 45].map(s => (
                      <button
                        key={s}
                        className={`studio-dur-btn${musicDuration === s ? ' active' : ''}`}
                        onClick={() => setMusicDuration(s)}
                      >
                        {s}s
                      </button>
                    ))}
                    <button
                      className="studio-btn studio-btn-primary"
                      onClick={() => generateAiMusic()}
                      disabled={musicGenerating || !musicPrompt.trim()}
                    >
                      {musicGenerating ? '◈ Generating...' : '◈ Generate'}
                    </button>
                    {musicGenerating && (
                      <button
                        className="studio-btn"
                        onClick={() => {
                          musicAbortRef.current?.abort();
                          setMusicGenerating(false);
                        }}
                        title="Cancel generation"
                      >
                        ⏹ Stop
                      </button>
                    )}
                  </div>
                  {musicError && <div className="studio-ai-gen-error">{musicError}</div>}
                  <div className="studio-ai-gen-tracks">
                    {generatedTracks.map((t, i) => (
                      <GeneratedMusicCard key={i} url={t.url} prompt={t.prompt} />
                    ))}
                    {generatedTracks.length === 0 && !musicGenerating && (
                      <div className="studio-ai-gen-empty">
                        Describe a mood, genre, or scene — Based generates the track.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Mixer */}
          {activeTab === 'mixer' && (
            <div className="studio-mixer">
              {tracks.length === 0 && <div className="studio-drums-empty">No tracks yet.</div>}
              {tracks.map(track => (
                <div
                  key={track.id}
                  className={`studio-mixer-channel${selTrack === track.id ? ' selected' : ''}`}
                  onClick={() => setSelTrack(track.id)}
                >
                  <div className="studio-mixer-vol-wrap">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={track.volume}
                      className="studio-mixer-vol"
                      onChange={e => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div className="studio-mixer-fader-label">{Math.round(track.volume * 100)}</div>
                  <div className="studio-mixer-channel-name" style={{ color: track.color }}>
                    {track.name}
                  </div>
                  <button
                    className={`studio-track-btn${track.muted ? ' active' : ''}`}
                    onClick={e => {
                      e.stopPropagation();
                      updateTrack(track.id, { muted: !track.muted });
                    }}
                  >
                    M
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI bar */}
      <div className="studio-ai-bar-wrap">
        {aiHint && (
          <div className="studio-ai-hint" role="status">
            {aiHint}
          </div>
        )}
        <div className="studio-ai-bar">
          <span className="studio-ai-icon">◈</span>
          <input
            className="studio-ai-input"
            placeholder={
              subscriptionTier === 'pro'
                ? `AI: "120 BPM", "rock beat", "hip hop beat" — or describe a track to generate`
                : `AI: "120 BPM", "rock beat", "hip hop beat", "chord progression jazz", "add piano track"`
            }
            value={aiInput}
            onChange={e => setAiInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyAI()}
          />
          <button
            className="studio-btn studio-btn-primary"
            onClick={applyAI}
            disabled={!aiInput.trim()}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

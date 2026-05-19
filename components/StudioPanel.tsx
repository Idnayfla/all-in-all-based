'use client';
import { useRef, useState, useCallback, useEffect, type ReactElement } from 'react';
import GeneratedMusicCard from './GeneratedMusicCard';

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
    instrument: 'piano',
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
  subscriptionTier?: 'free' | 'pro';
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
  const [generatedTracks, setGeneratedTracks] = useState<{ url: string; prompt: string }[]>([]);
  const [octave, setOctave] = useState(4);
  const [litKeys, setLitKeys] = useState<Set<string>>(new Set());
  const [micLevel, setMicLevel] = useState(0);
  const [aiInput, setAiInput] = useState('');
  const [toneReady, setToneReady] = useState(false);
  const [exportUrl, setExportUrl] = useState('');
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState('');

  const tRef = useRef<any>(null); // { Tone, synths, drums, fx }
  const seqRef = useRef<any>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const micRafRef = useRef(0);
  const audioElRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const connectedSourcesRef = useRef<Map<string, MediaElementAudioSourceNode>>(new Map());

  // ── Tone.js lazy init ───────────────────────────────────────────────────
  const initTone = useCallback(async () => {
    if (tRef.current) return tRef.current;
    setStatus('Loading audio engine…');
    const Tone = (await import('tone')) as any;
    await Tone.start();
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
      noise: { type: 'white' as any },
      envelope: { attack: 0.001, decay: 0.15 },
    }).connect(masterGain);
    const hhc = new Tone.MetalSynth({
      frequency: 400,
      envelope: { attack: 0.001, decay: 0.05 },
      resonance: 5000,
      harmonicity: 5.1,
      modulationIndex: 32,
      octaves: 1.5,
    }).connect(masterGain);
    const hhopen = new Tone.MetalSynth({
      frequency: 400,
      envelope: { attack: 0.001, decay: 0.4 },
      resonance: 5000,
      harmonicity: 5.1,
      modulationIndex: 32,
      octaves: 1.5,
    }).connect(masterGain);
    const clap = new Tone.NoiseSynth({
      noise: { type: 'pink' as any },
      envelope: { attack: 0.005, decay: 0.1 },
    }).connect(masterGain);
    const tom1 = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 4 }).connect(masterGain);
    const tom2 = new Tone.MembraneSynth({ pitchDecay: 0.1, octaves: 3 }).connect(masterGain);
    const ride = new Tone.MetalSynth({
      frequency: 250,
      envelope: { attack: 0.001, decay: 0.5 },
      resonance: 3000,
      harmonicity: 5.1,
      modulationIndex: 16,
      octaves: 1.5,
    }).connect(masterGain);

    const synthFx: Record<string, any> = {
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
    setStatus('');
    return obj;
  }, [bpm]);

  const getSynth = (instrument: string) => {
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
    return tRef.current?.synths[map[instrument] ?? 'lead'] ?? null;
  };

  // ── Play a note ─────────────────────────────────────────────────────────
  const playNote = useCallback(
    async (note: string, duration = '8n') => {
      const t = await initTone();
      const track = tracks.find(tr => tr.id === selTrack);
      const instrument = track?.instrument ?? 'piano';
      const synth = getSynth(instrument);
      if (!synth) return;

      synth.volume.value = track?.muted ? -Infinity : t.Tone.gainToDb(track?.volume ?? 0.8);
      const fx = t.synthFx[instrument];
      if (fx && track) {
        fx.reverb.wet.value = track.effects.reverb;
        fx.delay.wet.value = track.effects.delay;
        fx.distortion.wet.value = track.effects.distortion;
        fx.pitchShift.pitch = track.effects.pitchShift;
        fx.pitchShift.wet.value = track.effects.pitchShift !== 0 ? 1 : 0;
        fx.panner.pan.value = track.pan;
      }

      try {
        synth.triggerAttackRelease(note, duration);
      } catch {}
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
    [initTone, selTrack, tracks]
  );

  // ── Transport ───────────────────────────────────────────────────────────
  const startPlayback = async () => {
    const { Tone, drums } = await initTone();
    Tone.Transport.bpm.value = bpm;
    if (seqRef.current) {
      seqRef.current.dispose();
      seqRef.current = null;
    }

    // Collect all drum patterns, respecting solo > mute priority
    const anySoloed = tracks.some(t => t.soloed);
    const drumTracks = tracks.filter(tr => {
      const audible = anySoloed ? tr.soloed : !tr.muted;
      return audible && tr.drumPattern.some(row => row.some(Boolean));
    });

    seqRef.current = new Tone.Sequence(
      (time: number, step: number) => {
        Tone.getDraw().schedule(() => setCurrentStep(step), time);
        drumTracks.forEach(track => {
          track.drumPattern.forEach((row, ri) => {
            if (!row[step]) return;
            const drumId = DRUM_ROWS[ri]?.id;
            const drumMap: Record<string, any> = {
              kick: drums.kick,
              snare: drums.snare,
              hhc: drums.hhc,
              hhopen: drums.hhopen,
              clap: drums.clap,
              tom1: drums.tom1,
              tom2: drums.tom2,
              ride: drums.ride,
            };
            const d = drumMap[drumId];
            if (!d) return;
            try {
              d.volume.value = Tone.gainToDb(track.volume);
              if (drumId === 'kick') d.triggerAttackRelease('C1', '8n', time);
              else if (drumId === 'snare' || drumId === 'clap') d.triggerAttackRelease('8n', time);
              else d.triggerAttackRelease('8n', time);
            } catch {}
          });
        });
      },
      [...Array(16).keys()],
      '16n'
    );

    seqRef.current.start(0);
    Tone.Transport.start();
    setPlaying(true);
  };

  const stopPlayback = () => {
    if (!tRef.current) return;
    tRef.current.Tone.Transport.stop();
    if (seqRef.current) {
      seqRef.current.dispose();
      seqRef.current = null;
    }
    setPlaying(false);
    setCurrentStep(-1);
  };

  const startExport = async () => {
    const { recorder, masterGain, Tone } = await initTone();

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

  // ── Voice recording ─────────────────────────────────────────────────────
  const startRecording = async () => {
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
        setTracks(prev => {
          const idx = prev.filter(t => t.type === 'vocal').length + 1;
          return [...prev, { ...makeTrack('vocal', idx), audioUrl: url }];
        });
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
      alert('Microphone access denied.');
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
      startRecording();
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
  const generateAiMusic = async () => {
    if (!authToken || !musicPrompt.trim()) return;
    setMusicGenerating(true);
    setMusicError('');
    try {
      const fullPrompt = musicGenre ? `${musicGenre}: ${musicPrompt}` : musicPrompt;
      const res = await fetch('/api/music', {
        method: 'POST',
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
    } catch (e: any) {
      setMusicError(e.message);
    } finally {
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

    if (!matched) {
      for (const [name, pattern] of Object.entries(patterns)) {
        if (s.includes(name)) {
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

    if (matched) setAiInput('');
    else
      alert(
        `Try: "120 BPM", "add drum track", "rock beat", "hip hop beat", "house beat", "chord progression jazz"`
      );
  };

  const sel = tracks.find(t => t.id === selTrack);

  // ── Piano keyboard renderer ──────────────────────────────────────────────
  const renderPiano = (oct: number) => {
    const keys: ReactElement[] = [];
    WHITE_NOTES.forEach((note, wi) => {
      const fullNote = `${note}${oct}`;
      keys.push(
        <div
          key={fullNote}
          className={`piano-white${litKeys.has(fullNote) ? ' lit' : ''}`}
          onMouseDown={() => playNote(fullNote)}
          onTouchStart={e => {
            e.preventDefault();
            playNote(fullNote);
          }}
          title={fullNote}
        />
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
      {/* Header: transport + BPM + export */}
      <div className="studio-header">
        <span className="studio-logo">⬡ Studio</span>
        <div className="studio-transport">
          <button className="studio-transport-btn" onClick={playing ? stopPlayback : startPlayback}>
            {playing ? '⏹ Stop' : '▶ Play'}
          </button>
          <button
            className={`studio-transport-btn${recording ? ' recording' : ''}`}
            onClick={recording ? stopRecording : startRecording}
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
                      onClick={generateAiMusic}
                      disabled={musicGenerating || !musicPrompt.trim()}
                    >
                      {musicGenerating ? '◈ Generating...' : '◈ Generate'}
                    </button>
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
      <div className="studio-ai-bar">
        <span className="studio-ai-icon">◈</span>
        <input
          className="studio-ai-input"
          placeholder={`AI: "120 BPM", "rock beat", "hip hop beat", "chord progression jazz", "add piano track"`}
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
  );
}

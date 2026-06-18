'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { captureScreen, isScreenCaptureSupported } from '@/hooks/useScreenCapture';
import type { MicVAD } from '@ricky0123/vad-web';
import PersonalityPanel, { buildPersonalityModifier } from '@/components/PersonalityPanel';
import type { PersonalitySettings } from '@/components/PersonalityPanel';

// Web Speech API types (not in all TS DOM libs)
declare interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: (() => void) | null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
}
declare interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
declare interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

// Pure function — lives outside the component so it is referentially stable
// and never needs to be in a useEffect dependency array.
// Returns the command portion after the wake phrase, or null if no wake phrase found.
// e.g. "Hey based, what time is it?" → "what time is it?"
// e.g. "Hey based" → "" (wake only, await next utterance)
function extractWakeCommand(raw: string): string | null {
  const s = raw
    .toLowerCase()
    .replace(/[,\.!?]/g, '')
    .trim();

  const directPrefixes = [
    // Standard
    'hey based',
    'hey base',
    'hay based',
    'hay base',
    'hey baste',
    'hey bass',
    'hey bays',
    'hey paste',
    'hello based',
    'hello base',
    'hi based',
    'hi base',
    'ok based',
    'okay based',
    'a based',
    'a base',
    // Whisper phonetic mishears of "based" when spoken from a distance or by female voices
    'hey raise',
    'hey rays',
    'hey race',
    'hey bis',
    'hey biz',
    'hey days',
    'hey haze',
    'hey hayes',
    'hey place',
    'hey pace',
    'hey phase',
    'hey blaze',
    'hey blade',
    'hello raise',
    'hello bis',
    'hi raise',
    'hi bis',
    // Standalone — Whisper collapses "hey based" into a single mishear word
    'best',
    'baste',
    'beast',
    'heavens', // mishear of "hey based" as one phoneme stream
    'heaven',
    'heybase',
    'heybased',
  ];
  for (const prefix of directPrefixes) {
    if (s.startsWith(prefix)) return s.slice(prefix.length).trim();
    if (s.includes(prefix)) return ''; // wake phrase mid-sentence, treat as wake-only
  }
  // Broad catch: any attention word + anything phonetically near "bas-" OR known mishears
  const phonetic = 'bas\\w*|raise|rays|race|bis|biz|days|haze|hayes|place|pace|phase|blaze';
  const m =
    s.match(
      new RegExp(`^(?:hey|hay|ok|okay|hi|hello|and|the|in|a)\\s+(?:${phonetic})[,\\s]*(.*)$`, 'i')
    ) ?? s.match(/^bas(?:ed|e)?\s*(.*)$/i);
  if (m) return m[1]?.trim() ?? '';

  // Vocative: "Based" used as a name at the end of the sentence.
  // e.g. "how are you doing Based?" → command is "how are you doing"
  // Exclude "based on" which is a preposition, not a name.
  if (!/\bbased?\s+on\b/i.test(s)) {
    const endVocative = s.match(/^(.+?)\s+bas(?:ed|e)?\s*[?,!.]?\s*$/i);
    if (endVocative?.[1]) return endVocative[1].trim();
  }

  return null; // no wake phrase
}

const COMPANION_WIDTH_KEY = 'based_companion_width';
const WIDTH_MIN = 280;
const WIDTH_MAX = 600;
const WIDTH_DEFAULT = 360;

/**
 * Compresses a screenshot data URL to JPEG at reduced resolution so that
 * the base64 payload stays well under the 20 MB server body limit.
 * Returns the original string unchanged if Canvas is unavailable.
 */
async function compressScreenshot(dataUrl: string): Promise<string> {
  try {
    const MAX_WIDTH = 1280;
    const QUALITY = 0.75;
    return await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width > MAX_WIDTH ? MAX_WIDTH / img.width : 1;
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', QUALITY));
      };
      img.onerror = () => reject(new Error('img load failed'));
      img.src = dataUrl;
    });
  } catch {
    return dataUrl;
  }
}

// Aggressive compression for ambient background frames — smaller payload, lower quality is fine.
async function compressAmbient(dataUrl: string): Promise<string> {
  try {
    const MAX_WIDTH = 640;
    const QUALITY = 0.4;
    return await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width > MAX_WIDTH ? MAX_WIDTH / img.width : 1;
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', QUALITY));
      };
      img.onerror = () => reject(new Error('img load'));
      img.src = dataUrl;
    });
  } catch {
    return dataUrl;
  }
}

declare global {
  interface Window {
    electronAPI?: {
      hideCompanion: () => void;
      showCompanion: () => void;
      hideForCapture: () => void;
      showAfterCapture: () => void;
      captureScreenMain: () => Promise<string | null>;
      setSpeaking: (speaking: boolean, text?: string) => void;
      resizeStart?: () => void;
      setCompanionWidth?: (width: number) => void;
      resizeEnd?: () => void;
      onProactiveTrigger?: (cb: (data: { context: string }) => void) => void;
      // System control
      openUrl?: (url: string) => Promise<string>;
      launchApp?: (appName: string) => Promise<string>;
      typeText?: (text: string, target?: string) => Promise<string>;
      clipboardRead?: () => Promise<string>;
      clipboardWrite?: (text: string) => Promise<string>;
      getVolume?: () => Promise<number>;
      setVolume?: (level: number) => Promise<string>;
      getActiveApp?: () => Promise<string>;
    };
    AndroidBridge?: {
      close: () => void;
      startScreenCapture: () => void;
      stopScreenCapture: () => void;
      shareText: (text: string) => void;
    };
    onScreenFrame?: (base64Jpeg: string) => void;
    onScreenCaptureDenied?: () => void;
    onScreenCaptureStopped?: () => void;
  }
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  captureThumb?: string;
  shareable?: boolean;
  hidden?: boolean;
}

const SCREEN_INTENT =
  /\b(screen|what'?s (on|here)|solve this|answer this|what do you see|help me with this|what is this)\b/i;

function base64ToBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * Pick the best available English voice in priority order:
 *   Google UK English Female → Google US English → Microsoft Zira →
 *   Samantha (macOS) → any en- voice → system default
 */
function buildSpeechChunks(text: string, maxWords = 12): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    const ws = s.trim().split(/\s+/).filter(Boolean);
    if (!ws.length) continue;
    if (ws.length <= maxWords) {
      out.push(s.trim());
      continue;
    }
    for (let i = 0; i < ws.length; i += maxWords) out.push(ws.slice(i, i + maxWords).join(' '));
  }
  return out.filter(Boolean);
}

async function executeSystemAction(sa: Record<string, unknown>): Promise<string | undefined> {
  if (!window.electronAPI) return;
  const action = sa.action as string;
  switch (action) {
    case 'open_url':
      return window.electronAPI.openUrl?.(sa.url as string);
    case 'launch_app':
      return window.electronAPI.launchApp?.(sa.app_name as string);
    case 'type_text':
      return window.electronAPI.typeText?.(sa.text as string, (sa.target as string) || '');
    case 'write_clipboard':
      return window.electronAPI.clipboardWrite?.(sa.text as string);
    case 'set_volume':
      return window.electronAPI.setVolume?.(sa.level as number);
  }
}

export default function CompanionOverlayPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [authReady, setAuthReady] = useState(false);
  // Session-cached memory — fetched once on mount, passed to every /api/companion POST
  const sessionMemoryRef = useRef<string>('');
  const [pendingCapture, setPendingCapture] = useState<{ source: string; thumb: string } | null>(
    null
  );
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [slowWarning, setSlowWarning] = useState(false);
  const [showPersonality, setShowPersonality] = useState(false);
  const [personalityModifier, setPersonalityModifier] = useState('');
  const [isAndroidBridge, setIsAndroidBridge] = useState(false);
  const [androidCapturing, setAndroidCapturing] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceGender, setVoiceGender] = useState<'male' | 'female'>('male');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const slowWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionId = useRef(String(Date.now()).slice(-4));
  const screenSupported = isScreenCaptureSupported();

  const nextResponseIsShareableRef = useRef<boolean>(false);
  const daysSinceFirstRef = useRef<number>(0);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenRef = useRef('');
  const greetingFiredRef = useRef(false);
  const voiceEnabledRef = useRef(voiceEnabled);
  const speakRef = useRef<(text: string) => Promise<void>>(async () => {});
  const authTokenRef = useRef(authToken);

  // Wake word — "Hey Based"
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [vadSensitivity, setVadSensitivity] = useState(() => {
    const stored =
      typeof window !== 'undefined' ? localStorage.getItem('based_vad_sensitivity') : null;
    return stored ? parseFloat(stored) : 0.35;
  });
  // Proximity gate: minimum RMS before audio is sent to STT.
  // Higher = only close/loud speech triggers; lower = hears from farther away.
  const [proximityThreshold, setProximityThreshold] = useState(() => {
    const stored =
      typeof window !== 'undefined' ? localStorage.getItem('based_proximity_threshold') : null;
    return stored ? parseFloat(stored) : 0.015;
  });
  const proximityThresholdRef = useRef(
    typeof window !== 'undefined'
      ? parseFloat(localStorage.getItem('based_proximity_threshold') ?? '0.015')
      : 0.015
  );
  const vadRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [vadSensitivityDebounced, setVadSensitivityDebounced] = useState(vadSensitivity);
  const [vadRestartTick, setVadRestartTick] = useState(0);
  const [wakeState, setWakeState] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [wakeListening, setWakeListening] = useState(false); // mic actually capturing
  const [wakeError, setWakeError] = useState<string | null>(null);
  const [wakeDebug, setWakeDebug] = useState<string | null>(null);
  const [wakeStatus, setWakeStatus] = useState<string | null>(null); // VAD lifecycle status
  const wakeStateRef = useRef<'idle' | 'listening' | 'processing'>('idle');
  const wakeWordEnabledRef = useRef(false);
  const isGeneratingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const wakeRecogRef = useRef<SpeechRecognition | null>(null);
  const restartWakeRef = useRef<(() => void) | null>(null);
  const sendFnRef = useRef<(voiceText?: string) => Promise<void>>(async () => {});
  const sendProactiveFnRef = useRef<(context: string) => Promise<void>>(async () => {});
  const ambientFrameRef = useRef<string | null>(null);
  const enterListenModeRef = useRef<(() => void) | null>(null);
  const wantsAutoListenRef = useRef(false);
  const stopSpeakingRef = useRef<(() => void) | null>(null);
  // Tracks when TTS last stopped playing — VAD ignores audio for 1.5 s after this
  // to suppress mic pickup of speaker output (Android echo loop fix).
  const ttsEndedAtRef = useRef<number>(0);

  const [panelWidth, setPanelWidth] = useState<number>(WIDTH_DEFAULT);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mood/state tracking — signals sent to the API to adapt tone
  const sessionStartAtRef = useRef<number>(Date.now());
  const lastBasedReplyAtRef = useRef<number>(0);
  const recentMsgLengthsRef = useRef<number[]>([]);
  const shortStreakRef = useRef<number>(0);
  const isResizingRef = useRef(false);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);
  useEffect(() => {
    proximityThresholdRef.current = proximityThreshold;
  }, [proximityThreshold]);

  const speak = async (text: string) => {
    if (!voiceEnabled) return;
    if (text === lastSpokenRef.current) return;
    lastSpokenRef.current = text;
    // Cancel any in-progress speech
    window.speechSynthesis?.cancel();
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    // Do NOT call setSpeaking(true) yet — wait until we have audio actually playing
    // so the bubble never shows and immediately clears on a fast ElevenLabs failure.
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authTokenRef.current ? { Authorization: `Bearer ${authTokenRef.current}` } : {}),
        },
        body: JSON.stringify({ text, gender: voiceGender }),
      });
      if (!res.ok) throw new Error('tts failed');

      const {
        audioBase64,
        words = [],
        mime = 'audio/mpeg',
      } = (await res.json()) as {
        audioBase64: string;
        words?: { word: string; startTime: number }[];
        mime?: string;
      };

      const audioBlob = base64ToBlob(audioBase64, mime);
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      audio.onplay = () => {
        setIsSpeaking(true);
        stopSpeakingRef.current = () => {
          audio.pause();
          ttsEndedAtRef.current = Date.now();
          lastSpokenRef.current = '';
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          window.electronAPI?.setSpeaking(false, '');
          URL.revokeObjectURL(url);
          currentAudioRef.current = null;
          stopSpeakingRef.current = null;
        };
        if (words.length > 0) {
          // Build sentence chunks, anchor each to its first word's ElevenLabs timestamp
          const chunks = buildSpeechChunks(text);
          let wordCursor = 0;
          const timed = chunks.map(chunk => {
            const anchor = words[Math.min(wordCursor, words.length - 1)];
            const delay = Math.round(anchor.startTime * 1000);
            wordCursor += chunk.split(/\s+/).filter(Boolean).length;
            return { t: chunk, d: delay };
          });
          window.electronAPI?.setSpeaking(true, '__timed:' + JSON.stringify(timed));
        } else {
          window.electronAPI?.setSpeaking(true, text);
        }
      };
      audio.onended = () => {
        ttsEndedAtRef.current = Date.now();
        stopSpeakingRef.current = null;
        lastSpokenRef.current = '';
        setIsSpeaking(false);
        window.electronAPI?.setSpeaking(false, '');
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        // Auto-enter listen mode if Based just asked a question (voice path)
        if (wantsAutoListenRef.current) {
          wantsAutoListenRef.current = false;
          setTimeout(() => enterListenModeRef.current?.(), 400);
        }
      };
      audio.onerror = () => {
        ttsEndedAtRef.current = Date.now();
        stopSpeakingRef.current = null;
        lastSpokenRef.current = '';
        setIsSpeaking(false);
        window.electronAPI?.setSpeaking(false, '');
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
      };
      await audio.play();
    } catch (err) {
      console.error('[tts error]', err);
      // Silent fail — no robotic fallback voice
      lastSpokenRef.current = '';
    }
  };

  // Keep speakRef in sync so sendGreeting can call the latest speak without
  // being listed as a dependency (which would cause perpetual re-renders).
  useEffect(() => {
    speakRef.current = speak;
  }, [speak]);

  useEffect(() => {
    wakeWordEnabledRef.current = wakeWordEnabled;
  }, [wakeWordEnabled]);
  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  // Wake word — "Hey Based" using Silero VAD (@ricky0123/vad-web) + Groq Whisper
  // Silero VAD isolates real speech segments, eliminating hallucinations from silence.
  // No accounts, no rate limits, zero cost at any scale.
  useEffect(() => {
    if (!wakeWordEnabled) {
      wakeStateRef.current = 'idle';
      setWakeState('idle');
      setWakeListening(false);
      setWakeError(null);
      setWakeDebug(null);
      return;
    }

    let stopped = false;
    let vad: MicVAD | null = null;
    let vadStarted = false;
    let micStream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let awaitingCommand = false;
    let cmdTimeout: ReturnType<typeof setTimeout> | null = null;
    // Audio buffered while a wake-word STT call is in-flight. If the user speaks
    // their command immediately after "Hey Based" (before STT returns), we capture
    // it here and process it the moment the wake phrase is confirmed.
    let pendingCommandAudio: Float32Array | null = null;
    let wakeSTTInFlight = false;
    let conversationWindowUntil = 0;
    const CONVERSATION_WINDOW_MS = 20000;
    let vadAutoRestartTimer: ReturnType<typeof setTimeout> | null = null;

    const CMD_TIMEOUT_MS = 8000;

    // RMS energy of a Float32Array (samples in -1..1 range).
    // VAD at 16 kHz: ambient noise is typically <0.015, real speech >0.02.
    const audioRMS = (audio: Float32Array): number => {
      let sum = 0;
      for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i];
      return Math.sqrt(sum / audio.length);
    };

    const transcribeAudio = async (audio: Float32Array, lenient = false): Promise<string> => {
      // Gate 1: minimum duration — segments under 0.4 s (6 400 samples at 16 kHz)
      // are almost always noise bursts or mic clicks, never real speech.
      if (audio.length < 6400) return '';

      // Gate 2: RMS energy — ambient noise (fan, AC, keyboard) sits below 0.015.
      // Real speech, even from across the room, clears 0.02. Skipping STT here
      // prevents Deepgram/Whisper from hallucinating "Hello Based" on silence.
      // In lenient mode (awaitingCommand, barge-in): skip energy gate — user is
      // intentionally speaking, we just need to avoid responding to true silence.
      if (
        audioRMS(audio) <
        (lenient
          ? Math.max(0.004, proximityThresholdRef.current * 0.4)
          : Math.max(0.012, proximityThresholdRef.current))
      )
        return '';

      try {
        const { utils } = await import('@ricky0123/vad-web');
        const wavBuf = utils.encodeWAV(audio);
        const blob = new Blob([wavBuf], { type: 'audio/wav' });
        const form = new FormData();
        form.append('audio', blob, 'audio.wav');
        const res = await fetch('/api/stt', {
          method: 'POST',
          body: form,
          ...(authTokenRef.current
            ? { headers: { Authorization: `Bearer ${authTokenRef.current}` } }
            : {}),
        });
        if (!res.ok) return '';
        const data = (await res.json()) as { transcript?: string };
        return data.transcript ?? '';
      } catch {
        return '';
      }
    };

    const start = async () => {
      try {
        console.log('[based/vad] importing @ricky0123/vad-web...');
        const { MicVAD } = await import('@ricky0123/vad-web');
        console.log('[based/vad] MicVAD imported, calling MicVAD.new()...');

        // Request mic with WebRTC noise processing enabled.
        // Silero VAD already handles speech/silence — these constraints clean the
        // raw audio before it reaches the model (steady-state noise, echo, gain).
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              noiseSuppression: true,
              echoCancellation: true,
              autoGainControl: true,
              channelCount: 1,
            },
          });
        } catch {
          // Fall through — MicVAD will open its own stream without constraints.
        }

        // Run mic through RNNoise neural noise suppression before Silero VAD
        if (micStream && !stopped) {
          try {
            audioCtx = new AudioContext({ sampleRate: 48000 });
            await audioCtx.audioWorklet.addModule('/rnnoise-processor.js', {
              type: 'module',
            } as WorkletOptions);
            const source = audioCtx.createMediaStreamSource(micStream);
            const rnnoiseNode = new AudioWorkletNode(audioCtx, 'rnnoise-processor');
            const dest = audioCtx.createMediaStreamDestination();
            await new Promise<void>((resolve, reject) => {
              const t = setTimeout(() => resolve(), 3000);
              rnnoiseNode.port.onmessage = (e: MessageEvent) => {
                if (e.data?.type === 'ready') {
                  clearTimeout(t);
                  resolve();
                } else if (e.data?.type === 'error') {
                  clearTimeout(t);
                  reject(new Error(e.data.message as string));
                }
              };
            });
            source.connect(rnnoiseNode);
            rnnoiseNode.connect(dest);
            micStream = dest.stream;
          } catch {
            // RNNoise unavailable — continue with WebRTC NS stream
            await audioCtx?.close().catch(() => {});
            audioCtx = null;
          }
        }

        if (stopped) {
          micStream?.getTracks().forEach(t => t.stop());
          return;
        }

        vad = await MicVAD.new({
          model: 'v5',
          baseAssetPath: '/vad/',
          onnxWASMBasePath: '/vad/',
          startOnLoad: false,
          ...(micStream ? { stream: micStream } : {}),
          // Far-field tuning: lower positive threshold so distant speech scores
          // high enough to trigger, while keeping the hysteresis band (positive minus
          // negative) at ~0.20 — wide enough to avoid rapid speech/silence toggling.
          positiveSpeechThreshold: vadSensitivityDebounced,
          negativeSpeechThreshold: Math.max(0.05, vadSensitivityDebounced - 0.2),
          // 600 ms redemption: bridges natural brief pauses mid-phrase without
          // splitting one utterance into two separate VAD segments.
          redemptionMs: 600,
          // Modest pre-pad: captures onset consonants without adding noticeable latency.
          preSpeechPadMs: 150,
          ortConfig: ort => {
            ort.env.logLevel = 'error';
          },

          onSpeechStart: () => {
            if (stopped) return;
            if (awaitingCommand) setWakeDebug('◉ Listening...');
            else setWakeDebug('· …');
          },

          onSpeechEnd: async (audio: Float32Array) => {
            if (stopped) return;
            if (wakeStateRef.current === 'processing') return;

            // Echo suppression: on Android/mobile the mic picks up speaker audio, creating a
            // runaway loop where Based's TTS triggers itself indefinitely. Ignore any audio
            // detected within 1.5 s of TTS stopping — this window covers room reverberation.
            if (Date.now() - ttsEndedAtRef.current < 1500) return;

            if (isSpeakingRef.current) {
              // Barge-in: intentional user interruption while Based is speaking.
              // Disabled on mobile (no Electron) — speakers play straight into the mic
              // and WebRTC echo cancellation alone is not sufficient to prevent echo loops.
              if (!window.electronAPI) return;
              // Also skip if a prior request is still in flight.
              if (isGeneratingRef.current) return;
              stopSpeakingRef.current?.();
              wantsAutoListenRef.current = false;
              const raw = await transcribeAudio(audio, true);
              if (!raw.trim()) return;
              setWakeDebug(`· "${raw}"`);
              wakeStateRef.current = 'processing';
              setWakeState('processing');
              conversationWindowUntil = Date.now() + CONVERSATION_WINDOW_MS;
              await sendFnRef.current(raw);
              return;
            }

            if (awaitingCommand) {
              // Command utterance after a bare "Hey Based"
              awaitingCommand = false;
              if (cmdTimeout) {
                clearTimeout(cmdTimeout);
                cmdTimeout = null;
              }
              wakeStateRef.current = 'processing';
              setWakeState('processing');
              setWakeDebug('· processing...');
              const raw = await transcribeAudio(audio, true); // lenient — user is replying
              if (!raw.trim()) {
                // Didn't catch it — silently re-enter listen mode for another attempt
                awaitingCommand = true;
                wakeStateRef.current = 'listening';
                setWakeState('listening');
                setWakeDebug('◉ Go ahead...');
                cmdTimeout = setTimeout(() => {
                  if (stopped) return;
                  awaitingCommand = false;
                  cmdTimeout = null;
                  wakeStateRef.current = 'idle';
                  setWakeState('idle');
                  setWakeDebug(null);
                }, CMD_TIMEOUT_MS);
                return;
              }
              setWakeDebug(`heard: "${raw}"`);
              conversationWindowUntil = Date.now() + CONVERSATION_WINDOW_MS;
              await sendFnRef.current(raw);
              return;
            }

            // If a wake-word STT is already running, buffer this audio — the user
            // likely spoke their command before the first STT returned.
            if (wakeSTTInFlight) {
              pendingCommandAudio = audio;
              return;
            }

            wakeSTTInFlight = true;
            setWakeDebug('· heard speech');
            const raw = await transcribeAudio(audio);
            wakeSTTInFlight = false;

            if (stopped || !raw.trim()) {
              setWakeDebug('· stt empty');
              pendingCommandAudio = null;
              return;
            }
            setWakeDebug(`· "${raw}"`);

            const command = extractWakeCommand(raw);
            if (command === null) {
              // Inside an active conversation window: treat this as a continuation command
              // without requiring the wake phrase again. This handles long speech split by VAD
              // and natural follow-up turns.
              if (Date.now() < conversationWindowUntil && !isGeneratingRef.current) {
                // Require 3+ words — single/double-word noise transcriptions ("hi",
                // "thanks", "yeah okay") should not fire as continuation commands.
                const wordCount = raw.trim().split(/\s+/).filter(Boolean).length;
                if (wordCount >= 3) {
                  conversationWindowUntil = Date.now() + CONVERSATION_WINDOW_MS; // extend
                  window.electronAPI?.showCompanion?.();
                  wakeStateRef.current = 'processing';
                  setWakeState('processing');
                  setWakeDebug(`· "${raw}"`);
                  await sendFnRef.current(raw);
                }
              }
              pendingCommandAudio = null;
              return;
            }

            window.electronAPI?.showCompanion?.();

            if (command.trim()) {
              // Inline command: "Hey Based, what time is it?"
              wakeStateRef.current = 'processing';
              setWakeState('processing');
              setWakeDebug(`heard: "${command}"`);
              conversationWindowUntil = Date.now() + CONVERSATION_WINDOW_MS;
              await sendFnRef.current(command);
            } else if (pendingCommandAudio) {
              // Wake-only, but audio was buffered during STT — process it immediately
              const buffered = pendingCommandAudio;
              pendingCommandAudio = null;
              wakeStateRef.current = 'processing';
              setWakeState('processing');
              setWakeDebug('· processing...');
              const cmdRaw = await transcribeAudio(buffered);
              if (cmdRaw.trim()) {
                setWakeDebug(`heard: "${cmdRaw}"`);
                conversationWindowUntil = Date.now() + CONVERSATION_WINDOW_MS;
                await sendFnRef.current(cmdRaw);
              } else {
                // Buffered audio was silence — fall back to await mode
                awaitingCommand = true;
                wakeStateRef.current = 'listening';
                setWakeState('listening');
                setWakeDebug('◉ Go ahead...');
                cmdTimeout = setTimeout(() => {
                  if (stopped) return;
                  awaitingCommand = false;
                  cmdTimeout = null;
                  wakeStateRef.current = 'idle';
                  setWakeState('idle');
                  setWakeDebug(null);
                }, CMD_TIMEOUT_MS);
              }
            } else {
              // Wake-only, nothing buffered — wait for next utterance.
              // Low-energy audio that matched a wake phrase is likely an
              // ambient noise hallucination — skip rather than entering
              // listen mode on nothing.
              if (audioRMS(audio) < 0.025) {
                pendingCommandAudio = null;
                return;
              }
              awaitingCommand = true;
              wakeStateRef.current = 'listening';
              setWakeState('listening');
              setWakeDebug('◉ Go ahead...');
              cmdTimeout = setTimeout(() => {
                if (stopped) return;
                awaitingCommand = false;
                cmdTimeout = null;
                wakeStateRef.current = 'idle';
                setWakeState('idle');
                setWakeDebug(null);
              }, CMD_TIMEOUT_MS);
            }
          },

          onVADMisfire: () => {
            /* too short — ignore */
          },
        });

        if (stopped) {
          void vad.destroy().catch(() => {});
          return;
        }
        console.log('[based/vad] MicVAD.new() done, calling vad.start()...');
        await vad.start();
        vadStarted = true;
        console.log('[based/vad] vad.start() done — listening');
        setWakeListening(true);
        setWakeError(null);

        // Auto-restart every 45 min to clear ONNX memory drift and false-positive buildup
        vadAutoRestartTimer = setTimeout(() => {
          if (!stopped) setVadRestartTick(t => t + 1);
        }, 45 * 60 * 1000);

        restartWakeRef.current = () => {
          if (stopped) return;
          awaitingCommand = false;
          if (cmdTimeout) {
            clearTimeout(cmdTimeout);
            cmdTimeout = null;
          }
          wakeStateRef.current = 'idle';
          setWakeState('idle');
        };
        enterListenModeRef.current = () => {
          if (stopped || !wakeWordEnabledRef.current) return;
          if (cmdTimeout) {
            clearTimeout(cmdTimeout);
            cmdTimeout = null;
          }
          awaitingCommand = true;
          wakeStateRef.current = 'listening';
          setWakeState('listening');
          setWakeDebug('◉ Go ahead...');
          cmdTimeout = setTimeout(() => {
            if (stopped) return;
            awaitingCommand = false;
            cmdTimeout = null;
            wakeStateRef.current = 'idle';
            setWakeState('idle');
            setWakeDebug(null);
          }, CMD_TIMEOUT_MS);
        };
      } catch (err) {
        console.error('[based/vad] FAILED:', err);
        const msg = err instanceof Error ? err.message : String(err);
        const isDenied = /permission|denied|NotAllowed/i.test(msg);
        setWakeError(isDenied ? 'Mic permission denied' : 'Wake word failed to start');
        setWakeListening(false);
      }
    };

    void start();

    return () => {
      stopped = true;
      if (cmdTimeout) clearTimeout(cmdTimeout);
      if (vadAutoRestartTimer) clearTimeout(vadAutoRestartTimer);
      if (vad && vadStarted) void vad.destroy().catch(() => {});
      audioCtx?.close().catch(() => {});
      micStream?.getTracks().forEach(t => t.stop());
      setWakeListening(false);
      setWakeState('idle');
      wakeStateRef.current = 'idle';
    };
  }, [wakeWordEnabled, vadSensitivityDebounced, vadRestartTick]);

  useEffect(() => {
    const stored = localStorage.getItem('based_companion_voice');
    if (stored === 'true') setVoiceEnabled(true);
    const storedGender = localStorage.getItem('based_companion_voice_gender');
    if (storedGender === 'female') setVoiceGender('female');
    const storedWake = localStorage.getItem('based_companion_wake');
    if (storedWake === 'true') setWakeWordEnabled(true);
    // On open: real generation warmup loads the F5-TTS model onto GPU (fires once).
    // Every 4 min: lightweight health ping keeps the container alive without burning GPU credits.
    if (stored === 'true') {
      void fetch('/api/tts/warmup', { method: 'POST' }).catch(() => {});
      const keepalive = setInterval(
        () => void fetch('/api/tts/keepalive', { method: 'POST' }).catch(() => {}),
        4 * 60 * 1000
      );
      return () => clearInterval(keepalive);
    }
  }, []);

  useEffect(() => {
    // Race getSession() against a 3 s timeout. In Android WebView (and Electron)
    // the Supabase network round-trip to validate a stored token can hang
    // indefinitely. If it does, fall back to reading the access_token directly
    // from the Supabase localStorage entry so the UI never stays stuck on
    // "Connecting...".
    const SESSION_TIMEOUT_MS = 3000;
    const timeoutRace = new Promise<{ data: { session: { access_token: string } | null } }>(
      resolve => {
        setTimeout(() => {
          try {
            // Supabase stores its session as JSON in localStorage under the
            // key matching the pattern sb-<project-ref>-auth-token.
            const entry = Object.keys(localStorage).find(k => k.endsWith('-auth-token'));
            if (entry) {
              const parsed = JSON.parse(localStorage.getItem(entry) ?? '{}') as {
                access_token?: string;
              };
              if (parsed.access_token) {
                resolve({ data: { session: { access_token: parsed.access_token } } });
                return;
              }
            }
          } catch {
            // ignore parse errors
          }
          resolve({ data: { session: null } });
        }, SESSION_TIMEOUT_MS);
      }
    );

    Promise.race([supabase.auth.getSession(), timeoutRace]).then(({ data: { session } }) => {
      const token = session?.access_token ?? '';
      setAuthToken(token);
      setAuthReady(true);

      // Fetch memory once at session start and cache it for the whole session.
      // Companion API reads it from user_settings — skip if not signed in.
      if (token) {
        void fetch('/api/memory', {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(r => (r.ok ? (r.json() as Promise<{ memory?: string }>) : null))
          .then(data => {
            if (data?.memory) sessionMemoryRef.current = data.memory;
          })
          .catch(() => {});
      }
    });
    textareaRef.current?.focus();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setMessages([]);
        setAuthToken('');
      } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        setAuthToken(session.access_token);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Android bridge detection + frame/event handlers
  useEffect(() => {
    // Primary detection: bridge is injected before page load via addJavascriptInterface.
    // Fallback: onPageFinished in CompanionActivity dispatches 'androidBridgeReady' and
    // sets window.__androidBridge so we catch it even if the useEffect ran before the
    // bridge was fully available (e.g. after a redirect through /beta-gate).
    if (window.AndroidBridge ?? (window as unknown as Record<string, unknown>).__androidBridge) {
      setIsAndroidBridge(true);
    }
    const onBridgeReady = () => setIsAndroidBridge(true);
    document.addEventListener('androidBridgeReady', onBridgeReady);

    window.onScreenFrame = (base64Jpeg: string) => {
      const dataUrl = `data:image/jpeg;base64,${base64Jpeg}`;
      setPendingCapture({ source: dataUrl, thumb: dataUrl });
    };

    window.onScreenCaptureDenied = () => {
      setAndroidCapturing(false);
      flashError('Screen permission denied');
    };

    window.onScreenCaptureStopped = () => {
      setAndroidCapturing(false);
      setPendingCapture(null);
    };

    return () => {
      document.removeEventListener('androidBridgeReady', onBridgeReady);
      delete window.onScreenFrame;
      delete window.onScreenCaptureDenied;
      delete window.onScreenCaptureStopped;
    };
  }, []);

  // Clear any pending timers when the overlay unmounts
  useEffect(() => {
    return () => {
      if (slowWarningTimerRef.current) clearTimeout(slowWarningTimerRef.current);
      if (hardResetTimerRef.current) clearTimeout(hardResetTimerRef.current);
    };
  }, []);

  // Restore persisted width on mount (desktop only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(COMPANION_WIDTH_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= WIDTH_MIN && parsed <= WIDTH_MAX) {
          setPanelWidth(parsed);
          window.electronAPI?.resizeStart?.();
          window.electronAPI?.setCompanionWidth?.(parsed);
        }
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      // Skip on Android bridge; allow on Electron (narrow window) and desktop browsers
      if (isAndroidBridge) return;
      e.preventDefault();
      isResizingRef.current = true;

      const handle = e.currentTarget as HTMLElement;
      handle.setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';

      const startScreenX = e.screenX;
      const startWidth = panelWidth;
      // Capture right edge in main process ONCE before any resize fires.
      window.electronAPI?.resizeStart?.();

      let finalWidth = startWidth;

      const onMove = (mv: PointerEvent) => {
        if (!isResizingRef.current) return;
        // Dragging left widens, dragging right narrows. screenX is absolute so
        // it stays correct even if the BrowserWindow position shifts mid-drag.
        finalWidth = Math.round(
          Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, startWidth - (mv.screenX - startScreenX)))
        );
        // Update CSS and IPC on every move frame so the window tracks the drag live.
        // setBounds in main.js is atomic, so no mid-drag position drift.
        setPanelWidth(finalWidth);
        window.electronAPI?.setCompanionWidth?.(finalWidth);
      };

      const onUp = () => {
        isResizingRef.current = false;
        document.body.style.userSelect = '';
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        // Reset the right-edge anchor in main process so next drag starts fresh.
        window.electronAPI?.resizeEnd?.();
        try {
          localStorage.setItem(COMPANION_WIDTH_KEY, String(finalWidth));
        } catch {
          // ignore storage errors
        }
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    },
    [isAndroidBridge, panelWidth]
  );

  // Restore messages from localStorage on mount (survives WebView recreation)
  useEffect(() => {
    try {
      const stored = localStorage.getItem('based_companion_messages');
      if (stored) {
        const parsed = JSON.parse(stored) as Msg[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch {
      // ignore parse errors — start fresh
    }
  }, []);

  // Persist messages to localStorage on every change
  useEffect(() => {
    try {
      if (messages.length === 0) {
        localStorage.removeItem('based_companion_messages');
      } else {
        // Only persist completed messages (skip the live-streaming empty assistant bubble)
        const toSave = messages.filter(m => m.content?.trim());
        localStorage.setItem('based_companion_messages', JSON.stringify(toSave));
      }
    } catch {
      // ignore storage errors (e.g. quota exceeded)
    }
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const close = () => {
    setIsClosing(true);
    setTimeout(() => {
      if (window.electronAPI) {
        window.electronAPI.hideCompanion();
      } else {
        window.close();
      }
      setIsClosing(false);
    }, 260);
  };

  const flashError = (msg: string) => {
    setCaptureError(msg);
    setTimeout(() => setCaptureError(null), 2500);
  };

  const handleScreen = async () => {
    if (window.AndroidBridge) {
      if (androidCapturing) {
        window.AndroidBridge.stopScreenCapture();
        setAndroidCapturing(false);
        setPendingCapture(null);
      } else {
        setAndroidCapturing(true);
        window.AndroidBridge.startScreenCapture();
      }
      return;
    }
    window.electronAPI?.hideForCapture();
    // 300 ms lets the Windows DWM compositor repaint before desktopCapturer
    // grabs a fresh snapshot in the main process.  The old getDisplayMedia path
    // used a buffered video stream which could contain frames from before hide.
    await new Promise<void>(resolve => setTimeout(resolve, 300));
    // Fix B: wrap captureScreenMain in a 5s timeout so a stalled IPC call
    // cannot freeze the UI indefinitely.
    const dataUrl = window.electronAPI?.captureScreenMain
      ? await Promise.race([
          window.electronAPI.captureScreenMain(),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
        ])
      : await captureScreen();
    window.electronAPI?.showAfterCapture();
    if (!dataUrl) {
      flashError('Screen share cancelled');
      return;
    }
    setPendingCapture({ source: dataUrl, thumb: dataUrl });
  };

  const sendGreeting = useCallback(async () => {
    if (greetingFiredRef.current) return;

    const token = authToken;
    if (!token) return;

    const triggerMsg: Msg = { role: 'user', content: '.', hidden: true };
    setMessages([triggerMsg, { role: 'assistant', content: '' }]);
    setIsGenerating(true);
    setSlowWarning(false);

    slowWarningTimerRef.current = setTimeout(() => setSlowWarning(true), 15000);
    hardResetTimerRef.current = setTimeout(() => {
      setIsGenerating(false);
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && !last.content?.trim()) {
          next[next.length - 1] = { ...last, content: '✕ Request timed out. Please try again.' };
        }
        return next;
      });
    }, 45000);

    const abortController = new AbortController();
    const fetchTimeoutId = setTimeout(() => abortController.abort(), 30000);

    try {
      const res = await fetch('/api/companion', {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: '.' }],
          ...(sessionMemoryRef.current ? { memory: sessionMemoryRef.current } : {}),
          ...(ambientFrameRef.current ? { ambientFrame: ambientFrameRef.current } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: '' };
          return next;
        });
        return;
      }

      nextResponseIsShareableRef.current = res.headers.get('X-Based-Shareable') === '1';
      const daysHeader = res.headers.get('X-Based-Days');
      if (daysHeader !== null) daysSinceFirstRef.current = parseInt(daysHeader, 10) || 0;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamDone = false;
      let streamError: string | null = null;
      let assembledText = '';

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') {
            streamDone = true;
            break;
          }
          try {
            const parsed = JSON.parse(raw) as { text?: string; error?: string };
            if (parsed.error) {
              streamError = parsed.error;
            } else if (parsed.text) {
              assembledText += parsed.text;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: next[next.length - 1].content + parsed.text,
                };
                return next;
              });
            }
          } catch {
            /* skip */
          }
        }
      }

      if (nextResponseIsShareableRef.current && !streamError) {
        nextResponseIsShareableRef.current = false;
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant' && last.content?.trim()) {
            next[next.length - 1] = { ...last, shareable: true };
          }
          return next;
        });
      }

      if (voiceEnabledRef.current && !streamError && assembledText.trim()) {
        void speakRef.current(assembledText);
      }

      if (streamError) {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: '' };
          return next;
        });
      }
    } catch {
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], content: '' };
        return next;
      });
    } finally {
      clearTimeout(fetchTimeoutId);
      if (slowWarningTimerRef.current) {
        clearTimeout(slowWarningTimerRef.current);
        slowWarningTimerRef.current = null;
      }
      if (hardResetTimerRef.current) {
        clearTimeout(hardResetTimerRef.current);
        hardResetTimerRef.current = null;
      }
      setSlowWarning(false);
      setIsGenerating(false);
    }
  }, [authToken]); // voiceEnabled and speak accessed via refs to avoid re-render churn

  useEffect(() => {
    if (!authReady || !authToken) return;
    if (greetingFiredRef.current) return;
    greetingFiredRef.current = true;
    // Small delay so the UI has rendered before Based starts streaming
    const t = setTimeout(() => void sendGreeting(), 800);
    return () => clearTimeout(t);
  }, [authReady, authToken]); // sendGreeting intentionally omitted — ref guards single-fire

  const send = async (voiceText?: string) => {
    const text = (voiceText !== undefined ? voiceText : input).trim();
    if (!text || isGenerating) return;

    let cap = pendingCapture;

    // Auto-capture screen when message implies screen intent and no capture is already attached.
    // Skip on Android — MediaProjection requires an explicit user gesture, not a silent trigger.
    if (!cap && SCREEN_INTENT.test(text) && !window.AndroidBridge) {
      try {
        window.electronAPI?.hideForCapture();
        // 300 ms settle — same reasoning as handleScreen above
        await new Promise<void>(resolve => setTimeout(resolve, 300));
        // Fix B: 5s timeout so a stalled IPC call doesn't block send() forever
        const dataUrl = window.electronAPI?.captureScreenMain
          ? await Promise.race([
              window.electronAPI.captureScreenMain(),
              new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
            ])
          : await captureScreen();
        window.electronAPI?.showAfterCapture();
        if (dataUrl) cap = { source: dataUrl, thumb: dataUrl };
      } catch {
        // Capture failure is non-fatal — proceed without screenshot
        window.electronAPI?.showAfterCapture();
      }
    }

    const userMsg: Msg = { role: 'user', content: text, captureThumb: cap?.thumb };

    setInput('');
    setPendingCapture(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const history = [...messages, userMsg];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setIsGenerating(true);
    setSlowWarning(false);

    // Fix F: slow warning visible after 15 s
    slowWarningTimerRef.current = setTimeout(() => setSlowWarning(true), 15000);

    // Fix E: hard-reset safety net — if isGenerating is still true after 45 s,
    // force it false so the UI never stays permanently locked.
    hardResetTimerRef.current = setTimeout(() => {
      setIsGenerating(false);
      setSlowWarning(false);
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && !last.content?.trim()) {
          next[next.length - 1] = { ...last, content: '✕ Request timed out. Please try again.' };
        }
        return next;
      });
    }, 45000);

    // Fix C: AbortController so the fetch + stream are cancelled after 30 s
    const abortController = new AbortController();
    const fetchTimeoutId = setTimeout(() => abortController.abort(), 30000);

    try {
      // Mood signals — inferred from response latency, message length, session length
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
      recentMsgLengthsRef.current = [...recentMsgLengthsRef.current.slice(-4), wordCount];
      if (wordCount <= 3) shortStreakRef.current += 1;
      else shortStreakRef.current = 0;
      const moodSignals = {
        latencyMs:
          lastBasedReplyAtRef.current > 0 ? Date.now() - lastBasedReplyAtRef.current : undefined,
        avgLength:
          recentMsgLengthsRef.current.length > 0
            ? Math.round(
                recentMsgLengthsRef.current.reduce((a, b) => a + b, 0) /
                  recentMsgLengthsRef.current.length
              )
            : undefined,
        sessionMinutes: Math.round((Date.now() - sessionStartAtRef.current) / 60000),
        shortStreak: shortStreakRef.current,
      };

      // Electron context — pre-fetch clipboard / active app if the message implies they're needed
      const electronContext: { clipboard?: string; activeApp?: string } = {};
      if (window.electronAPI) {
        if (/\bclipboard\b/i.test(text) && window.electronAPI.clipboardRead) {
          try {
            electronContext.clipboard = await window.electronAPI.clipboardRead();
          } catch {
            /* silent */
          }
        }
        if (
          /\b(active\s+app|what\s+(am\s+i|app)\s+(using|on)|current\s+app)\b/i.test(text) &&
          window.electronAPI.getActiveApp
        ) {
          try {
            electronContext.activeApp = await window.electronAPI.getActiveApp();
          } catch {
            /* silent */
          }
        }
      }

      // Use the token fetched at mount (authToken state). Calling getSession()
      // here again can trigger a network round-trip to Supabase to refresh an
      // expired token, which times out in Electron. The server validates the
      // token and returns 401 if expired, which we handle below.
      const token = authToken;

      if (!token) {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: '✕ Not signed in. Please open Based and sign in first.',
          };
          return next;
        });
        return;
      }

      // Compress screenshot before sending to stay under the server body limit
      const screenshotPayload = cap ? await compressScreenshot(cap.source) : undefined;

      // Fix C: pass the abort signal so a 30 s stall aborts the request
      const res = await fetch('/api/companion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: history
            .filter(m => m.content?.trim())
            .slice(-20)
            .map(m => ({ role: m.role, content: m.content })),
          ...(screenshotPayload ? { screenshot: screenshotPayload } : {}),
          // Pass session-cached memory so Based has user context on every turn
          ...(sessionMemoryRef.current ? { memory: sessionMemoryRef.current } : {}),
          // Ambient frame — silent background context, skipped when user attached a screenshot
          ...(!screenshotPayload && ambientFrameRef.current
            ? { ambientFrame: ambientFrameRef.current }
            : {}),
          moodSignals,
          ...(Object.keys(electronContext).length > 0 ? { electronContext } : {}),
          ...(personalityModifier ? { personalityModifier } : {}),
        }),
        signal: abortController.signal,
      });

      if (res.status === 429) {
        let limitMsg = '⬡ Daily limit reached. Upgrade to Pro for unlimited access → getbased.dev';
        try {
          const data = (await res.json()) as { error?: string; limit?: number };
          if (data.error === 'free_limit_reached') {
            limitMsg = `⬡ You’ve used your ${data.limit ?? 5} free companion messages today. Upgrade to Pro for unlimited access → getbased.dev`;
          }
        } catch {}
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: limitMsg };
          return next;
        });
        return;
      }

      if (!res.ok || !res.body) {
        if (res.status === 401) throw new Error('session-expired');
        throw new Error('failed');
      }

      // Read shareable/days headers before the stream body is consumed
      nextResponseIsShareableRef.current = res.headers.get('X-Based-Shareable') === '1';
      const daysHeader = res.headers.get('X-Based-Days');
      if (daysHeader !== null) daysSinceFirstRef.current = parseInt(daysHeader, 10) || 0;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamDone = false;
      let streamError: string | null = null;
      let assembledText = '';

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') {
            streamDone = true;
            break;
          }
          try {
            const parsed = JSON.parse(raw) as {
              text?: string;
              error?: string;
              system_actions?: Array<Record<string, unknown>>;
            };
            if (parsed.error) {
              // Server signalled a stream failure — record it and let [DONE] close the loop
              streamError = parsed.error;
            } else if (parsed.system_actions) {
              // Execute system control actions on the Electron side
              for (const sa of parsed.system_actions) {
                executeSystemAction(sa).then(res => {
                  if (res?.startsWith('error:')) {
                    setMessages(prev => {
                      const msgs = [...prev];
                      const last = msgs[msgs.length - 1];
                      if (last)
                        msgs[msgs.length - 1] = { ...last, content: `${last.content}\n[${res}]` };
                      return msgs;
                    });
                  }
                });
              }
            } else if (parsed.text) {
              assembledText += parsed.text;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: next[next.length - 1].content + parsed.text,
                };
                return next;
              });
            }
          } catch {
            // malformed SSE chunk — skip
          }
        }
      }
      // Mark the completed message as shareable if the server flagged it
      if (nextResponseIsShareableRef.current && !streamError) {
        nextResponseIsShareableRef.current = false;
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant' && last.content?.trim()) {
            next[next.length - 1] = { ...last, shareable: true };
          }
          return next;
        });
      }

      // Track when Based last replied — used for mood latency inference
      if (!streamError && assembledText.trim()) lastBasedReplyAtRef.current = Date.now();

      // Speak the completed assistant response when voice is enabled and no error occurred.
      // Call speak() directly with the locally assembled text — never inside a setMessages()
      // updater, which is a pure function and must not trigger async side effects.
      if (voiceEnabled && !streamError && assembledText.trim()) {
        void speak(assembledText);
      }

      // If Based ended with a question and wake word is on, auto-listen for reply
      if (
        wakeWordEnabledRef.current &&
        !streamError &&
        /\?\s*["']?\s*$/.test(assembledText.trim())
      ) {
        wantsAutoListenRef.current = true;
      }

      // Only show an error message if the server explicitly sent an error event.
      // Show the actual error text when it's short and meaningful so failures
      // are debuggable; fall back to a generic message for long/technical strings.
      if (streamError) {
        const errorDisplay = streamError.toLowerCase().includes('unauthorized')
          ? '✕ Session expired — sign in again in Based.'
          : streamError.length <= 80
            ? `✕ ${streamError}`
            : '✕ Failed to connect.';
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: errorDisplay };
          return next;
        });
      }
    } catch (err) {
      const isExpired = err instanceof Error && err.message === 'session-expired';
      const isAborted = err instanceof Error && err.name === 'AbortError';
      const isTimeout = err instanceof Error && err.message === 'timeout';
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = {
          ...next[next.length - 1],
          content: isExpired
            ? '✕ Session expired. Please sign in again in Based.'
            : isAborted || isTimeout
              ? '✕ Connection timed out. Check your internet.'
              : '✕ Failed to connect.',
        };
        return next;
      });
    } finally {
      clearTimeout(fetchTimeoutId);
      if (slowWarningTimerRef.current) {
        clearTimeout(slowWarningTimerRef.current);
        slowWarningTimerRef.current = null;
      }
      if (hardResetTimerRef.current) {
        clearTimeout(hardResetTimerRef.current);
        hardResetTimerRef.current = null;
      }
      setSlowWarning(false);
      setIsGenerating(false);
      // Restart passive listener after a voice-triggered command finishes
      if (wakeStateRef.current === 'processing' && wakeWordEnabledRef.current) {
        wakeStateRef.current = 'idle';
        setWakeState('idle');
        setTimeout(() => restartWakeRef.current?.(), 600);
      }
      // No-voice path: if TTS is off, enter listen mode directly after a pause
      if (wantsAutoListenRef.current && !voiceEnabledRef.current) {
        wantsAutoListenRef.current = false;
        setTimeout(() => enterListenModeRef.current?.(), 600);
      }
    }
  };

  // Keep sendFnRef pointing to the latest send so the wake word handler can
  // call it from an event callback without a stale closure.
  useEffect(() => {
    sendFnRef.current = send;
  });

  // Proactive send — Based initiates the conversation from an Electron IPC trigger.
  // Modelled after sendGreeting but passes proactive: context to the API so the
  // companion receives a PROACTIVE INITIATION instruction instead of the normal
  // onboarding / daily briefing arc.
  const sendProactive = async (context: string) => {
    const token = authToken;
    if (!token || isGeneratingRef.current) return;

    const triggerMsg: Msg = { role: 'user', content: '.', hidden: true };
    setMessages([triggerMsg, { role: 'assistant', content: '' }]);
    setIsGenerating(true);
    setSlowWarning(false);

    slowWarningTimerRef.current = setTimeout(() => setSlowWarning(true), 15000);
    hardResetTimerRef.current = setTimeout(() => {
      setIsGenerating(false);
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && !last.content?.trim()) {
          next[next.length - 1] = { ...last, content: '✕ Request timed out.' };
        }
        return next;
      });
    }, 45000);

    const abortController = new AbortController();
    const fetchTimeoutId = setTimeout(() => abortController.abort(), 30000);

    try {
      const res = await fetch('/api/companion', {
        method: 'POST',
        signal: abortController.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: '.' }],
          proactive: context,
          ...(sessionMemoryRef.current ? { memory: sessionMemoryRef.current } : {}),
          ...(ambientFrameRef.current ? { ambientFrame: ambientFrameRef.current } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: '' };
          return next;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamDone = false;
      let assembledText = '';

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') {
            streamDone = true;
            break;
          }
          try {
            const parsed = JSON.parse(raw) as { text?: string };
            if (parsed.text) {
              assembledText += parsed.text;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], content: assembledText };
                return next;
              });
            }
          } catch {
            /* ignore malformed chunks */
          }
        }
      }
    } catch {
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && !last.content?.trim()) {
          next[next.length - 1] = { ...last, content: '' };
        }
        return next;
      });
    } finally {
      clearTimeout(fetchTimeoutId);
      if (slowWarningTimerRef.current) clearTimeout(slowWarningTimerRef.current);
      if (hardResetTimerRef.current) clearTimeout(hardResetTimerRef.current);
      setIsGenerating(false);
      setSlowWarning(false);
      if (wakeStateRef.current === 'processing' && wakeWordEnabledRef.current) {
        wakeStateRef.current = 'idle';
        setWakeState('idle');
        setTimeout(() => restartWakeRef.current?.(), 600);
      }
    }
  };

  useEffect(() => {
    sendProactiveFnRef.current = sendProactive;
  });

  // Register the Electron proactive-trigger IPC listener once at mount.
  // Uses refs so the closure is never stale.
  useEffect(() => {
    if (!window.electronAPI?.onProactiveTrigger) return;
    window.electronAPI.onProactiveTrigger(({ context }) => {
      if (isGeneratingRef.current) return;
      window.electronAPI?.showCompanion?.();
      void sendProactiveFnRef.current(context);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ambient vision loop — capture screen every 45s in Electron.
  // Uses aggressive compression (640px, 40% JPEG) to keep payload small.
  // Frame is silently attached to every API call as background context.
  useEffect(() => {
    if (!window.electronAPI?.captureScreenMain) return;
    const capture = async () => {
      try {
        const dataUrl = await window.electronAPI!.captureScreenMain();
        if (dataUrl) ambientFrameRef.current = await compressAmbient(dataUrl);
      } catch {
        // silent — never block the companion
      }
    };
    const initial = setTimeout(capture, 10000); // first capture 10s after mount
    const interval = setInterval(capture, 45000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleShare = (content: string, msgIdx: number) => {
    const sentences = content.split(/(?<=[.!?])\s+/);
    const excerpt = sentences.slice(0, 2).join(' ');
    const days = daysSinceFirstRef.current;
    const shareText = `Based's read on me:\n\n"${excerpt}"\n\n— Based has known me for ${days} day${days === 1 ? '' : 's'}\ngetbased.dev`;

    // Android: use bridge
    if (window.AndroidBridge?.shareText) {
      window.AndroidBridge.shareText(shareText);
      return;
    }
    // Web fallback: Web Share API
    if (navigator.share) {
      navigator.share({ text: shareText }).catch(() => {});
      return;
    }
    // Final fallback: clipboard
    void navigator.clipboard?.writeText(shareText).then(() => {
      setCopiedIdx(msgIdx);
      setTimeout(() => setCopiedIdx(prev => (prev === msgIdx ? null : prev)), 2000);
    });
  };

  // Electron companion window is narrow (<768px) but still desktop — use electronAPI as the
  // true desktop signal rather than innerWidth to avoid incorrectly treating it as mobile.
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
  const isMobile = typeof window !== 'undefined' && !isElectron && window.innerWidth < 768;
  const panelStyle =
    !isAndroidBridge && !isMobile ? ({ width: panelWidth } as React.CSSProperties) : undefined;

  return (
    <div
      ref={containerRef}
      className={`companion-overlay-root${isClosing ? ' companion-overlay--closing' : ''}`}
      style={panelStyle}
    >
      <div
        className="companion-resize-handle"
        onPointerDown={startResize}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      />
      <div className="companion-overlay-header">
        <img
          src="/brand-icon-loop.svg"
          className="companion-logo"
          alt="Based"
          width={24}
          height={24}
        />
        <span className="companion-title">BASED</span>
        <span className="companion-session">#{sessionId.current}</span>
        {isSpeaking && (
          <span className="companion-speaking-indicator" title="Based is speaking">
            ◉
          </span>
        )}
        <button
          className="companion-clear"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => setShowPersonality(p => !p)}
          title="Personality settings"
        >
          ◈
        </button>
        <button
          className="companion-clear"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => setMessages([])}
          disabled={isGenerating}
          title="Clear history"
        >
          ↺
        </button>
        <button
          className="companion-close"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={close}
          title="Close"
        >
          ✕
        </button>
      </div>
      {showPersonality && (
        <div className="companion-personality-panel">
          <PersonalityPanel
            onPersonalityChange={(modifier, _settings) => setPersonalityModifier(modifier)}
          />
        </div>
      )}

      <div className="companion-messages">
        {!authReady && <div className="companion-auth-notice">◈ Connecting…</div>}
        {authReady && !authToken && (
          <div className="companion-auth-notice">
            ◈ Sign in to Based first, then open the companion.
          </div>
        )}
        {messages.filter(m => !m.hidden).length === 0 && !isGenerating && (
          <div className="companion-overlay-empty">
            <span style={{ fontSize: '2rem' }}>⬡</span>
            <p>i&apos;m here.</p>
            <p>tell me what you&apos;re building.</p>
          </div>
        )}
        {messages.map((msg, i) =>
          msg.hidden ? null : (
            <div key={i}>
              {msg.captureThumb && (
                <div className="companion-capture-card">
                  <div className="companion-capture-label">◉ Screen captured</div>
                  <img className="companion-capture-thumb" src={msg.captureThumb} alt="capture" />
                  <div className="companion-scan-line" />
                </div>
              )}
              <div className={`companion-bubble companion-bubble--${msg.role}`}>
                <span>{msg.content}</span>
                {msg.role === 'assistant' && isGenerating && i === messages.length - 1 && (
                  <span className="companion-cursor" />
                )}
              </div>
              {/* Share chip -- shown for shareable reads once streaming is complete */}
              {msg.role === 'assistant' &&
                msg.shareable &&
                !(isGenerating && i === messages.length - 1) && (
                  <button
                    className="companion-share-chip"
                    onClick={() => handleShare(msg.content, i)}
                  >
                    {copiedIdx === i ? '◈ Copied!' : '◈ Share this read'}
                  </button>
                )}
              {/* Fix F: slow warning shown after 15 s */}
              {msg.role === 'assistant' &&
                isGenerating &&
                i === messages.length - 1 &&
                slowWarning && (
                  <div className="slow-warning">◈ Taking longer than usual — still working...</div>
                )}
            </div>
          )
        )}
        <div ref={bottomRef} />
      </div>

      <div className="companion-input-area">
        <div className="companion-capture-row">
          {(screenSupported || isAndroidBridge) && (
            <button
              className={`companion-capture-btn${pendingCapture || androidCapturing ? ' active' : ''}`}
              onClick={handleScreen}
              disabled={isGenerating}
              title={androidCapturing ? 'Stop screen sharing' : 'Share your screen with Based'}
            >
              {androidCapturing ? '◉ Watching' : '◉ Screen'}
            </button>
          )}
          <button
            className={`companion-capture-btn companion-voice-btn${voiceEnabled ? ' active' : ''}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              localStorage.setItem('based_companion_voice', String(next));
              if (!next) {
                window.speechSynthesis?.cancel();
                if (currentAudioRef.current) {
                  currentAudioRef.current.pause();
                  currentAudioRef.current = null;
                }
                setIsSpeaking(false);
                window.electronAPI?.setSpeaking(false);
              }
            }}
            title={voiceEnabled ? 'Voice on — click to mute' : 'Voice off — click to enable'}
          >
            {voiceEnabled ? '◉ Voice' : '⊙ Voice'}
          </button>
          {voiceEnabled && (
            <button
              className="companion-capture-btn"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => {
                const next: 'male' | 'female' = voiceGender === 'male' ? 'female' : 'male';
                setVoiceGender(next);
                localStorage.setItem('based_companion_voice_gender', next);
              }}
              title={`Voice: ${voiceGender} — click to switch`}
            >
              {voiceGender === 'male' ? '⬡ Male' : '⬡ Female'}
            </button>
          )}
          <button
            className={`companion-capture-btn${wakeWordEnabled ? ' active' : ''}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => {
              const next = !wakeWordEnabled;
              setWakeWordEnabled(next);
              localStorage.setItem('based_companion_wake', String(next));
            }}
            title={
              wakeWordEnabled ? 'Hey Based active — click to disable' : 'Enable Hey Based wake word'
            }
          >
            {wakeWordEnabled && wakeListening ? '◉ Hey Based' : '⊙ Hey Based'}
          </button>
          {(captureError || wakeError) && (
            <span className="companion-capture-error">{captureError ?? wakeError}</span>
          )}
        </div>

        {wakeWordEnabled && (
          <div className="companion-vad-slider">
            <span>sensitive</span>
            <input
              type="range"
              min={0.2}
              max={0.6}
              step={0.05}
              value={vadSensitivity}
              onChange={e => {
                const v = parseFloat(e.target.value);
                setVadSensitivity(v);
                localStorage.setItem('based_vad_sensitivity', String(v));
                if (vadRestartTimerRef.current) clearTimeout(vadRestartTimerRef.current);
                vadRestartTimerRef.current = setTimeout(() => setVadSensitivityDebounced(v), 800);
              }}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title={`Mic sensitivity: ${Math.round((1 - (vadSensitivity - 0.2) / 0.4) * 100)}%`}
            />
            <span>strict</span>
          </div>
        )}

        {wakeWordEnabled && (
          <div className="companion-vad-slider">
            <span>far</span>
            <input
              type="range"
              min={0.002}
              max={0.08}
              step={0.002}
              value={proximityThreshold}
              onChange={e => {
                const v = parseFloat(e.target.value);
                setProximityThreshold(v);
                localStorage.setItem('based_proximity_threshold', String(v));
              }}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title={`Proximity: ${Math.round((proximityThreshold / 0.08) * 100)}% (higher = close voice only)`}
            />
            <span>close</span>
          </div>
        )}

        {wakeWordEnabled && wakeState !== 'idle' && (
          <div className="companion-wake-indicator">
            <span className="companion-wake-pulse" />
            {wakeState === 'listening' ? 'Listening for your command...' : 'Processing...'}
          </div>
        )}
        {wakeWordEnabled && wakeDebug && (
          <div style={{ fontSize: '10px', opacity: 0.5, padding: '2px 8px' }}>
            heard: {wakeDebug}
          </div>
        )}

        {pendingCapture && (
          <div className="companion-pending-badge">
            ◉ Screen captured
            <button className="companion-pending-clear" onClick={() => setPendingCapture(null)}>
              ✕
            </button>
          </div>
        )}

        <div className="companion-input-row">
          <textarea
            ref={textareaRef}
            className="companion-textarea"
            value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask Based anything..."
            rows={1}
            disabled={isGenerating}
          />
          <button
            className="companion-send"
            onClick={() => void send()}
            disabled={isGenerating || !input.trim()}
          >
            {isGenerating ? <span className="spinner" /> : '▶'}
          </button>
        </div>
      </div>
    </div>
  );
}

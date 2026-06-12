'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { captureScreen, isScreenCaptureSupported } from '@/hooks/useScreenCapture';

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
function isWakePhrase(raw: string): boolean {
  const s = raw.toLowerCase().replace(/[,\.!?]/g, '').trim();
  const direct = [
    'hey based', 'hey base', 'hay based', 'hay base',
    'hey baste', 'hey bass', 'hey bays', 'hey paste',
    'a based', 'a base', 'ok based', 'hi based',
  ];
  if (direct.some(w => s.includes(w))) return true;
  // (hey|hay|ok|hi) followed by anything starting with "bas"
  if (/\b(hey|hay|ok|hi)\s+bas\w*/i.test(s)) return true;
  return false;
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

declare global {
  interface Window {
    electronAPI?: {
      hideCompanion: () => void;
      hideForCapture: () => void;
      showAfterCapture: () => void;
      captureScreenMain: () => Promise<string | null>;
      setSpeaking: (speaking: boolean, text?: string) => void;
      resizeStart?: () => void;
      setCompanionWidth?: (width: number) => void;
      resizeEnd?: () => void;
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
  const [wakeState, setWakeState] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [wakeListening, setWakeListening] = useState(false); // mic actually capturing
  const [wakeError, setWakeError] = useState<string | null>(null);
  const wakeStateRef = useRef<'idle' | 'listening' | 'processing'>('idle');
  const wakeWordEnabledRef = useRef(false);
  const isGeneratingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const wakeRecogRef = useRef<SpeechRecognition | null>(null);
  const restartWakeRef = useRef<(() => void) | null>(null);
  const sendFnRef = useRef<(voiceText?: string) => Promise<void>>(async () => {});

  const [panelWidth, setPanelWidth] = useState<number>(WIDTH_DEFAULT);
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

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
        lastSpokenRef.current = '';
        setIsSpeaking(false);
        window.electronAPI?.setSpeaking(false, '');
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
      };
      audio.onerror = () => {
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

  useEffect(() => { wakeWordEnabledRef.current = wakeWordEnabled; }, [wakeWordEnabled]);
  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);

  // Wake word — "Hey Based" using Web Speech API (Chrome/Electron/Android Chrome)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SRClass =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition;

    if (!SRClass || !wakeWordEnabled) {
      wakeRecogRef.current?.stop();
      wakeRecogRef.current = null;
      wakeStateRef.current = 'idle';
      setWakeState('idle');
      setWakeListening(false);
      setWakeError(null);
      return;
    }

    setWakeError(null);
    let lastStartAt = 0;
    let consecutiveNetworkErrors = 0;
    let startWake: () => void;
    let startCommand: () => void;

    startCommand = () => {
      const recog = new SRClass();
      recog.continuous = false;
      recog.interimResults = false;
      recog.lang = 'en-US';

      let handled = false;
      const timeout = setTimeout(() => {
        if (!handled) { handled = true; recog.stop(); }
      }, 8000);

      recog.onresult = (e: SpeechRecognitionEvent) => {
        handled = true;
        clearTimeout(timeout);
        const transcript = e.results[0]?.[0]?.transcript?.trim() ?? '';
        if (transcript) {
          wakeStateRef.current = 'processing';
          setWakeState('processing');
          void sendFnRef.current(transcript);
        } else {
          wakeStateRef.current = 'idle';
          setWakeState('idle');
          if (wakeWordEnabledRef.current) startWake();
        }
      };

      recog.onend = () => {
        clearTimeout(timeout);
        if (!handled || wakeStateRef.current === 'listening') {
          wakeStateRef.current = 'idle';
          setWakeState('idle');
          if (wakeWordEnabledRef.current) startWake();
        }
      };

      recog.onerror = () => {
        clearTimeout(timeout);
        handled = true;
        wakeStateRef.current = 'idle';
        setWakeState('idle');
        if (wakeWordEnabledRef.current) setTimeout(startWake, 200);
      };

      try { recog.start(); } catch { /* ignore duplicate-start */ }
    };

    startWake = () => {
      if (!wakeWordEnabledRef.current) return;
      if (wakeStateRef.current !== 'idle') return;
      // Throttle: 500ms floor prevents tight restart loops when the speech API
      // errors immediately (common in Electron where Google speech is unreliable)
      const now = Date.now();
      if (now - lastStartAt < 500) return;
      lastStartAt = now;

      const recog = new SRClass();
      recog.continuous = true;
      recog.interimResults = true;
      recog.lang = 'en-US';

      // Track whether this session hit a network-class error so onend can
      // back off longer instead of restarting at 150ms (which would loop).
      let networkError = false;

      recog.onstart = () => {
        setWakeListening(true);
        consecutiveNetworkErrors = 0; // mic is live — reset failure counter
      };

      recog.onresult = (e: SpeechRecognitionEvent) => {
        if (isSpeakingRef.current || isGeneratingRef.current) return;
        if (wakeStateRef.current !== 'idle') return;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (isWakePhrase(t)) {
            wakeStateRef.current = 'listening';
            setWakeState('listening');
            recog.stop();
            startCommand();
            return;
          }
        }
      };

      recog.onend = () => {
        if (!wakeWordEnabledRef.current) {
          setWakeListening(false);
        } else if (wakeStateRef.current === 'idle') {
          // Network errors (common in Electron) need a long backoff so we don't
          // hammer Google's speech servers and flood the Chromium error log.
          setTimeout(startWake, networkError ? 5000 : 150);
        }
        // wakeState === 'listening' | 'processing': keep wakeListening true — no flicker.
      };

      recog.onerror = (e: SpeechRecognitionErrorEvent) => {
        if (e.error === 'not-allowed') {
          setWakeListening(false);
          setWakeError('Mic denied — allow microphone in browser settings');
          return;
        }
        if (e.error === 'network' || e.error === 'service-not-allowed') {
          networkError = true; // onend will use 5s backoff instead of 150ms
          consecutiveNetworkErrors++;
          if (consecutiveNetworkErrors >= 3) {
            // Speech service consistently unreachable (common in Electron).
            // Stop the retry loop — user can re-enable the toggle to try again.
            wakeWordEnabledRef.current = false;
            setWakeWordEnabled(false);
            setWakeListening(false);
            setWakeError('Speech recognition unavailable — Hey Based works best in Chrome or on mobile');
          }
        }
        // 'aborted', 'no-speech', 'audio-capture': transient.
        // onend fires next and handles the restart — don't touch wakeListening.
      };

      try {
        recog.start();
      } catch {
        // InvalidStateError: already started — will onend → restart naturally
      }
      wakeRecogRef.current = recog;
    };

    restartWakeRef.current = startWake;
    startWake();

    return () => {
      wakeRecogRef.current?.stop();
      wakeRecogRef.current = null;
      // Cleanup or disable — clear the visual state
      setWakeListening(false);
      setWakeState('idle');
    };
  }, [wakeWordEnabled]);

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
            .map(m => ({ role: m.role, content: m.content })),
          ...(screenshotPayload ? { screenshot: screenshotPayload } : {}),
          // Pass session-cached memory so Based has user context on every turn
          ...(sessionMemoryRef.current ? { memory: sessionMemoryRef.current } : {}),
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
            const parsed = JSON.parse(raw) as { text?: string; error?: string };
            if (parsed.error) {
              // Server signalled a stream failure — record it and let [DONE] close the loop
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

      // Speak the completed assistant response when voice is enabled and no error occurred.
      // Call speak() directly with the locally assembled text — never inside a setMessages()
      // updater, which is a pure function and must not trigger async side effects.
      if (voiceEnabled && !streamError && assembledText.trim()) {
        void speak(assembledText);
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
    }
  };

  // Keep sendFnRef pointing to the latest send so the wake word handler can
  // call it from an event callback without a stale closure.
  useEffect(() => {
    sendFnRef.current = send;
  });

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
              setWakeError(null);
              localStorage.setItem('based_companion_wake', String(next));
            }}
            title={
              wakeWordEnabled
                ? wakeListening
                  ? 'Mic active — say "Hey Based"'
                  : wakeError
                    ? wakeError
                    : 'Starting mic...'
                : 'Enable wake word — say "Hey Based" to activate'
            }
          >
            {wakeWordEnabled
              ? wakeState === 'listening'
                ? '◉ Listening...'
                : wakeState === 'processing'
                  ? '◈ Processing...'
                  : wakeListening
                    ? '◉ Hey Based'
                    : '⊙ Hey Based'
              : '⊙ Hey Based'}
          </button>
          {(captureError || wakeError) && (
            <span className="companion-capture-error">{captureError ?? wakeError}</span>
          )}
        </div>

        {wakeWordEnabled && wakeState !== 'idle' && (
          <div className="companion-wake-indicator">
            <span className="companion-wake-pulse" />
            {wakeState === 'listening' ? 'Listening for your command...' : 'Processing...'}
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

'use client';

import { useRef, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { captureScreen, isScreenCaptureSupported } from '@/hooks/useScreenCapture';

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
    };
    AndroidBridge?: {
      close: () => void;
      startScreenCapture: () => void;
      stopScreenCapture: () => void;
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

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenRef = useRef('');

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
        headers: { 'Content-Type': 'application/json' },
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

  useEffect(() => {
    const stored = localStorage.getItem('based_companion_voice');
    if (stored === 'true') setVoiceEnabled(true);
    const storedGender = localStorage.getItem('based_companion_voice_gender');
    if (storedGender === 'female') setVoiceGender('female');
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
      setAuthToken(session?.access_token ?? '');
      setAuthReady(true);
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

  const send = async () => {
    const text = input.trim();
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
        }),
        signal: abortController.signal,
      });

      if (res.status === 429) {
        let limitMsg = '⬡ Daily limit reached. Upgrade to Pro for unlimited access → getbased.dev';
        try {
          const data = (await res.json()) as { error?: string; limit?: number };
          if (data.error === 'free_limit_reached') {
            limitMsg = `⬡ You've used your ${data.limit ?? 5} free companion messages today. Upgrade to Pro for unlimited access → getbased.dev`;
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

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamDone = false;
      let streamError: string | null = null;

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
      // Speak the completed assistant response when voice is enabled and no error occurred.
      if (voiceEnabled && !streamError) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.content?.trim()) {
            speak(last.content);
          }
          return prev;
        });
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
    }
  };

  return (
    <div className={`companion-overlay-root${isClosing ? ' companion-overlay--closing' : ''}`}>
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
        {messages.length === 0 && (
          <div className="companion-overlay-empty">
            <span style={{ fontSize: '2rem' }}>⬡</span>
            <p>i&apos;m here.</p>
            <p>tell me what you&apos;re building.</p>
          </div>
        )}
        {messages.map((msg, i) => (
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
            {/* Fix F: slow warning shown after 15 s */}
            {msg.role === 'assistant' &&
              isGenerating &&
              i === messages.length - 1 &&
              slowWarning && (
                <div className="slow-warning">◈ Taking longer than usual — still working...</div>
              )}
          </div>
        ))}
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
          {captureError && <span className="companion-capture-error">{captureError}</span>}
        </div>

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

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
      /** Captures the screen in the main process; returns a data-URL or null. */
      captureScreenMain: () => Promise<string | null>;
    };
  }
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  captureThumb?: string;
}

const SCREEN_INTENT =
  /\b(screen|what'?s (on|here)|solve this|answer this|what do you see|help me with this|what is this)\b/i;

function speak(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  window.speechSynthesis.speak(utterance);
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
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const slowWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionId = useRef(String(Date.now()).slice(-4));
  const screenSupported = isScreenCaptureSupported();

  useEffect(() => {
    const stored = localStorage.getItem('based_companion_voice');
    if (stored === 'true') setVoiceEnabled(true);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
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

  // Clear any pending timers when the overlay unmounts
  useEffect(() => {
    return () => {
      if (slowWarningTimerRef.current) clearTimeout(slowWarningTimerRef.current);
      if (hardResetTimerRef.current) clearTimeout(hardResetTimerRef.current);
    };
  }, []);

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

    // Auto-capture screen when message implies screen intent and no capture is already attached
    if (!cap && SCREEN_INTENT.test(text)) {
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
          {screenSupported && (
            <button
              className={`companion-capture-btn${pendingCapture ? ' active' : ''}`}
              onClick={handleScreen}
              disabled={isGenerating}
              title="Share your screen with Based"
            >
              ◉ Screen
            </button>
          )}
          <button
            className={`companion-capture-btn companion-voice-btn${voiceEnabled ? ' active' : ''}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              localStorage.setItem('based_companion_voice', String(next));
              if (!next) window.speechSynthesis?.cancel();
            }}
            title={voiceEnabled ? 'Voice on — click to mute' : 'Voice off — click to enable'}
          >
            {voiceEnabled ? '◉ Voice' : '⊙ Voice'}
          </button>
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

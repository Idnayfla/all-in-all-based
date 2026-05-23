'use client';

import { useRef, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { captureScreen, isScreenCaptureSupported } from '@/hooks/useScreenCapture';

/** Races a promise against a timeout; rejects with Error('timeout') if ms elapses first. */
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);

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
  const slowWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionId = useRef(String(Date.now()).slice(-4));
  const screenSupported = isScreenCaptureSupported();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthToken(session?.access_token ?? '');
      setAuthReady(true);
    });
    textareaRef.current?.focus();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        setMessages([]);
        setAuthToken('');
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
      // Fix A: wrap supabase auth calls in a 5 s timeout.
      // Without this, getUser() can stall forever on a network blip while
      // isGenerating=true, silently dropping every follow-up message.
      await withTimeout(supabase.auth.getUser(), 5000);
      const {
        data: { session: freshSession },
      } = (await withTimeout(supabase.auth.getSession(), 5000)) as Awaited<
        ReturnType<typeof supabase.auth.getSession>
      >;
      const token = freshSession?.access_token ?? authToken;

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
          ...(cap ? { screenshot: cap.source } : {}),
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
            const { text: chunk } = JSON.parse(raw);
            if (chunk)
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: next[next.length - 1].content + chunk,
                };
                return next;
              });
          } catch {
            // malformed SSE chunk — skip
          }
        }
      }
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && !last.content?.trim()) {
          next[next.length - 1] = { ...last, content: '✕ Failed to connect.' };
        }
        return next;
      });
    } catch (err) {
      const isExpired = err instanceof Error && err.message === 'session-expired';
      const isAborted = err instanceof Error && err.name === 'AbortError';
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = {
          ...next[next.length - 1],
          content: isExpired
            ? '✕ Session expired. Please sign in again in Based.'
            : isAborted
              ? '✕ Request timed out. Please try again.'
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
        <span className="companion-logo">⬡</span>
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

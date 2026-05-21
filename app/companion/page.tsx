'use client';

import { useRef, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { captureScreen, isScreenCaptureSupported } from '@/hooks/useScreenCapture';

declare global {
  interface Window {
    electronAPI?: { hideCompanion: () => void };
  }
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  captureThumb?: string;
}

export default function CompanionOverlayPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [pendingCapture, setPendingCapture] = useState<{ source: string; thumb: string } | null>(
    null
  );
  const [captureError, setCaptureError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionId = useRef(String(Date.now()).slice(-4));
  const screenSupported = isScreenCaptureSupported();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthToken(session?.access_token ?? '');
    });
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const close = () => {
    if (window.electronAPI) {
      window.electronAPI.hideCompanion();
    } else {
      window.close();
    }
  };

  const flashError = (msg: string) => {
    setCaptureError(msg);
    setTimeout(() => setCaptureError(null), 2500);
  };

  const handleScreen = async () => {
    const dataUrl = await captureScreen();
    if (!dataUrl) {
      flashError('Screen share cancelled');
      return;
    }
    setPendingCapture({ source: dataUrl, thumb: dataUrl });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || isGenerating) return;

    const cap = pendingCapture;
    const userMsg: Msg = { role: 'user', content: text, captureThumb: cap?.thumb };

    setInput('');
    setPendingCapture(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const history = [...messages, userMsg];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setIsGenerating(true);

    try {
      const res = await fetch('/api/companion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, content: m.content })),
          ...(cap ? { screenshot: cap.source } : {}),
        }),
      });

      if (!res.ok || !res.body) throw new Error('failed');

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
    } catch {
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], content: '✕ Failed to connect.' };
        return next;
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="companion-overlay-root">
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

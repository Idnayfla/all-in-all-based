'use client';
import { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { capturePreview, captureScreen, isScreenCaptureSupported } from '@/hooks/useScreenCapture';
import { FileNode } from '@/lib/types';

export interface CMsg {
  role: 'user' | 'assistant';
  content: string;
  captureLabel?: string;
  isScreenshot?: boolean;
  captureThumb?: string;
}

interface Props {
  memory: string;
  files: FileNode[];
  projectName?: string;
  initialMessages: CMsg[];
  onMessagesChange: (msgs: CMsg[]) => void;
  onClose: () => void;
  onGeneratingChange: (v: boolean) => void;
  authToken?: string;
}

export default function CompanionDrawer({
  memory,
  files,
  projectName,
  initialMessages,
  onMessagesChange,
  onClose,
  onGeneratingChange,
  authToken,
}: Props) {
  const [messages, setMessages] = useState<CMsg[]>(initialMessages);
  const syncRef = useRef(onMessagesChange);
  useEffect(() => {
    syncRef.current = onMessagesChange;
  });
  useEffect(() => {
    syncRef.current(messages);
  }, [messages]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);
  const [slowWarning, setSlowWarning] = useState(false);
  const slowWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingCapture, setPendingCapture] = useState<{
    label: string;
    source: string;
    isScreenshot: boolean;
    thumb?: string;
  } | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 600);
  const screenCaptureSupported = isScreenCaptureSupported();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mobileImageRef = useRef<HTMLInputElement>(null);
  const sessionId = useRef(String(Date.now()).slice(-4));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const flashError = (msg: string) => {
    setCaptureError(msg);
    setTimeout(() => setCaptureError(null), 2500);
  };

  const handleMobileImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setPendingCapture({
        label: 'Screenshot attached',
        source: dataUrl,
        isScreenshot: true,
        thumb: dataUrl,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCapturePreview = () => {
    const cap = capturePreview(files);
    if (!cap) {
      flashError('No project files loaded');
      return;
    }
    setPendingCapture({ label: cap.label, source: cap.source, isScreenshot: false });
  };

  const handleCaptureScreen = async () => {
    const dataUrl = await captureScreen();
    if (!dataUrl) {
      flashError('Screen share cancelled');
      return;
    }
    setPendingCapture({
      label: 'Screen captured',
      source: dataUrl,
      isScreenshot: true,
      thumb: dataUrl,
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || isGenerating) return;

    const cap = pendingCapture;
    const userMsg: CMsg = {
      role: 'user',
      content: text,
      captureLabel: cap?.label,
      isScreenshot: cap?.isScreenshot,
      captureThumb: cap?.thumb,
    };

    setInput('');
    setPendingCapture(null);
    const history = [...messages, userMsg];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setIsGenerating(true);
    onGeneratingChange(true);
    setSlowWarning(false);

    // Fix F: slow warning after 15 s
    slowWarningTimerRef.current = setTimeout(() => setSlowWarning(true), 15000);

    // Fix E: hard-reset safety net — force-unlock if still generating after 45 s
    hardResetTimerRef.current = setTimeout(() => {
      setIsGenerating(false);
      onGeneratingChange(false);
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

    // Fix C: AbortController cancels the fetch + stream after 30 s
    const abortController = new AbortController();
    const fetchTimeoutId = setTimeout(() => abortController.abort(), 30000);

    try {
      const res = await fetch('/api/companion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          messages: history
            .filter(m => m.content?.trim())
            .map(m => ({ role: m.role, content: m.content })),
          memory,
          projectName,
          fileNames: files.map(f => f.name),
          ...(cap?.isScreenshot ? { screenshot: cap.source } : {}),
          ...(!cap?.isScreenshot && cap ? { previewSource: cap.source } : {}),
        }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) throw new Error('Request failed');

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
            const parsed = JSON.parse(raw);
            if (parsed.text)
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: next[next.length - 1].content + parsed.text,
                };
                return next;
              });
            if (parsed.memory_saved) {
              setMemorySaved(true);
              setTimeout(() => setMemorySaved(false), 3000);
            }
          } catch {}
        }
      }
      // Stream closed with no text — surface an error rather than leaving a blank message
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && !last.content?.trim()) {
          next[next.length - 1] = { ...last, content: '✕ Failed to get a response.' };
        }
        return next;
      });
    } catch (err) {
      const isAborted = err instanceof Error && err.name === 'AbortError';
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = {
          ...next[next.length - 1],
          content: isAborted
            ? '✕ Request timed out. Please try again.'
            : '✕ Failed to get a response.',
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
      onGeneratingChange(false);
    }
  };

  return (
    <motion.div
      className="companion-drawer"
      style={isMobile ? undefined : { transformOrigin: 'bottom right' }}
      initial={isMobile ? { y: '-100%', opacity: 0 } : { opacity: 0, scale: 0.85, x: 40, y: 40 }}
      animate={isMobile ? { y: 0, opacity: 1 } : { opacity: 1, scale: 1, x: 0, y: 0 }}
      exit={isMobile ? { y: '-100%', opacity: 0 } : { opacity: 0, scale: 0.85, x: 40, y: 40 }}
      transition={
        isMobile
          ? { type: 'spring', stiffness: 380, damping: 34 }
          : { duration: 0.2, ease: 'easeIn' }
      }
    >
      <div className="companion-header">
        <span className="companion-logo">⬡</span>
        <span className="companion-title">BASED</span>
        <span className="companion-session">#{sessionId.current}</span>
        <button
          className="companion-clear"
          onClick={() => setMessages([])}
          disabled={isGenerating}
          title="Clear history"
          aria-label="Clear history"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
        <button className="companion-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      <div className="companion-messages">
        {messages.length === 0 && (
          <div className="companion-empty">
            Ask anything about your project, or capture the preview for visual analysis.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.captureLabel && (
              <div className="companion-capture-card">
                <div className="companion-capture-label">
                  {msg.isScreenshot ? '🖥' : '📷'} {msg.captureLabel}
                </div>
                {msg.captureThumb && (
                  <img className="companion-capture-thumb" src={msg.captureThumb} alt="capture" />
                )}
                <div className="companion-scan-line" />
              </div>
            )}
            <div className={`companion-bubble companion-bubble--${msg.role}`}>
              <span>{msg.content}</span>
              {msg.role === 'assistant' && isGenerating && i === messages.length - 1 && (
                <span className="companion-cursor" />
              )}
            </div>
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

      {memorySaved && (
        <div style={{
          position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--accent, #6366f1)', color: '#fff', borderRadius: 20,
          padding: '4px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
          pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
          animation: 'fade-in-out 3s ease forwards',
        }}>
          ◈ Saved to memory
        </div>
      )}
      <div className="companion-input-area">
        <div className="companion-capture-row">
          <button
            className={`companion-capture-btn${pendingCapture && !pendingCapture.isScreenshot ? ' active' : ''}`}
            onClick={handleCapturePreview}
            disabled={isGenerating}
            title="Send project source code to Based"
          >
            📄 Code
          </button>
          {isMobile ? (
            <>
              <input
                ref={mobileImageRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleMobileImagePick}
              />
              <button
                className={`companion-capture-btn${pendingCapture?.isScreenshot ? ' active' : ''}`}
                onClick={() => mobileImageRef.current?.click()}
                disabled={isGenerating}
                title="Attach a screenshot from your photos"
              >
                📷 Photo
              </button>
            </>
          ) : (
            <button
              className={`companion-capture-btn${pendingCapture?.isScreenshot ? ' active' : ''}`}
              onClick={handleCaptureScreen}
              disabled={isGenerating || !screenCaptureSupported}
            >
              🖥 Screen
            </button>
          )}
          {captureError && <span className="companion-capture-error">{captureError}</span>}
        </div>

        {pendingCapture && (
          <div className="companion-pending-badge">
            {pendingCapture.isScreenshot ? '🖥' : '📷'} {pendingCapture.label}
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
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask Based anything..."
            rows={1}
            disabled={isGenerating}
          />
          <button
            className="companion-send"
            onClick={send}
            disabled={isGenerating || !input.trim()}
          >
            {isGenerating ? <span className="spinner" /> : '▶'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

'use client';
import { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { capturePreview, captureScreen, isScreenCaptureSupported } from '@/hooks/useScreenCapture';
import { FileNode } from '@/app/page';

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

    try {
      const res = await fetch('/api/companion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, content: m.content })),
          memory,
          projectName,
          fileNames: files.map(f => f.name),
          ...(cap?.isScreenshot ? { screenshot: cap.source } : {}),
          ...(!cap?.isScreenshot && cap ? { previewSource: cap.source } : {}),
        }),
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
          } catch {}
        }
      }
    } catch {
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = {
          ...next[next.length - 1],
          content: '✕ Failed to get a response.',
        };
        return next;
      });
    } finally {
      setIsGenerating(false);
      onGeneratingChange(false);
    }
  };

  return (
    <motion.div
      className="companion-drawer"
      initial={isMobile ? { y: '-100%', opacity: 0 } : { x: 320, opacity: 0 }}
      animate={isMobile ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 }}
      exit={isMobile ? { y: '-100%', opacity: 0 } : { x: 320, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
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
        >
          ↺
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
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

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

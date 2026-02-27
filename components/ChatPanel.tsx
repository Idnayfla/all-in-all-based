'use client';
import { useRef, useEffect, useState } from 'react';
import { Message, FileNode } from '@/app/page';
import ReactMarkdown from 'react-markdown';

const SUGGESTIONS = [
  'Build a todo app with React',
  'Create a Snake game in JS',
  'Make a weather dashboard',
  'Build a Markdown editor',
];

export default function ChatPanel({ messages, setMessages, files, onFilesUpdate, isGenerating, setIsGenerating, personality, memory, incognito }: {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  files: FileNode[];
  onFilesUpdate: (files: FileNode[], type?: string) => void;
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;
  personality: string;
  memory: string;
  incognito: boolean;
}) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const autoResize = () => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; }
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isGenerating) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = '44px';

    const newMessages: Message[] = [...messages, { role: 'user', content }];
    setMessages(newMessages);
    setIsGenerating(true);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, existingFiles: files, personality, memory }),
      });
      const data = await res.json();
      if (data.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      }
      if (data.files?.length) {
        onFilesUpdate(data.files, data.projectType);
    }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: Could not reach the API. Check your API key.' }]);
    } finally {
      setIsGenerating(false);
      // Auto-update memory after conversation
      try {
        const res = await fetch('/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: newMessages }),
        });
        const data = await res.json();
        if (data.memory) {
          // Notify parent to refresh memory
          window.dispatchEvent(new CustomEvent('memory-updated'));
        }
      } catch (e) {
        // Memory update failed silently
      }
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">⬡</div>
            <div className="chat-empty-title">ALL IN ALL BASED</div>
            <div className="chat-empty-sub">Making your life easier is what matter.</div>
            <div className="chat-suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="suggestion-btn" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              <div className="message-role">{m.role === 'user' ? '▸ You' : '◈ Based'}</div>
              <div className="message-content">
                <ReactMarkdown>{m.content}</ReactMarkdown>
            </div>
            </div>
          ))
        )}
        {isGenerating && (
          <div className="message assistant">
            <div className="message-role">◈ Forge</div>
            <div className="message-content" style={{ color: 'var(--text3)' }}>Generating...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={input}
          onChange={e => { setInput(e.target.value); autoResize(); }}
          onKeyDown={handleKey}
          placeholder="How may I assist you today?"
          rows={1}
          disabled={isGenerating}
        />
        <button className="send-btn" onClick={() => send()} disabled={isGenerating || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
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
    const content = text ?? input.trim();
    if (!content || isGenerating) return;
    setInput('');
    const userMsg: Message = { role: 'user', content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsGenerating(true);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, existingFiles: files, personality, memory }),
      });

      if (!res.ok) throw new Error('API error');
      if (!res.body) throw new Error('No stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantMsg = '';
      let buffer = '';

      // Add placeholder assistant message to stream into
      setMessages(prev => [...prev, { role: 'assistant', content: '⏳ Working...' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line.startsWith('data: ')) {
            buffer += line + '\n';
            continue;
          }
          try {
            const data = JSON.parse(line.slice(6));

            if (data.chunk) {
              assistantMsg += data.chunk;
              const preFile = assistantMsg.split('<forge_file')[0]
                .replace(/<forge_type>.*?<\/forge_type>/g, '')
                .trim();
              const display = preFile || '⏳ Working...';
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: display };
                return updated;
              });
            }

            if (data.done) {
              setMessages(prev => [
                ...prev.slice(0, -1),
                { role: 'assistant', content: data.reply || '✅ Done — check the editor.' }
              ]);
              if (data.files?.length) {
                onFilesUpdate(data.files, data.projectType);
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: Could not reach the API.' }]);
    } finally {
      // Cleanup incomplete stream
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.content === '⏳ Working...') {
          return [...prev.slice(0, -1), { role: 'assistant', content: 'Done — check the files in the editor.' }];
        }
        return prev;
      });
      setIsGenerating(false);
      if (!incognito) {
        try {
          const finalMessages = [...messages, { role: 'user', content }];
          const res = await fetch('/api/memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: finalMessages }),
          });
          const data = await res.json();
          if (data.memory) {
            window.dispatchEvent(new CustomEvent('memory-updated'));
          }
        } catch (e) {}
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
            <div className="message-role">◈ Based</div>
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
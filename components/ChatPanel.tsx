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

  const parseForgeFiles = (text: string) => {
    const files: { name: string; language: string; content: string }[] = [];
    const blockRegex = /<forge_file\s[^>]*>([\s\S]*?)<\/forge_file>/g;
    let m;
    while ((m = blockRegex.exec(text)) !== null) {
      const tag = m[0];
      const content = m[1].trim();
      const nameMatch = tag.match(/name=["']([^"']+)["']/);
      const langMatch = tag.match(/language=["']([^"']+)["']/);
      if (nameMatch && langMatch) files.push({ name: nameMatch[1], language: langMatch[1], content });
    }
    return files;
  };

  const send = async (text?: string) => {
    const content = text ?? input.trim();
    if (!content || isGenerating) return;
    setInput('');
    const userMsg: Message = { role: 'user', content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsGenerating(true);

    let doneHandled = false;

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

      setMessages(prev => [...prev, { role: 'assistant', content: '⏳ Working...' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (!line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6));

            if (data.chunk) {
              window.dispatchEvent(new CustomEvent('debug-event', { detail: { type: 'chunk', data: data.chunk } }));
              assistantMsg += data.chunk;
              if (!assistantMsg.includes('<forge_file') && !assistantMsg.includes('<forge_type>')) {
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: assistantMsg.trim() || '⏳ Working...' };
                  return updated;
                });
              }
              // Once file tags detected, stay frozen at Working...
            }

            if (data.error) {
              window.dispatchEvent(new CustomEvent('debug-event', { detail: { type: 'error', data: data.error } }));
              doneHandled = true;
              setMessages(prev => [
                ...prev.slice(0, -1),
                { role: 'assistant', content: `❌ Generation failed: ${data.error}` },
              ]);
            }

            if (data.done) {
              const resolvedFiles = data.files?.length
                ? data.files
                : parseForgeFiles(assistantMsg);
              window.dispatchEvent(new CustomEvent('debug-event', { detail: { type: 'done', data: JSON.stringify({ filesCount: resolvedFiles.length, reply: data.reply?.slice(0, 100) }) } }));
              doneHandled = true;
              setMessages(prev => [
                ...prev.slice(0, -1),
                { role: 'assistant', content: data.reply || '✅ Done — check the editor.' }
              ]);
              if (resolvedFiles.length) {
                onFilesUpdate(resolvedFiles, data.projectType);
              }
            }
          } catch (e) {
            window.dispatchEvent(new CustomEvent('debug-event', { detail: { type: 'parse-error', data: String(e) } }));
          }
        }
      }

    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: Could not reach the API.' }]);
    } finally {
      if (!doneHandled) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.content === '⏳ Working...') {
            return [...prev.slice(0, -1), { role: 'assistant', content: '⚠️ Response cut off. Try again.' }];
          }
          return prev;
        });
      }
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
              <div className="message-role">{m.role === 'user' ? 'You' : 'Based'}</div>
              <div className="message-content">
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
            </div>
          ))
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
          placeholder="Ask Based anything..."
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

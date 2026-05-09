'use client';
import { useRef, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Message, FileNode, ContentBlock } from '@/app/page';
import ReactMarkdown from 'react-markdown';
import ImageEditorModal from './ImageEditorModal';

const SUGGESTIONS = [
  'Build a todo app with React',
  'Create a Snake game in JS',
  'Make a weather dashboard',
  'Build a Markdown editor',
];

interface GenerationProgress {
  files: string[];
  completed: number;  // fully finished files
  total: number;
  file: string;
  chunks: number;     // chunks received for the current file
}

function ProgressBar({ progress }: { progress: GenerationProgress }) {
  // Asymptotic curve: fills quickly then tapers — no fixed chunk estimate needed
  const withinFile = progress.file
    ? Math.min(1 - Math.exp(-progress.chunks / 50), 0.92)
    : 0;
  const pct = progress.total === 0 ? 0
    : Math.round((progress.completed + withinFile) / progress.total * 100);

  return (
    <div className="generation-progress">
      <div className="gen-progress-header">
        <span className="gen-progress-file">{progress.file ? `⚙ ${progress.file}` : '⏳ Preparing...'}</span>
        <span className="gen-progress-count">{progress.completed}/{progress.total}</span>
      </div>
      <div className="gen-progress-bar-track">
        <div className="gen-progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="gen-progress-pct">{pct}%</div>
      <div className="gen-progress-files">
        {progress.files.map((f, i) => {
          const done = i < progress.completed;
          const active = i === progress.completed;
          return (
            <span key={f} className={`gen-file-chip ${done ? 'done' : active ? 'active' : ''}`}>
              {done ? '✓ ' : active ? '⚙ ' : ''}{f}
            </span>
          );
        })}
      </div>
    </div>
  );
}

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
  const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);
  const [imageMode, setImageMode] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<{
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    previewUrl: string;
  } | null>(null);
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const autoResize = () => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const [meta, data] = dataUrl.split(',');
      const mediaType = meta.match(/:(.*?);/)?.[1] as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      setPendingImage({ data, mediaType, previewUrl: dataUrl });
    };
    reader.onerror = () => {
      console.error('Failed to read image file');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const clearPendingImage = () => {
    setPendingImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const parseForgeFiles = (text: string) => {
    const forgeFiles: { name: string; language: string; content: string }[] = [];
    const blockRegex = /<forge_file\s[^>]*>([\s\S]*?)<\/forge_file>/g;
    let m;
    while ((m = blockRegex.exec(text)) !== null) {
      const tag = m[0];
      const content = m[1].trim();
      const nameMatch = tag.match(/name=["']([^"']+)["']/);
      const langMatch = tag.match(/language=["']([^"']+)["']/);
      if (nameMatch && langMatch) forgeFiles.push({ name: nameMatch[1], language: langMatch[1], content });
    }
    return forgeFiles;
  };

  const sendImage = async () => {
    const prompt = input.trim();
    if (!prompt || isGenerating || isGeneratingImage) return;
    setInput('');
    setIsGeneratingImage(true);

    const userMsg: Message = { role: 'user', content: prompt };
    const loadingMsg: Message = { role: 'assistant', content: [{ type: 'text', text: '🎨 Generating image...' }] };
    setMessages(prev => [...prev, userMsg, loadingMsg]);

    try {
      const res = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: [{ type: 'generated-image', url: data.url, prompt }] },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: `❌ Image generation failed: ${err.message}` },
      ]);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const send = async (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed && !pendingImage) return;
    if (isGenerating) return;

    const messageContent: Message['content'] = pendingImage
      ? [
          { type: 'image', mediaType: pendingImage.mediaType, data: pendingImage.data },
          ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
        ]
      : trimmed;

    setInput('');
    setPendingImage(null);
    setGenProgress(null);

    const userMsg: Message = { role: 'user', content: messageContent };
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

            if (data.plan) {
              flushSync(() => {
                setGenProgress({ files: data.plan, completed: 0, total: data.plan.length, file: '', chunks: 0 });
              });
            }

            if (data.status) {
              flushSync(() => {
                setGenProgress(prev => prev ? { ...prev, file: data.status.file, chunks: 0 } : null);
              });
            }

            if (data.progress) {
              flushSync(() => {
                setGenProgress(prev => prev ? { ...prev, completed: data.progress.current, chunks: 0 } : null);
              });
            }

            if (data.chunk) {
              window.dispatchEvent(new CustomEvent('debug-event', { detail: { type: 'chunk', data: data.chunk } }));
              assistantMsg += data.chunk;
              setGenProgress(prev => prev && prev.file ? { ...prev, chunks: prev.chunks + 1 } : prev);
              const hasForge = assistantMsg.includes('<forge_file') || assistantMsg.includes('<forge_type');
              if (!hasForge) {
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: assistantMsg.trim() || '⏳ Working...' };
                  return updated;
                });
              } else {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.content && last.content !== '⏳ Working...') {
                    updated[updated.length - 1] = { role: 'assistant', content: '⏳ Working...' };
                  }
                  return updated;
                });
              }
            }

            if (data.error) {
              window.dispatchEvent(new CustomEvent('debug-event', { detail: { type: 'error', data: data.error } }));
              doneHandled = true;
              setGenProgress(null);
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
              setGenProgress(null);
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
      setGenProgress(null);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: Could not reach the API.' }]);
    } finally {
      if (!doneHandled) {
        setGenProgress(null);
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
          const finalMessages = [...messages, userMsg];
          const memMessages = finalMessages.map(m => ({
            role: m.role,
            content: Array.isArray(m.content)
              ? m.content.filter((b: { type: string }) => b.type === 'text')
              : m.content,
          }));
          const memRes = await fetch('/api/memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: memMessages }),
          });
          const memData = await memRes.json();
          if (memData.memory) {
            window.dispatchEvent(new CustomEvent('memory-updated'));
          }
        } catch (e) {}
      }
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  function renderContent(content: string | ContentBlock[]) {
    if (typeof content === 'string') return <ReactMarkdown>{content}</ReactMarkdown>;
    return (
      <>
        {content.map((block, i) => {
          if (block.type === 'image') {
            return <img key={i} className="chat-img-thumb" src={`data:${block.mediaType};base64,${block.data}`} alt="uploaded image" />;
          }
          if (block.type === 'generated-image') {
            return (
              <div key={i} className="generated-image-wrap">
                <img className="generated-image" src={block.url} alt={block.prompt} />
                <div className="generated-image-prompt">{block.prompt}</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <a className="generated-image-download" href={block.url} download target="_blank" rel="noreferrer">↓ Download</a>
                  <button className="generated-image-edit-btn" onClick={() => setEditingImageUrl(block.url)}>✏ Edit</button>
                </div>
              </div>
            );
          }
          if (block.type === 'text') {
            return <ReactMarkdown key={i}>{block.text}</ReactMarkdown>;
          }
          return null;
        })}
      </>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-logo" aria-hidden="true">B&gt;</div>
            <div className="chat-empty-title">BASED</div>
            <div className="chat-empty-sub">Your AI coding assistant. Describe what you want to build.</div>
            <div className="chat-suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="suggestion-btn" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              <div className="message-role">{m.role === 'user' ? 'YOU' : 'BASED'}</div>
              <div className="message-content">
                {m.role === 'assistant' && genProgress && i === messages.length - 1
                  ? <ProgressBar progress={genProgress} />
                  : renderContent(m.content)
                }
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area">
        {pendingImage && (
          <div className="chat-image-preview">
            <img className="chat-img-thumb" src={pendingImage.previewUrl} alt="pending upload" />
            <button className="img-clear-btn" onClick={clearPendingImage} title="Remove image">✕</button>
          </div>
        )}
        <div className="chat-input-row">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            className="upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isGenerating || imageMode}
            title="Attach image"
          >📎</button>
          <button
            className={`image-mode-btn${imageMode ? ' active' : ''}`}
            onClick={() => setImageMode(m => !m)}
            disabled={isGenerating || isGeneratingImage}
            title={imageMode ? 'Switch to chat mode' : 'Switch to image generation mode'}
          >🎨</button>
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(); }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                imageMode ? sendImage() : send();
              }
            }}
            placeholder={imageMode ? 'Describe an image to generate...' : 'Ask Based anything...'}
            rows={1}
            disabled={isGenerating || isGeneratingImage}
          />
          <button
            className={`send-btn${imageMode ? ' send-btn-image' : ''}`}
            onClick={() => imageMode ? sendImage() : send()}
            disabled={isGenerating || isGeneratingImage || (!input.trim() && !pendingImage)}
          >
            {isGeneratingImage ? '⏳' : imageMode ? 'Generate' : 'Send'}
          </button>
        </div>
      </div>
      {editingImageUrl && (
        <ImageEditorModal
          sourceImageUrl={editingImageUrl}
          onConfirm={(resultUrl, confirmedPrompt) => {
            setMessages(prev => [
              ...prev,
              { role: 'assistant', content: [{ type: 'generated-image', url: resultUrl, prompt: confirmedPrompt }] },
            ]);
            setEditingImageUrl(null);
          }}
          onClose={() => setEditingImageUrl(null)}
        />
      )}
    </div>
  );
}

'use client';
import { useRef, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Message, FileNode, ContentBlock } from '@/app/page';
import ReactMarkdown from 'react-markdown';
import ImageEditorModal from './ImageEditorModal';
import ModeDropdown, { GenerationMode } from './ModeDropdown';
import GeneratedVideoCard from './GeneratedVideoCard';
import GeneratedMusicCard from './GeneratedMusicCard';
import GeneratingCard from './GeneratingCard';
import { useVoiceActivation } from '@/hooks/useVoiceActivation';

const SUGGESTION_POOL = [
  'Build a todo app with drag & drop',
  'Create a Snake game in JS',
  'Make a real-time weather dashboard',
  'Build a Markdown editor with preview',
  'Create a Pomodoro timer with sounds',
  'Build a pixel art editor',
  'Make a music visualizer with WebAudio',
  'Create a 2048 game clone',
  'Build a CSS gradient generator',
  'Make a typing speed test app',
  'Create a Tetris clone',
  'Build a quiz game with scoring',
  'Make a drawing canvas app',
  'Create a password generator',
  'Build a currency converter',
  'Make a GitHub profile card',
  'Create a calendar event planner',
  'Build a flashcard study app',
  'Make an ASCII art generator',
  'Create a color palette generator',
  'Build a Kanban board',
  'Make a recipe search app',
  'Create a countdown timer',
  'Build a BMI calculator dashboard',
  'Make a memory card flip game',
  'Create a mini code editor',
  'Build a virtual piano',
  'Make a spinning fidget cube',
  'Create a habit tracker',
  'Build a random quote machine',
  'Make a Pac-Man style maze game',
  'Create a binary/hex converter',
  'Build a live CSS animation playground',
  'Make a star rating component',
  'Create a dice roller simulator',
];

function getRandomSuggestions() {
  const shuffled = [...SUGGESTION_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 4);
}

interface GenerationProgress {
  files: string[];
  completed: number;  // fully finished files
  total: number;
  file: string;
  chunks: number;     // chunks received for the current file
}

function ProgressBar({ progress }: { progress: GenerationProgress }) {
  const withinFile = progress.file
    ? Math.min(1 - Math.exp(-progress.chunks / 50), 0.92)
    : 0;
  const pct = progress.total === 0 ? 0
    : Math.round((progress.completed + withinFile) / progress.total * 100);
  const isIndeterminate = progress.total === 0;

  return (
    <div className="generation-progress">
      <div className="gen-progress-header">
        <span className="gen-progress-file">
          {isIndeterminate
            ? (progress.file || '... Preparing')
            : (progress.file ? `◈ ${progress.file}` : '... Preparing')}
        </span>
        {!isIndeterminate && <span className="gen-progress-count">{progress.completed}/{progress.total}</span>}
      </div>
      <div className="gen-progress-bar-track">
        {isIndeterminate ? (
          <div className="gen-progress-bar-fill gen-progress-bar-scanning" />
        ) : (
          <motion.div
            className="gen-progress-bar-fill"
            animate={{ width: `${pct}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          />
        )}
      </div>
      {!isIndeterminate && <div className="gen-progress-pct">{pct}%</div>}
      {!isIndeterminate && (
        <div className="gen-progress-files">
          {progress.files.map((f, i) => {
            const done = i < progress.completed;
            const active = i === progress.completed;
            return (
              <span key={f} className={`gen-file-chip ${done ? 'done' : active ? 'active' : ''}`}>
                {done ? '✓ ' : active ? '◈ ' : ''}{f}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({ messages, setMessages, files, onFilesUpdate, isGenerating, setIsGenerating, personality, memory, globalMemory, incognito, authToken, subscriptionTier, generationsUsed, prefillMessage }: {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  files: FileNode[];
  onFilesUpdate: (files: FileNode[], type?: string) => void;
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;
  personality: string;
  memory: string;
  globalMemory?: string;
  incognito: boolean;
  authToken?: string;
  subscriptionTier?: 'free' | 'pro';
  generationsUsed?: number;
  prefillMessage?: string;
}) {
  const [input, setInput] = useState(prefillMessage ?? '');
  const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('chat');
  const [isGeneratingMedia, setIsGeneratingMedia] = useState(false);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [lastSuggestions, setLastSuggestions] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const locationRef = useRef<{ lat: number; lon: number } | null>(null);

  const discardGeneration = () => {
    abortRef.current?.abort();
  };
  const [pendingImage, setPendingImage] = useState<{
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    previewUrl: string;
  } | null>(null);
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null);
  const [suggestions] = useState(getRandomSuggestions);

  const { state: voiceState, transcript: voiceTranscript, error: voiceError, toggle: toggleVoice } =
    useVoiceActivation((command) => {
      // Show the recognized text in the textarea so the user can see it was heard,
      // then auto-send after a brief pause
      setInput(command);
      setTimeout(() => {
        if (!isGenerating) send(command);
      }, 400);
    });

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
    if (!prompt || isGenerating || isGeneratingMedia) return;
    setInput('');
    setIsGeneratingMedia(true);

    const userMsg: Message = { role: 'user', content: prompt };
    const loadingMsg: Message = { role: 'assistant', content: [{ type: 'text', text: '__generating-image__' }] };
    setMessages(prev => [...prev, userMsg, loadingMsg]);

    const body: Record<string, string> = { prompt, model: generationMode === 'nano-banana' ? 'nano-banana' : 'flux' };
    if (pendingImage) {
      body.sourceImageData = pendingImage.data;
      body.sourceMediaType = pendingImage.mediaType;
    }
    setPendingImage(null);

    try {
      const res = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
        { role: 'assistant', content: `✕ Image generation failed: ${err.message}` },
      ]);
    } finally {
      setIsGeneratingMedia(false);
    }
  };

  const sendMusic = async () => {
    const prompt = input.trim();
    if (!prompt || isGenerating || isGeneratingMedia) return;
    setInput('');
    setIsGeneratingMedia(true);

    const userMsg: Message = { role: 'user', content: prompt };
    const loadingMsg: Message = { role: 'assistant', content: [{ type: 'text', text: '__generating-music__' }] };
    setMessages(prev => [...prev, userMsg, loadingMsg]);

    try {
      const res = await fetch('/api/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: [{ type: 'generated-music', url: data.url, prompt }] },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: `✕ Music generation failed: ${err.message}` },
      ]);
    } finally {
      setIsGeneratingMedia(false);
    }
  };

  const sendVideo = async () => {
    const prompt = input.trim();
    if (!prompt || isGenerating || isGeneratingMedia) return;
    setInput('');
    setIsGeneratingMedia(true);

    const userMsg: Message = { role: 'user', content: prompt };
    const loadingMsg: Message = { role: 'assistant', content: [{ type: 'text', text: '__generating-video__' }] };
    setMessages(prev => [...prev, userMsg, loadingMsg]);

    const body: Record<string, string | boolean> = { prompt, generateAudio };
    if (pendingImage) {
      body.imageData = pendingImage.data;
      body.mediaType = pendingImage.mediaType;
    }
    setPendingImage(null);

    try {
      const res = await fetch('/api/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: [{ type: 'generated-video', url: data.url, prompt }] },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: `✕ Video generation failed: ${err.message}` },
      ]);
    } finally {
      setIsGeneratingMedia(false);
    }
  };

  const send = async (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed && !pendingImage) return;
    if (isGenerating) return;

    // Client-side pre-check so limit modal shows even if server count is stale
    if (subscriptionTier === 'free' && (generationsUsed ?? 0) >= 10) {
      window.dispatchEvent(new CustomEvent('generation-limit-reached'));
      return;
    }

    const messageContent: Message['content'] = pendingImage
      ? [
          { type: 'image', mediaType: pendingImage.mediaType, data: pendingImage.data },
          ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
        ]
      : trimmed;

    setInput('');
    setPendingImage(null);
    setGenProgress(null);
    setLastSuggestions([]);

    const userMsg: Message = { role: 'user', content: messageContent };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsGenerating(true);

    let doneHandled = false;
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // Lazily fetch location once — silently skip if denied or unavailable
      if (!locationRef.current && typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise<void>(resolve => {
          navigator.geolocation.getCurrentPosition(
            pos => { locationRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude }; resolve(); },
            () => resolve(),
            { timeout: 2000, maximumAge: 600000 }
          );
        });
      }

      const res = await fetch('/api/generate', {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ messages: newMessages, existingFiles: files, personality, memory, globalMemory, location: locationRef.current }),
      });

      if (res.status === 402) {
        window.dispatchEvent(new CustomEvent('generation-limit-reached'));
        throw new Error('limit');
      }
      if (!res.ok) throw new Error('API error');
      window.dispatchEvent(new CustomEvent('generation-used'));
      if (!res.body) throw new Error('No stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantMsg = '';
      let buffer = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '... Working' }]);

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

            if (data.searching === 'web') {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: '◈ Searching the web...' };
                return updated;
              });
            }

            if (data.searching === null) {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: '◈ Working...' };
                return updated;
              });
            }

            if (data.plan) {
              flushSync(() => {
                setGenProgress({ files: data.plan, completed: 0, total: data.plan.length, file: '', chunks: 0 });
              });
              const fileNames = (data.plan as { name: string }[]).map(f => f.name).join(', ');
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: `⟳ Building ${fileNames}…` };
                return updated;
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
                  updated[updated.length - 1] = { role: 'assistant', content: assistantMsg.trim() || '◈ Working...' };
                  return updated;
                });
              } else {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  const c = typeof last?.content === 'string' ? last.content : '';
                  if (c && !c.startsWith('⟳') && !c.startsWith('◈ Searching') && c !== '◈ Working...') {
                    updated[updated.length - 1] = { role: 'assistant', content: '◈ Working...' };
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
                { role: 'assistant', content: `✕ Generation failed: ${data.error}` },
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
                { role: 'assistant', content: data.reply || '✓ Done — check the editor.' }
              ]);
              if (resolvedFiles.length) {
                onFilesUpdate(resolvedFiles, data.projectType);
              }
              if (data.suggestions?.length) setLastSuggestions(data.suggestions);
              else setLastSuggestions([]);
            }
          } catch (e) {
            window.dispatchEvent(new CustomEvent('debug-event', { detail: { type: 'parse-error', data: String(e) } }));
          }
        }
      }

    } catch (e: any) {
      setGenProgress(null);
      if (e?.name === 'AbortError' || e?.message === 'limit') {
        // AbortError = user clicked Discard; limit = pricing modal already shown — just clean up
        doneHandled = true;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') return [...prev.slice(0, -1)];
          return prev;
        });
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "Hmm, something went wrong on my end — give it another shot. If it keeps happening, try refreshing the page.",
        }]);
      }
    } finally {
      if (!doneHandled) {
        setGenProgress(null);
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.content === '◈ Working...') {
            return [...prev.slice(0, -1), { role: 'assistant', content: '! Response cut off. Try again.' }];
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
            headers: {
              'Content-Type': 'application/json',
              ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
            },
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (generationMode === 'seedance') sendVideo();
      else if (generationMode === 'music') sendMusic();
      else if (generationMode !== 'chat') sendImage();
      else send();
    }
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
              <motion.div
                key={i}
                className="generated-image-wrap"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 350, damping: 28 }}
              >
                <img className="generated-image" src={block.url} alt={block.prompt} />
                <div className="generated-image-prompt">{block.prompt}</div>
                <div className="generated-image-actions">
                  <a className="generated-image-download" href={block.url} download target="_blank" rel="noreferrer">↓ Download</a>
                  <button className="generated-image-edit-btn" onClick={() => setEditingImageUrl(block.url)}>✏ Edit</button>
                </div>
              </motion.div>
            );
          }
          if (block.type === 'generated-video') {
            return <GeneratedVideoCard key={i} url={block.url} prompt={block.prompt} />;
          }
          if (block.type === 'generated-music') {
            return <GeneratedMusicCard key={i} url={block.url} prompt={block.prompt} />;
          }
          if (block.type === 'text' && block.text === '__generating-image__') {
            return <GeneratingCard key={i} type="image" />;
          }
          if (block.type === 'text' && block.text === '__generating-video__') {
            return <GeneratingCard key={i} type="video" />;
          }
          if (block.type === 'text' && block.text === '__generating-music__') {
            return <GeneratingCard key={i} type="music" />;
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
              {suggestions.map((s, index) => (
                <motion.button
                  key={s}
                  className="suggestion-btn"
                  onClick={() => send(s)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.06, type: 'spring', stiffness: 400, damping: 30 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >{s}</motion.button>
              ))}
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={i}
                className={`message ${m.role}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              >
                <div className="message-role">{m.role === 'user' ? 'YOU' : 'BASED'}</div>
                <div className="message-content">
                  {m.role === 'assistant' && isGenerating && i === messages.length - 1
                    ? <ProgressBar progress={genProgress ?? { files: [], completed: 0, total: 0, file: typeof m.content === 'string' && m.content !== '... Working' ? m.content : '', chunks: 0 }} />
                    : renderContent(m.content)
                  }
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        {lastSuggestions.length > 0 && !isGenerating && (
          <div className="suggestion-chips">
            {lastSuggestions.map((s, i) => (
              <button
                key={i}
                className="suggestion-chip"
                onClick={() => { setLastSuggestions([]); send(s); }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area">
        <AnimatePresence>
          {isGenerating && (
            <motion.button
              className="discard-btn"
              onClick={discardGeneration}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              ✕ Discard
            </motion.button>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {pendingImage && (
            <motion.div
              className="chat-image-preview"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <img className="chat-img-thumb" src={pendingImage.previewUrl} alt="pending upload" />
              <button className="img-clear-btn" onClick={clearPendingImage} title="Remove image">✕</button>
            </motion.div>
          )}
        </AnimatePresence>
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
            disabled={isGenerating || generationMode === 'chat'}
            title="Attach image"
          >◆</button>
          <ModeDropdown
            mode={generationMode}
            onChange={setGenerationMode}
            disabled={isGenerating || isGeneratingMedia}
          />
          <button
            type="button"
            className={`voice-btn voice-btn--${voiceState}`}
            onClick={toggleVoice}
            title={
              voiceState === 'idle' ? 'Enable voice — say "Based, ..." to send' :
              voiceState === 'listening' ? 'Listening for "Based, ..." — click to stop' :
              voiceState === 'activated' ? `Got it: "${voiceTranscript}"` :
              'Voice not supported in this browser'
            }
            disabled={voiceState === 'unsupported' || isGenerating || isGeneratingMedia}
          >
            {voiceState === 'activated' ? '◉' : '⬡'}
          </button>
          <AnimatePresence>
            {generationMode === 'seedance' && (
              <motion.button
                key="audio-toggle"
                className={`audio-toggle-btn${generateAudio ? ' audio-toggle-btn--on' : ''}`}
                onClick={() => setGenerateAudio(v => !v)}
                title={generateAudio ? 'Audio: on (2× cost) — click to disable' : 'Audio: off — click to enable'}
                initial={{ opacity: 0, scale: 0.8, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: 'auto' }}
                exit={{ opacity: 0, scale: 0.8, width: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                whileTap={{ scale: 0.92 }}
                disabled={isGenerating || isGeneratingMedia}
              >
                {generateAudio ? '♪' : '◌'}
              </motion.button>
            )}
          </AnimatePresence>
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(); }}
            onKeyDown={handleKey}
            placeholder={
              voiceState === 'listening' ? 'Listening… say "Based, build me a game"' :
              voiceState === 'activated' ? `"${voiceTranscript}"` :
              generationMode === 'seedance' ? 'Describe a video to generate...' :
              generationMode === 'music' ? 'Describe the music to generate...' :
              generationMode !== 'chat' ? 'Describe an image to generate...' :
              'Ask Based anything...'
            }
            rows={1}
            disabled={isGenerating || isGeneratingMedia}
          />
          <motion.button
            className={`send-btn${generationMode !== 'chat' ? ' send-btn-image' : ''}`}
            onClick={() => {
              if (generationMode === 'seedance') sendVideo();
              else if (generationMode === 'music') sendMusic();
              else if (generationMode !== 'chat') sendImage();
              else send();
            }}
            disabled={isGenerating || isGeneratingMedia || (!input.trim() && !pendingImage)}
            whileTap={{ scale: 0.95 }}
          >
            {isGeneratingMedia ? <span className="spinner" /> : generationMode !== 'chat' ? 'Generate' : 'Send'}
          </motion.button>
        </div>
        {voiceError && (
          <div className="voice-error">{voiceError}</div>
        )}
        {voiceState === 'listening' && !voiceError && (
          <div className="voice-hint">Say "Based, build me a calculator" — listening…</div>
        )}
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

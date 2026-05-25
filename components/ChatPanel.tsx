'use client';
import { useRef, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Message, FileNode, ContentBlock } from '@/app/page';
import ReactMarkdown from 'react-markdown';
import ImageEditorModal from './ImageEditorModal';
import ImageCropModal from './ImageCropModal';
import ModeDropdown, { GenerationMode } from './ModeDropdown';
import { PersonaKey } from './PersonaSwitcher';
import GeneratedVideoCard from './GeneratedVideoCard';
import GeneratedMusicCard from './GeneratedMusicCard';
import GeneratingCard from './GeneratingCard';
import { track } from '@/lib/posthog';
import { useTranslation } from '@/lib/i18n';

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
  completed: number; // fully finished files
  total: number;
  file: string;
  chunks: number; // chunks received for the current file
}

const FREE_LOADING_MSGS = [
  'Thinking',
  'Analyzing your request',
  'Planning the build',
  'Crafting something good',
  'Cooking it up',
  'On it',
  'Working through it',
  '· Go Pro for instant responses',
  'Almost there',
  'Putting it together',
  '· Pro tier responds way faster — just saying',
  'Mapping it out',
  'Sketching the structure',
  '· Upgrade to Pro and skip the wait',
];

const DOTS = ['.', '..', '...'];

function ProgressBar({ progress, isFree }: { progress: GenerationProgress; isFree?: boolean }) {
  const [msgIdx, setMsgIdx] = useState(0);
  const [dotsIdx, setDotsIdx] = useState(0);
  const isIndeterminate = progress.total === 0;

  useEffect(() => {
    if (!isIndeterminate || !isFree) return;
    const id = setInterval(() => setMsgIdx(i => (i + 1) % FREE_LOADING_MSGS.length), 3200);
    return () => clearInterval(id);
  }, [isIndeterminate, isFree]);

  useEffect(() => {
    if (!isIndeterminate) return;
    const id = setInterval(() => setDotsIdx(i => (i + 1) % DOTS.length), 450);
    return () => clearInterval(id);
  }, [isIndeterminate]);

  const withinFile = progress.file ? Math.min(1 - Math.exp(-progress.chunks / 50), 0.92) : 0;
  const pct =
    progress.total === 0
      ? 0
      : Math.round(((progress.completed + withinFile) / progress.total) * 100);

  const rawMsg = isFree ? FREE_LOADING_MSGS[msgIdx] : 'Preparing';
  const preparingLabel = rawMsg.startsWith('·') ? rawMsg : `${DOTS[dotsIdx]} ${rawMsg}`;

  return (
    <div className="generation-progress">
      <div className="gen-progress-header">
        <span className="gen-progress-file">
          {isIndeterminate
            ? progress.file || preparingLabel
            : progress.file
              ? `◈ ${progress.file}`
              : preparingLabel}
        </span>
        {!isIndeterminate && (
          <span className="gen-progress-count">
            {progress.completed}/{progress.total}
          </span>
        )}
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
                {done ? '✓ ' : active ? '◈ ' : ''}
                {f}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({
  messages,
  setMessages,
  files,
  onFilesUpdate,
  isGenerating,
  setIsGenerating,
  personality,
  memory,
  globalMemory,
  incognito,
  authToken,
  subscriptionTier,
  generationsUsed,
  prefillMessage,
  onProRequired,
  aiModel,
  onGenerationComplete,
  persona = 'based',
  onPanelSwitch,
}: {
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
  onProRequired?: () => void;
  onReportBug?: () => void;
  aiModel?: 'based' | 'free';
  onGenerationComplete?: () => void;
  persona?: PersonaKey;
  onPanelSwitch?: (panel: string) => void;
}) {
  const [input, setInput] = useState(prefillMessage ?? '');
  const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);
  const [slowWarning, setSlowWarning] = useState(false);
  const slowWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);
  const [showSupportNudge, setShowSupportNudge] = useState(false);
  const [suggestions] = useState(getRandomSuggestions);
  const [flaggingIdx, setFlaggingIdx] = useState<number | null>(null);
  const [flaggedSet, setFlaggedSet] = useState<Set<number>>(new Set());
  const [flagReason, setFlagReason] = useState('');
  const [flagText, setFlagText] = useState('');
  const [flagSending, setFlagSending] = useState(false);
  const [reportedErrors, setReportedErrors] = useState<Set<string>>(new Set());
  const reportingInFlight = useRef<Set<string>>(new Set());
  const [micState, setMicState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [mobileInputOpen, setMobileInputOpen] = useState(false);
  const mobileTextareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const { t } = useTranslation();

  const submitFlag = async (msgIdx: number, _msgContent: string, _userPrompt: string) => {
    if (flagSending) return;
    setFlagSending(true);
    const body = [flagReason, flagText.trim()].filter(Boolean).join(' — ') || 'Not what I expected';
    const recentMsgs = messages.slice(-10);
    const startIdx = messages.length - recentMsgs.length;
    const context =
      recentMsgs.length > 0
        ? recentMsgs
            .map((m, relIdx) => {
              const absIdx = startIdx + relIdx;
              const text =
                typeof m.content === 'string'
                  ? m.content
                  : (m.content as Array<{ type: string; text?: string }>)
                      .filter(b => b.type === 'text')
                      .map(b => b.text ?? '')
                      .join('');
              if (m.role === 'user') {
                return `YOU\n${text}`;
              }
              const reaction = flaggedSet.has(absIdx) ? '\n\n⊙ Not what I expected' : '';
              return `BASED\n${text}${reaction}`;
            })
            .join('\n\n')
        : '';
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: body, type: 'response', context }),
      });
      setFlaggedSet(prev => new Set(prev).add(msgIdx));
      setFlaggingIdx(null);
      setFlagReason('');
      setFlagText('');
    } finally {
      setFlagSending(false);
    }
  };

  const getSupportedMimeType = () => {
    for (const type of ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav']) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  };

  const toggleMic = async () => {
    if (micState === 'recording') {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (micState !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        setMicState('transcribing');
        try {
          const actualType = recorder.mimeType || mimeType || 'audio/webm';
          const ext = actualType.includes('mp4') ? 'm4a' : actualType.includes('ogg') ? 'ogg' : 'webm';
          const blob = new Blob(audioChunksRef.current, { type: actualType });
          const form = new FormData();
          form.append('audio', blob, `recording.${ext}`);
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          const { text } = await res.json();
          if (text?.trim()) {
            // Insert at cursor (Wispr Flow behaviour) — user reviews before sending
            const ta = textareaRef.current;
            if (ta) {
              const start = ta.selectionStart ?? ta.value.length;
              const end = ta.selectionEnd ?? ta.value.length;
              const next = ta.value.slice(0, start) + text.trim() + ta.value.slice(end);
              setInput(next);
              setTimeout(() => {
                ta.setSelectionRange(start + text.trim().length, start + text.trim().length);
                ta.focus();
              }, 0);
            } else {
              setInput(prev => (prev ? prev + ' ' + text.trim() : text.trim()));
            }
          }
        } catch {
          // silently fail — user can type manually
        } finally {
          setMicState('idle');
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setMicState('recording');
    } catch {
      // mic not available or denied — silently ignore
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const autoResize = () => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      const [meta, data] = dataUrl.split(',');
      const mediaType = meta.match(/:(.*?);/)?.[1] as
        | 'image/jpeg'
        | 'image/png'
        | 'image/webp'
        | 'image/gif';
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
      if (nameMatch && langMatch)
        forgeFiles.push({ name: nameMatch[1], language: langMatch[1], content });
    }
    return forgeFiles;
  };

  const sendImage = async () => {
    const prompt = input.trim();
    if (!prompt || isGenerating || isGeneratingMedia) return;
    setInput('');
    setIsGeneratingMedia(true);

    const userMsg: Message = { role: 'user', content: prompt };
    const loadingMsg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: '__generating-image__' }],
    };
    setMessages(prev => [...prev, userMsg, loadingMsg]);

    const body: Record<string, string> = {
      prompt,
      model: generationMode === 'nano-banana' ? 'nano-banana' : 'flux',
    };
    if (pendingImage) {
      body.sourceImageData = pendingImage.data;
      body.sourceMediaType = pendingImage.mediaType;
    }
    setPendingImage(null);

    try {
      const res = await fetch('/api/image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 401 || res.status === 403) {
        if (onProRequired) {
          onProRequired();
          return;
        }
      }
      if (data.error) throw new Error(data.error);
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: [{ type: 'generated-image', url: data.url, prompt }] },
      ]);
    } catch (err: unknown) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        {
          role: 'assistant',
          content: [
            {
              type: 'error' as const,
              message:
                'Image generation failed. Try rephrasing your prompt — if it keeps happening, tap Report.',
              prompt,
              actualError: err instanceof Error ? err.message : String(err),
            },
          ],
        },
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
    const loadingMsg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: '__generating-music__' }],
    };
    setMessages(prev => [...prev, userMsg, loadingMsg]);

    try {
      const res = await fetch('/api/music', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if ((res.status === 401 || res.status === 403) && onProRequired) {
        onProRequired();
        return;
      }
      if (data.error) throw new Error(data.error);
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: [{ type: 'generated-music', url: data.url, prompt }] },
      ]);
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        {
          role: 'assistant',
          content: [
            {
              type: 'error' as const,
              message: `Music generation failed. Try describing a different style or mood.`,
            },
          ],
        },
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
    const loadingMsg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: '__generating-video__' }],
    };
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
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if ((res.status === 401 || res.status === 403) && onProRequired) {
        onProRequired();
        return;
      }
      if (data.error) throw new Error(data.error);
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: [{ type: 'generated-video', url: data.url, prompt }] },
      ]);
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        {
          role: 'assistant',
          content: [
            {
              type: 'error' as const,
              message: `Video generation failed. Complex scenes can time out — try a simpler description.`,
            },
          ],
        },
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
    // Free AI bypasses limits entirely — only gate Based AI (Claude)
    if (aiModel !== 'free' && subscriptionTier === 'free' && (generationsUsed ?? 0) >= 10) {
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
    setSlowWarning(false);
    slowWarningTimerRef.current = setTimeout(() => setSlowWarning(true), 15000);

    let doneHandled = false;
    let assistantMsg = '';
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // Lazily fetch location once — silently skip if denied or unavailable
      if (!locationRef.current && typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise<void>(resolve => {
          navigator.geolocation.getCurrentPosition(
            pos => {
              locationRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
              resolve();
            },
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
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          messages: newMessages,
          existingFiles: files,
          personality,
          memory,
          globalMemory,
          location: locationRef.current,
          aiModel,
          persona,
        }),
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
      assistantMsg = '';
      let buffer = '';
      let planReceived = false;

      flushSync(() => {
        setMessages(prev => [...prev, { role: 'assistant', content: '... Working' }]);
      });

      try {
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
                  updated[updated.length - 1] = {
                    role: 'assistant',
                    content: '◈ Searching the web...',
                  };
                  return updated;
                });
              }

              if (data.searching === 'crowd') {
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: 'assistant',
                    content: '◈ Checking crowd levels...',
                  };
                  return updated;
                });
              }

              if (data.searching === 'traffic') {
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: 'assistant',
                    content: '◈ Checking traffic conditions...',
                  };
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

              if (data.retrying) {
                assistantMsg = '';
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: '◈ Retrying...' };
                  return updated;
                });
              }

              if (data.plan) {
                planReceived = true;
                flushSync(() => {
                  setGenProgress({
                    files: data.plan,
                    completed: 0,
                    total: data.plan.length,
                    file: '',
                    chunks: 0,
                  });
                });
                const fileNames = (data.plan as { name: string }[]).map(f => f.name).join(', ');
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: 'assistant',
                    content: `⟳ Building ${fileNames}…`,
                  };
                  return updated;
                });
              }

              if (data.status) {
                flushSync(() => {
                  setGenProgress(prev =>
                    prev ? { ...prev, file: data.status.file, chunks: 0 } : null
                  );
                });
              }

              if (data.progress) {
                flushSync(() => {
                  setGenProgress(prev =>
                    prev ? { ...prev, completed: data.progress.current, chunks: 0 } : null
                  );
                });
              }

              if (data.chunk) {
                window.dispatchEvent(
                  new CustomEvent('debug-event', { detail: { type: 'chunk', data: data.chunk } })
                );
                assistantMsg += data.chunk;
                setGenProgress(prev =>
                  prev && prev.file ? { ...prev, chunks: prev.chunks + 1 } : prev
                );
                const hasForge =
                  assistantMsg.includes('<forge_file') || assistantMsg.includes('<forge_type');
                if (!planReceived && !hasForge) {
                  setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: 'assistant',
                      content: assistantMsg.trim() || '◈ Working...',
                    };
                    return updated;
                  });
                } else if (hasForge) {
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    const c = typeof last?.content === 'string' ? last.content : '';
                    if (
                      c &&
                      !c.startsWith('⟳') &&
                      !c.startsWith('◈ Searching') &&
                      c !== '◈ Working...'
                    ) {
                      updated[updated.length - 1] = { role: 'assistant', content: '◈ Working...' };
                    }
                    return updated;
                  });
                }
              }

              if (data.clarify) {
                doneHandled = true;
                setIsGenerating(false);
                setGenProgress(null);
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  const hasText =
                    typeof last?.content === 'string' &&
                    last.content.trim() &&
                    last.content !== '◈ Working...' &&
                    !last.content.startsWith('⟳') &&
                    !last.content.startsWith('◈ Searching') &&
                    !last.content.startsWith('◈ Retrying');
                  const clarifyMsg = {
                    role: 'assistant' as const,
                    content: [
                      { type: 'clarify' as const, question: data.question, options: data.options },
                    ],
                  };
                  return hasText ? [...prev, clarifyMsg] : [...prev.slice(0, -1), clarifyMsg];
                });
              }

              if (data.error) {
                window.dispatchEvent(
                  new CustomEvent('debug-event', { detail: { type: 'error', data: data.error } })
                );
                doneHandled = true;
                setIsGenerating(false);
                setGenProgress(null);
                setMessages(prev => [
                  ...prev.slice(0, -1),
                  { role: 'assistant', content: [{ type: 'error' as const, message: data.error }] },
                ]);
              }

              if (data.done) {
                const resolvedFiles = data.files?.length
                  ? data.files
                  : parseForgeFiles(assistantMsg);
                window.dispatchEvent(
                  new CustomEvent('debug-event', {
                    detail: {
                      type: 'done',
                      data: JSON.stringify({
                        filesCount: resolvedFiles.length,
                        reply: data.reply?.slice(0, 100),
                      }),
                    },
                  })
                );
                doneHandled = true;
                setGenProgress(null);
                setIsGenerating(false);
                setMessages(prev => [
                  ...prev.slice(0, -1),
                  { role: 'assistant', content: data.reply || '✓ Done — check the editor.' },
                ]);
                if (resolvedFiles.length) {
                  onFilesUpdate(resolvedFiles, data.projectType);
                  onGenerationComplete?.();
                  track('generation_complete', {
                    file_count: resolvedFiles.length,
                    project_type: data.projectType,
                    model: data.model,
                  });
                  const count = parseInt(localStorage.getItem('based_build_count') || '0', 10) + 1;
                  localStorage.setItem('based_build_count', String(count));
                  if (
                    count >= 3 &&
                    count % 5 === 0 &&
                    !localStorage.getItem('based_nudge_dismissed')
                  ) {
                    setShowSupportNudge(true);
                  }
                }
                if (data.suggestions?.length) setLastSuggestions(data.suggestions);
                else setLastSuggestions([]);
              }
            } catch (e) {
              window.dispatchEvent(
                new CustomEvent('debug-event', { detail: { type: 'parse-error', data: String(e) } })
              );
            }
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    } catch (e: unknown) {
      setGenProgress(null);
      const eName = e instanceof Error ? e.name : '';
      const eMsg = e instanceof Error ? e.message : '';
      if (eName === 'AbortError' || eMsg === 'limit') {
        // AbortError = user clicked Discard; limit = pricing modal already shown — just clean up
        doneHandled = true;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') return [...prev.slice(0, -1)];
          return prev;
        });
      } else {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: [
              {
                type: 'error' as const,
                message:
                  'Something went wrong on my end — give it another shot. If it keeps happening, tap Report.',
              },
            ],
          },
        ]);
      }
    } finally {
      if (slowWarningTimerRef.current) {
        clearTimeout(slowWarningTimerRef.current);
        slowWarningTimerRef.current = null;
      }
      setSlowWarning(false);
      if (!doneHandled) {
        setGenProgress(null);
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (
            typeof last?.content === 'string' &&
            (last.content === '◈ Working...' ||
              last.content.startsWith('◈ Searching') ||
              last.content.startsWith('⟳') ||
              last.content.startsWith('◈ Retrying'))
          ) {
            return [
              ...prev.slice(0, -1),
              {
                role: 'assistant',
                content: [
                  { type: 'error' as const, message: 'Response was cut off — please try again.' },
                ],
              },
            ];
          }
          return prev;
        });
      }
      setIsGenerating(false);
      if (!incognito) {
        try {
          const finalMessages = [
            ...messages,
            userMsg,
            ...(assistantMsg ? [{ role: 'assistant' as const, content: assistantMsg }] : []),
          ];
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
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: JSON.stringify({ messages: memMessages }),
          });
          const memData = await memRes.json();
          if (memData.memory) {
            window.dispatchEvent(new CustomEvent('memory-updated'));
          }
        } catch {}
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

  function renderContent(content: string | ContentBlock[], msgIdx = 0) {
    if (typeof content === 'string') return <ReactMarkdown>{content}</ReactMarkdown>;
    return (
      <>
        {content.map((block, i) => {
          if (block.type === 'image') {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                className="chat-img-thumb"
                src={`data:${block.mediaType};base64,${block.data}`}
                alt="uploaded image"
              />
            );
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="generated-image" src={block.url} alt={block.prompt} />
                <div className="generated-image-prompt">{block.prompt}</div>
                <div className="generated-image-actions">
                  <a
                    className="generated-image-download"
                    href={block.url}
                    download
                    target="_blank"
                    rel="noreferrer"
                  >
                    ↓ Download
                  </a>
                  <button
                    className="generated-image-edit-btn"
                    onClick={() => setCropImageUrl(block.url)}
                  >
                    ◈ Crop
                  </button>
                  <button
                    className="generated-image-edit-btn"
                    onClick={() => setEditingImageUrl(block.url)}
                  >
                    ✏ Edit
                  </button>
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
          if (block.type === 'error') {
            const reportKey = `${msgIdx}-${i}`;
            const alreadyReported = reportedErrors.has(reportKey);
            return (
              <div key={i} className="chat-error-block">
                <span className="chat-error-icon">!</span>
                <div className="chat-error-body">
                  <div className="chat-error-msg">{block.message}</div>
                  <button
                    className="chat-error-report"
                    disabled={alreadyReported}
                    onClick={async () => {
                      // Ref guard fires synchronously — prevents duplicate submissions
                      // even if the user clicks faster than React re-renders
                      if (reportingInFlight.current.has(reportKey)) return;
                      reportingInFlight.current.add(reportKey);
                      setReportedErrors(prev => new Set(prev).add(reportKey));
                      const recentMsgs = messages.slice(-10);
                      const snapStartIdx = messages.length - recentMsgs.length;
                      const chatSnapshot =
                        recentMsgs.length > 0
                          ? recentMsgs
                              .map((m, relIdx) => {
                                const absIdx = snapStartIdx + relIdx;
                                const text =
                                  typeof m.content === 'string'
                                    ? m.content
                                    : (m.content as Array<{ type: string; text?: string }>)
                                        .filter(b => b.type === 'text')
                                        .map(b => b.text ?? '')
                                        .join('');
                                if (m.role === 'user') {
                                  return `YOU\n${text}`;
                                }
                                const reaction = flaggedSet.has(absIdx)
                                  ? '\n\n⊙ Not what I expected'
                                  : '';
                                return `BASED\n${text}${reaction}`;
                              })
                              .join('\n\n')
                          : '';
                      const errorDetail = [
                        block.prompt ? `PROMPT: ${block.prompt}` : null,
                        block.actualError ? `ACTUAL ERROR: ${block.actualError}` : null,
                      ]
                        .filter(Boolean)
                        .join('\n');
                      const context = [chatSnapshot, errorDetail || block.message]
                        .filter(Boolean)
                        .join('\n\n');
                      await fetch('/api/feedback', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          message: block.message,
                          type: 'image_error',
                          context,
                        }),
                      });
                    }}
                  >
                    {alreadyReported ? t('chat.reported') : t('chat.report')}
                  </button>
                </div>
              </div>
            );
          }
          if (block.type === 'clarify') {
            return (
              <div key={i} className="clarify-card">
                <div className="clarify-question">{block.question}</div>
                <div className="clarify-options">
                  {block.options.map((opt: string) => (
                    <button key={opt} className="clarify-option-btn" onClick={() => send(opt)}>
                      {opt}
                    </button>
                  ))}
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
            <div className="chat-empty-logo" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand-icon-loop.svg" alt="" width={64} height={64} />
            </div>
            <div className="chat-empty-title">BASED</div>
            <div className="chat-empty-sub">{t('chat.empty.subtitle')}</div>
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
                >
                  {s}
                </motion.button>
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
                <div className="message-role">{m.role === 'user' ? t('chat.role.you') : t('chat.role.based')}</div>
                <div className="message-content">
                  {m.role === 'assistant' && isGenerating && i === messages.length - 1 ? (
                    <>
                      <ProgressBar
                        progress={
                          genProgress ?? { files: [], completed: 0, total: 0, file: '', chunks: 0 }
                        }
                        isFree={aiModel === 'free'}
                      />
                      {slowWarning && (
                        <div className="slow-warning">{t('chat.loading.slow')}</div>
                      )}
                    </>
                  ) : (
                    renderContent(m.content, i)
                  )}
                </div>
                {m.role === 'assistant' &&
                  !(isGenerating && i === messages.length - 1) &&
                  !(
                    Array.isArray(m.content) &&
                    m.content.every((b: ContentBlock) => b.type === 'error')
                  ) && (
                    <div className="msg-flag-area">
                      {flaggedSet.has(i) ? (
                        <span className="msg-flag-noted">{t('chat.flag.noted')}</span>
                      ) : flaggingIdx === i ? (
                        <div className="msg-flag-form">
                          <div className="msg-flag-question">{t('chat.flag.expecting')}</div>
                          <div className="msg-flag-chips">
                            {[t('chat.flag.reason1'), t('chat.flag.reason2'), t('chat.flag.reason3'), t('chat.flag.reason4')].map(r => (
                              <button
                                key={r}
                                className={`msg-flag-chip${flagReason === r ? ' active' : ''}`}
                                onClick={() => setFlagReason(prev => (prev === r ? '' : r))}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                          <input
                            className="msg-flag-input"
                            placeholder={t('chat.flag.optional')}
                            value={flagText}
                            onChange={e => setFlagText(e.target.value)}
                          />
                          <div className="msg-flag-actions">
                            <button
                              className="msg-flag-cancel"
                              onClick={() => {
                                setFlaggingIdx(null);
                                setFlagReason('');
                                setFlagText('');
                              }}
                            >
                              {t('chat.flag.cancel')}
                            </button>
                            <button
                              className="msg-flag-send"
                              disabled={flagSending}
                              onClick={() => {
                                const txt =
                                  typeof m.content === 'string'
                                    ? m.content
                                    : (m.content as ContentBlock[])
                                        .filter((b: ContentBlock) => b.type === 'text')
                                        .map(
                                          (b: ContentBlock) =>
                                            (b as Extract<ContentBlock, { type: 'text' }>).text
                                        )
                                        .join(' ');
                                const prev = messages[i - 1];
                                const userTxt =
                                  prev?.role === 'user'
                                    ? typeof prev.content === 'string'
                                      ? prev.content
                                      : (prev.content as ContentBlock[])
                                          .filter((b: ContentBlock) => b.type === 'text')
                                          .map(
                                            (b: ContentBlock) =>
                                              (b as Extract<ContentBlock, { type: 'text' }>).text
                                          )
                                          .join(' ')
                                    : '';
                                submitFlag(i, txt, userTxt);
                              }}
                            >
                              {flagSending ? t('chat.flag.sending') : t('chat.flag.send')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="msg-flag-btn"
                          onClick={() => setFlaggingIdx(i)}
                          title="Not what you expected?"
                        >
                          {t('chat.flag.title')}
                        </button>
                      )}
                    </div>
                  )}
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
                onClick={() => {
                  setLastSuggestions([]);
                  send(s);
                }}
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
          {showSupportNudge && (
            <motion.div
              className="support-nudge"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
            >
              <div className="support-nudge-text">
                <span className="support-nudge-icon">◈</span>
                <span>
                  {t('chat.support.text')}
                </span>
              </div>
              <div className="support-nudge-actions">
                <a
                  href="https://ko-fi.com/basedfund"
                  target="_blank"
                  rel="noreferrer"
                  className="support-nudge-btn"
                  onClick={() => setShowSupportNudge(false)}
                >
                  {t('chat.support.kofi')}
                </a>
                <button
                  className="support-nudge-dismiss"
                  onClick={() => {
                    setShowSupportNudge(false);
                    localStorage.setItem('based_nudge_dismissed', '1');
                  }}
                >
                  {t('chat.support.notNow')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
              {t('chat.discard')}
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="chat-img-thumb" src={pendingImage.previewUrl} alt="pending upload" />
              <button className="img-clear-btn" onClick={clearPendingImage} title="Remove image">
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <div
          className="chat-input-row"
        >
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
            disabled={isGenerating}
            title="Attach image"
          >
            ◆
          </button>
          <ModeDropdown
            mode={generationMode}
            onChange={setGenerationMode}
            subscriptionTier={subscriptionTier}
            onProRequired={onProRequired}
            disabled={isGenerating || isGeneratingMedia}
            onPanelSwitch={onPanelSwitch}
          />
          <button
            type="button"
            className={`voice-btn voice-btn--${micState === 'recording' ? 'listening' : micState === 'transcribing' ? 'activated' : 'idle'}`}
            onClick={toggleMic}
            title={
              micState === 'idle'
                ? 'Press to record — speak, then press again to send'
                : micState === 'recording'
                  ? 'Recording… press to stop and send'
                  : 'Transcribing…'
            }
            disabled={isGenerating || isGeneratingMedia || micState === 'transcribing'}
          >
            {micState === 'transcribing' ? '◉' : '⬡'}
          </button>
          <AnimatePresence>
            {generationMode === 'seedance' && (
              <motion.button
                key="audio-toggle"
                className={`audio-toggle-btn${generateAudio ? ' audio-toggle-btn--on' : ''}`}
                onClick={() => setGenerateAudio(v => !v)}
                title={
                  generateAudio
                    ? 'Audio: on (2× cost) — click to disable'
                    : 'Audio: off — click to enable'
                }
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
            onChange={e => {
              setInput(e.target.value);
              autoResize();
            }}
            onKeyDown={handleKey}
            onTouchStart={e => {
              if (window.innerWidth <= 768) {
                e.preventDefault();
                setMobileInputOpen(true);
                setTimeout(() => mobileTextareaRef.current?.focus(), 50);
              }
            }}
            onFocus={e => {
              if (window.innerWidth <= 768) {
                e.currentTarget.blur();
              }
            }}
            placeholder={
              micState === 'recording'
                ? t('chat.placeholder.recording')
                : micState === 'transcribing'
                  ? t('chat.placeholder.transcribing')
                  : generationMode === 'seedance'
                    ? t('chat.placeholder.video')
                    : generationMode === 'music'
                      ? t('chat.placeholder.music')
                      : generationMode !== 'chat'
                        ? t('chat.placeholder.image')
                        : t('chat.placeholder.default')
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
            {isGeneratingMedia ? (
              <span className="spinner" />
            ) : generationMode !== 'chat' ? (
              t('chat.generate')
            ) : (
              t('chat.send')
            )}
          </motion.button>
        </div>
        {micState === 'recording' && (
          <div className="voice-hint">Recording — press mic again to stop and send</div>
        )}
        {micState === 'transcribing' && <div className="voice-hint">Transcribing your voice…</div>}
      </div>

      {/* Mobile floating prompt overlay */}
      <AnimatePresence>
        {mobileInputOpen && (
          <motion.div
            className="mobile-input-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setMobileInputOpen(false)}
          >
            <motion.div
              className="mobile-input-sheet"
              initial={{ y: -32, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -24, opacity: 0, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 460, damping: 36 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="mobile-input-header">
                <span className="mobile-input-mark">B&gt;</span>
                <span className="mobile-input-label">{t('chat.mobile.header')}</span>
                <button
                  className="mobile-input-close"
                  onClick={() => setMobileInputOpen(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <textarea
                ref={mobileTextareaRef}
                className="mobile-input-textarea"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    setMobileInputOpen(false);
                    if (generationMode === 'seedance') sendVideo();
                    else if (generationMode === 'music') sendMusic();
                    else if (generationMode !== 'chat') sendImage();
                    else send();
                  }
                }}
                placeholder={
                  generationMode === 'seedance'
                    ? t('chat.placeholder.video')
                    : generationMode === 'music'
                      ? t('chat.placeholder.music')
                      : generationMode !== 'chat'
                        ? t('chat.placeholder.image')
                        : t('chat.placeholder.default')
                }
                rows={5}
                autoFocus
              />
              <div className="mobile-input-actions">
                <button className="mobile-input-cancel" onClick={() => setMobileInputOpen(false)}>
                  Cancel
                </button>
                <button
                  className="mobile-input-send"
                  disabled={!input.trim() && !pendingImage}
                  onClick={() => {
                    setMobileInputOpen(false);
                    if (generationMode === 'seedance') sendVideo();
                    else if (generationMode === 'music') sendMusic();
                    else if (generationMode !== 'chat') sendImage();
                    else send();
                  }}
                >
                  → Send
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {editingImageUrl && (
        <ImageEditorModal
          sourceImageUrl={editingImageUrl}
          onConfirm={(resultUrl, confirmedPrompt) => {
            setMessages(prev => [
              ...prev,
              {
                role: 'assistant',
                content: [{ type: 'generated-image', url: resultUrl, prompt: confirmedPrompt }],
              },
            ]);
            setEditingImageUrl(null);
          }}
          onClose={() => setEditingImageUrl(null)}
        />
      )}
      {cropImageUrl && <ImageCropModal url={cropImageUrl} onClose={() => setCropImageUrl(null)} />}
    </div>
  );
}

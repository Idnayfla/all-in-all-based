'use client';
import { useRef, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Message, FileNode, ContentBlock } from '@/app/page';
import SimpleMarkdown from './SimpleMarkdown';
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

function detectIntentMode(text: string): GenerationMode {
  const t = text.toLowerCase().trim();
  if (!t) return 'chat';

  // Infographic/pyramid/ranking → Ideogram — catches all natural-language phrasing variations
  const isStructuredVisual =
    /\b(infographic|pyramid|triangle|tier list|tier chart|ranking chart|visual chart|hierarchy|ranked list|leaderboard)\b/i.test(
      t
    ) ||
    (/\b(rank|ranking|ranked|tier|tiers|category|categories|chart)\b/i.test(t) &&
      /\b(hotels?|restaurants?|brands?|products?|company|companies|logos?|luxury|luxurious)\b/i.test(
        t
      )) ||
    (/(most|least).{0,40}(luxurious|luxury)/i.test(t) &&
      /\b(hotels?|brands?|logos?|restaurants?|ranking)\b/i.test(t)) ||
    (/\blogo(s)?\b/i.test(t) &&
      /\b(hotels?|restaurants?|brands?|luxury|luxurious|rank|ranking|tier|category)\b/i.test(t));
  if (isStructuredVisual) return 'flux';

  // Code/app request → Claude builds it
  const isAppRequest =
    /\b(app|editor|player|tool|builder|website|site|dashboard|game|visualizer|analyzer|portfolio|calculator|tracker|widget|component|page|form|quiz|chatbot)\b/.test(
      t
    ) && /\b(build|make|create|code|develop|program|write)\b/.test(t);
  if (isAppRequest) return 'chat';

  // ── Image intent ──────────────────────────────────────────────────────
  if (/\b(draw|paint|sketch|illustrate)\b/.test(t)) return 'flux';
  if (
    /\b(generate|create|make|render|design|show me|give me|produce)\b/.test(t) &&
    /\b(image|picture|photo|photograph|illustration|artwork|drawing|painting|portrait|banner|thumbnail|wallpaper|poster|cover|headshot|avatar|graphic|visual|art)\b/.test(
      t
    )
  )
    return 'flux';

  // ── Video intent ──────────────────────────────────────────────────────
  if (/\b(animate)\b/.test(t) && !/\b(animation (player|editor|app|tool))\b/.test(t))
    return 'seedance';
  if (
    /\b(generate|create|make|produce|render)\b/.test(t) &&
    /\b(video|animation|clip|film|reel|footage|cinematic)\b/.test(t) &&
    !/\b(video (player|editor|app|tool|streaming|platform))\b/.test(t)
  )
    return 'seedance';

  // ── Music intent ──────────────────────────────────────────────────────
  if (/\b(compose|write\s+a?\s*(song|melody|jingle|tune|beat|track))\b/.test(t)) return 'music';
  if (
    /\b(generate|create|make|produce)\b/.test(t) &&
    /\b(music|song|melody|beat|track|soundtrack|jingle|tune|audio|sound)\b/.test(t) &&
    !/\b(music (player|visualizer|app|editor|tool))\b/.test(t) &&
    !/\b(sound (effects|design))\b/.test(t)
  )
    return 'music';

  return 'chat';
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
  const [pendingImages, setPendingImages] = useState<
    Array<{
      data: string;
      mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      previewUrl: string;
    }>
  >([]);
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
  const [micState, setMicState] = useState<'idle' | 'warming' | 'recording' | 'transcribing'>(
    'idle'
  );
  const [micError, setMicError] = useState('');
  const [micDeviceId, setMicDeviceId] = useState<string>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('mic-device-id') ?? 'default') : 'default'
  );
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [showMicPicker, setShowMicPicker] = useState(false);
  const [mobileInputOpen, setMobileInputOpen] = useState(false);
  const mobileTextareaRef = useRef<HTMLTextAreaElement>(null);
  const recordingStartRef = useRef<number>(0);
  const stopRecordingRef = useRef<boolean>(false);
  const { t, locale } = useTranslation();

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

  const openMicPicker = async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setMicDevices(all.filter(d => d.kind === 'audioinput'));
    setShowMicPicker(true);
  };

  const toggleMic = async () => {
    if (micState === 'recording') {
      // signal stop — handled via ref flag
      stopRecordingRef.current = true;
      return;
    }
    if (micState !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('Mic not supported — use HTTPS or a modern browser');
      setTimeout(() => setMicError(''), 4000);
      return;
    }
    try {
      const baseConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      let stream: MediaStream;
      if (micDeviceId && micDeviceId !== 'default') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { ...baseConstraints, deviceId: { exact: micDeviceId } },
          });
        } catch {
          // device no longer available — fall back to system default
          stream = await navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
      }

      setMicState('warming');
      await new Promise(r => setTimeout(r, 1500)); // AMD/Bluetooth device re-init time

      const mimeType =
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t =>
          MediaRecorder.isTypeSupported(t)
        ) ?? '';
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      const chunks: BlobPart[] = [];
      mr.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      stopRecordingRef.current = false;
      recordingStartRef.current = Date.now();
      setMicState('recording');

      await new Promise<void>(resolve => {
        mr.onstop = () => resolve();
        mr.start(250);
        const check = setInterval(() => {
          if (stopRecordingRef.current) {
            clearInterval(check);
            mr.stop();
          }
        }, 50);
      });

      stream.getTracks().forEach(t => t.stop());

      const duration = Date.now() - recordingStartRef.current;
      if (duration < 800 || chunks.length === 0) {
        setMicState('idle');
        return;
      }

      setMicState('transcribing');
      try {
        const finalMime = mr.mimeType || mimeType || 'audio/webm';
        const ext = finalMime.includes('ogg') ? 'ogg' : finalMime.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: finalMime });
        const form = new FormData();
        form.append('audio', blob, `recording.${ext}`);
        form.append('locale', locale);
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          body: form,
        });
        const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!res.ok || json.error) {
          const msg = json.error ?? `Transcription failed (${res.status})`;
          setMicError(msg);
          setTimeout(() => setMicError(''), 6000);
        } else if (json.text?.trim()) {
          const trimmed = json.text.trim();
          setInput(prev => (prev ? prev + ' ' + trimmed : trimmed));
          setTimeout(() => {
            const ta = mobileTextareaRef.current ?? textareaRef.current;
            ta?.focus();
          }, 0);
        } else {
          setMicError('No speech detected — try speaking closer to the mic');
          setTimeout(() => setMicError(''), 4000);
        }
      } catch {
        setMicError('Could not reach transcription service — check your connection');
        setTimeout(() => setMicError(''), 6000);
      } finally {
        setMicState('idle');
      }
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      setMicState('idle');
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setMicError(
          'Mic blocked — open site settings (lock icon) and set Microphone to Allow, then refresh'
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setMicError('No microphone found — check it is plugged in or enabled');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setMicError('Mic in use by another app — close it and try again');
      } else {
        setMicError('Could not access mic — try again');
      }
      setTimeout(() => setMicError(''), 5000);
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

  const processImageFile = (
    file: File
  ): Promise<{
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    previewUrl: string;
  }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target?.result as string;
        if (file.type === 'image/gif') {
          const [, data] = dataUrl.split(',');
          resolve({ data, mediaType: 'image/gif', previewUrl: dataUrl });
          return;
        }
        const img = new window.Image();
        img.onload = () => {
          const MAX = 1568;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) {
              height = Math.round((height * MAX) / width);
              width = MAX;
            } else {
              width = Math.round((width * MAX) / height);
              height = MAX;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.85);
          const [, data] = compressed.split(',');
          resolve({ data, mediaType: 'image/jpeg', previewUrl: compressed });
        };
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = dataUrl;
      };
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const MAX_IMAGES = 4;
    const selected = Array.from(files).slice(0, MAX_IMAGES);
    Promise.all(selected.map(processImageFile))
      .then(results => {
        setPendingImages(prev => [...prev, ...results].slice(0, MAX_IMAGES));
      })
      .catch(err => console.error('[Based] image processing failed:', err));
    e.target.value = '';
  };

  const clearPendingImage = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
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
    const firstImage = pendingImages[0];
    if (firstImage) {
      body.sourceImageData = firstImage.data;
      body.sourceMediaType = firstImage.mediaType;
    }
    setPendingImages([]);

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
        // Remove the loading placeholder before opening the paywall so the
        // chat doesn't get permanently stuck showing "Generating image…"
        setMessages(prev => prev.slice(0, -1));
        if (onProRequired) onProRequired();
        return;
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
        setMessages(prev => prev.slice(0, -1));
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
    const firstImage = pendingImages[0];
    if (firstImage) {
      body.imageData = firstImage.data;
      body.mediaType = firstImage.mediaType;
    }
    setPendingImages([]);

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
        setMessages(prev => prev.slice(0, -1));
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
    if (!trimmed && pendingImages.length === 0) return;
    if (isGenerating) return;

    // Client-side pre-check so limit modal shows even if server count is stale
    // Free AI bypasses limits entirely — only gate Based AI (Claude)
    if (aiModel !== 'free' && subscriptionTier === 'free' && (generationsUsed ?? 0) >= 10) {
      window.dispatchEvent(new CustomEvent('generation-limit-reached'));
      return;
    }

    const messageContent: Message['content'] =
      pendingImages.length > 0
        ? [
            ...pendingImages.map(img => ({
              type: 'image' as const,
              mediaType: img.mediaType,
              data: img.data,
            })),
            ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
          ]
        : trimmed;

    setInput('');
    setPendingImages([]);
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

      track('generation_started');

      // Strip base64 image data from all but the most recent image-bearing message.
      // The server only uses the last image anyway — keeping old ones re-sends MBs each turn.
      const msgsForApi = (() => {
        let kept = false;
        return [...newMessages]
          .reverse()
          .map(msg => {
            if (!Array.isArray(msg.content)) return msg;
            const hasImg = (msg.content as Array<{ type: string }>).some(b => b.type === 'image');
            if (!hasImg) return msg;
            if (!kept) {
              kept = true;
              return msg;
            } // keep most recent image intact
            return {
              ...msg,
              content: (msg.content as Array<{ type: string; text?: string }>).map(b =>
                b.type === 'image' ? { type: 'text' as const, text: '[reference image]' } : b
              ),
            };
          })
          .reverse();
      })();

      const res = await fetch('/api/generate', {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          messages: msgsForApi,
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
      if (!res.ok) {
        // Surface the server's reason (e.g. provider/config error) so prod
        // failures are diagnosable instead of a blanket "something went wrong".
        let serverMsg = '';
        try {
          const body = await res.clone().json();
          serverMsg = body?.error || body?.reply || '';
        } catch {}
        throw new Error(serverMsg || `API error (${res.status})`);
      }
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

              if (data.planning === true) {
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: '◈ Planning...' };
                  return updated;
                });
              }

              if (data.planning === false) {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.content === '◈ Planning...') {
                    updated[updated.length - 1] = { role: 'assistant', content: '◈ Working...' };
                  }
                  return updated;
                });
              }

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
                  {
                    role: 'assistant',
                    content: [
                      {
                        type: 'error' as const,
                        message:
                          typeof data.error === 'string'
                            ? data.error
                            : data.error?.message
                              ? String(data.error.message)
                              : JSON.stringify(data.error),
                      },
                    ],
                  },
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
        // Prefer the server's reason when it gave one; fall back to the
        // friendly generic for opaque network/parse failures.
        const isNetworkError =
          !eMsg ||
          eMsg === 'API error' ||
          eMsg === 'Failed to fetch' ||
          eMsg === 'No stream' ||
          eName === 'TypeError';
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: [
              {
                type: 'error' as const,
                message: isNetworkError
                  ? 'Something went wrong on my end — give it another shot. If it keeps happening, tap Report.'
                  : eMsg,
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

  const handleSend = () => {
    const t = input.trim();

    // Respect manually selected non-chat modes
    if (generationMode === 'seedance') {
      sendVideo();
      return;
    }
    if (generationMode === 'music') {
      sendMusic();
      return;
    }
    if (generationMode !== 'chat') {
      sendImage();
      return;
    }

    // Auto-detect intent when in default chat mode
    const detected = detectIntentMode(t);
    if (detected === 'flux') {
      setGenerationMode('flux');
      sendImage();
    } else if (detected === 'seedance') {
      setGenerationMode('seedance');
      sendVideo();
    } else if (detected === 'music') {
      setGenerationMode('music');
      sendMusic();
    } else {
      send();
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  function renderContent(content: string | ContentBlock[], msgIdx = 0) {
    if (typeof content === 'string') return <SimpleMarkdown>{content}</SimpleMarkdown>;
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
            return <SimpleMarkdown key={i}>{block.text}</SimpleMarkdown>;
          }
          return null;
        })}
      </>
    );
  }

  const genLeft = 10 - Math.min(generationsUsed ?? 0, 10);

  return (
    <div className="chat-panel">
      {subscriptionTier === 'free' &&
        (generationsUsed ?? 0) >= 7 &&
        (generationsUsed ?? 0) < 10 && (
          <div className={`gen-warning-banner${genLeft <= 1 ? ' gen-warning-banner--danger' : ''}`}>
            <span>
              {genLeft} generation{genLeft === 1 ? '' : 's'} left this month
            </span>
            {onProRequired && (
              <button className="gen-warning-upgrade" onClick={onProRequired}>
                Go Pro →
              </button>
            )}
          </div>
        )}
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
                  onClick={() => {
                    setInput(s);
                    if (window.innerWidth <= 768) {
                      setMobileInputOpen(true);
                      setTimeout(() => mobileTextareaRef.current?.focus(), 50);
                    } else {
                      setTimeout(() => textareaRef.current?.focus(), 0);
                    }
                  }}
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
                <div className="message-role">
                  {m.role === 'user' ? t('chat.role.you') : t('chat.role.based')}
                </div>
                <div className="message-content">
                  {m.role === 'assistant' && isGenerating && i === messages.length - 1 ? (
                    <>
                      <ProgressBar
                        progress={
                          genProgress ?? { files: [], completed: 0, total: 0, file: '', chunks: 0 }
                        }
                        isFree={aiModel === 'free'}
                      />
                      {slowWarning && <div className="slow-warning">{t('chat.loading.slow')}</div>}
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
                            {[
                              t('chat.flag.reason1'),
                              t('chat.flag.reason2'),
                              t('chat.flag.reason3'),
                              t('chat.flag.reason4'),
                            ].map(r => (
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
                <span>{t('chat.support.text')}</span>
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
          {(isGenerating || isGeneratingMedia) && (
            <motion.button
              className="discard-btn"
              onClick={() => {
                if (isGenerating) {
                  discardGeneration();
                } else {
                  // For media generation, remove the pending loading message and clear state
                  setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (
                      last?.role === 'assistant' &&
                      Array.isArray(last.content) &&
                      (last.content as Array<{ type: string; text?: string }>).some(
                        b =>
                          b.type === 'text' &&
                          (b.text === '__generating-image__' ||
                            b.text === '__generating-video__' ||
                            b.text === '__generating-music__')
                      )
                    ) {
                      return prev.slice(0, -1);
                    }
                    return prev;
                  });
                  setIsGeneratingMedia(false);
                }
              }}
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
          {pendingImages.length > 0 && (
            <motion.div
              className="chat-image-preview"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
            >
              {pendingImages.map((img, idx) => (
                <div key={idx} style={{ position: 'relative', display: 'inline-block' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="chat-img-thumb" src={img.previewUrl} alt="pending upload" />
                  <button
                    className="img-clear-btn"
                    onClick={() => clearPendingImage(idx)}
                    title="Remove image"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="chat-input-row">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
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
          <div className="voice-btn-wrap">
            <button
              type="button"
              className={`voice-btn voice-btn--${micState === 'recording' ? 'listening' : micState === 'transcribing' || micState === 'warming' ? 'activated' : 'idle'}`}
              onClick={toggleMic}
              title={
                micState === 'idle'
                  ? 'Press to record — speak, then press again to send'
                  : micState === 'warming'
                    ? 'Warming up mic…'
                    : micState === 'recording'
                      ? 'Recording… press to stop and send'
                      : 'Transcribing…'
              }
              disabled={
                isGenerating ||
                isGeneratingMedia ||
                micState === 'transcribing' ||
                micState === 'warming'
              }
            >
              {micState === 'transcribing' || micState === 'warming' ? '◉' : '⬡'}
            </button>
            <button
              className="mic-picker-btn"
              onClick={openMicPicker}
              title="Select microphone"
              aria-label="Select microphone"
            >
              ·
            </button>
            {showMicPicker && (
              <div className="mic-picker-dropdown">
                <div className="mic-picker-header">Select microphone</div>
                {micDevices.map(d => (
                  <button
                    key={d.deviceId}
                    className={`mic-picker-option${micDeviceId === d.deviceId ? ' mic-picker-option--active' : ''}`}
                    onClick={() => {
                      setMicDeviceId(d.deviceId);
                      localStorage.setItem('mic-device-id', d.deviceId);
                      setShowMicPicker(false);
                    }}
                  >
                    {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
                  </button>
                ))}
                <button className="mic-picker-close" onClick={() => setShowMicPicker(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
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
              micState === 'warming'
                ? 'Warming up mic…'
                : micState === 'recording'
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
            onClick={handleSend}
            disabled={
              isGenerating || isGeneratingMedia || (!input.trim() && pendingImages.length === 0)
            }
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
        {micState === 'warming' && (
          <div className="voice-hint">Warming up mic — ready in a moment…</div>
        )}
        {micState === 'recording' && (
          <div className="voice-hint">Recording — press mic again to stop and send</div>
        )}
        {micState === 'transcribing' && <div className="voice-hint">Transcribing your voice…</div>}
        {micError && <div className="voice-hint voice-hint--error">{micError}</div>}
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
                    handleSend();
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
                  disabled={!input.trim() && pendingImages.length === 0}
                  onClick={() => {
                    setMobileInputOpen(false);
                    handleSend();
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

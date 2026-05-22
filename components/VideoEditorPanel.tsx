'use client';
import { useRef, useState, useEffect, useCallback } from 'react';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  startTime: number;
  endTime: number;
  fontSize: number;
  color: string;
  fontWeight: 'normal' | 'bold';
}

const FFMPEG_CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js';
const FFMPEG_WASM = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm';
const THUMB_COUNT = 20;
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

interface VideoEditorPanelProps {
  authToken?: string;
}

export default function VideoEditorPanel({ authToken }: VideoEditorPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [thumbsReady, setThumbsReady] = useState(false);
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [selOverlay, setSelOverlay] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [procStatus, setProcStatus] = useState('');
  const [exportUrl, setExportUrl] = useState('');
  const [aiInput, setAiInput] = useState('');

  // dragging state stored in refs to avoid stale closures in event listeners
  const draggingRef = useRef<'start' | 'end' | 'head' | null>(null);
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(0);
  const durationRef = useRef(0);
  const canvasDragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);

  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiMessage, setAiMessage] = useState('');

  // Full undo stack: overlays + trim + speed
  interface UndoSnap {
    overlays: TextOverlay[];
    trimStart: number;
    trimEnd: number;
    speed: number;
  }
  const undoStack = useRef<UndoSnap[]>([]);
  const pushUndo = useCallback((snap: TextOverlay[]) => {
    undoStack.current = [
      ...undoStack.current.slice(-29),
      {
        overlays: snap.map(o => ({ ...o })),
        trimStart: trimStartRef.current,
        trimEnd: trimEndRef.current,
        speed: 1,
      },
    ];
  }, []);
  const pushFullUndo = useCallback((overl: TextOverlay[], ts: number, te: number, sp: number) => {
    undoStack.current = [
      ...undoStack.current.slice(-29),
      { overlays: overl.map(o => ({ ...o })), trimStart: ts, trimEnd: te, speed: sp },
    ];
  }, []);
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setOverlays(prev.overlays);
    setTrimStart(prev.trimStart);
    trimStartRef.current = prev.trimStart;
    setTrimEnd(prev.trimEnd);
    trimEndRef.current = prev.trimEnd;
    setSpeed(prev.speed);
    if (videoRef.current) videoRef.current.playbackRate = prev.speed;
  }, []);

  // Keep refs in sync with state
  useEffect(() => {
    trimStartRef.current = trimStart;
  }, [trimStart]);
  useEffect(() => {
    trimEndRef.current = trimEnd;
  }, [trimEnd]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // ── Load video ────────────────────────────────────────────────────────────
  const loadVideo = (file: File) => {
    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(url);
    setExportUrl('');
    setOverlays([]);
    setThumbs([]);
    setThumbsReady(false);
    setCurrentTime(0);
    setSpeed(1);
    undoStack.current = [];
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('video/')) loadVideo(file);
  };

  const onMetadata = () => {
    const v = videoRef.current!;
    const dur = v.duration;
    setDuration(dur);
    setTrimStart(0);
    setTrimEnd(dur);
    generateThumbs(v, dur);
  };

  const onTimeUpdate = () => setCurrentTime(videoRef.current?.currentTime ?? 0);

  const onEnded = () => {
    const v = videoRef.current;
    if (!v) return;
    if (loop) {
      v.currentTime = trimStartRef.current;
      v.play();
    } else setPlaying(false);
  };

  // Seek helper — works without stale closure issues
  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(durationRef.current || duration, t));
    v.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime >= trimEndRef.current) v.currentTime = trimStartRef.current;
      v.play();
    } else {
      v.pause();
    }
  };

  const stepFrame = (dir: -1 | 1) => seekTo((videoRef.current?.currentTime ?? 0) + dir / 30);

  // Enforce trim-end during playback
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const check = () => {
      if (v.currentTime >= trimEndRef.current) {
        v.pause();
        if (loop) {
          v.currentTime = trimStartRef.current;
          v.play();
        } else setPlaying(false);
      }
    };
    v.addEventListener('timeupdate', check);
    return () => v.removeEventListener('timeupdate', check);
  }, [loop]);

  // Sync volume + mute
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted]);

  // Sync speed
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  // ── Thumbnails ────────────────────────────────────────────────────────────
  const generateThumbs = async (video: HTMLVideoElement, dur: number) => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 68;
    const ctx = c.getContext('2d')!;
    const results: string[] = [];
    for (let i = 0; i < THUMB_COUNT; i++) {
      await new Promise<void>(res => {
        video.currentTime = (i / (THUMB_COUNT - 1)) * dur;
        video.onseeked = () => {
          ctx.drawImage(video, 0, 0, 120, 68);
          results.push(c.toDataURL('image/jpeg', 0.5));
          res();
        };
      });
    }
    video.currentTime = 0;
    video.onseeked = null;
    setThumbs(results);
    setThumbsReady(true);
  };

  // ── Timeline helpers ──────────────────────────────────────────────────────
  const timelineXToTime = useCallback((clientX: number): number => {
    const r = timelineRef.current?.getBoundingClientRect();
    if (!r || !durationRef.current) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * durationRef.current;
  }, []);

  const pct = (t: number) => (durationRef.current ? `${(t / durationRef.current) * 100}%` : '0%');

  // Click on timeline background → seek (only when not coming off a handle drag)
  const onTimelineClick = (e: React.MouseEvent) => {
    if (draggingRef.current) return;
    seekTo(timelineXToTime(e.clientX));
  };

  const onHandleMouseDown = (e: React.MouseEvent, handle: 'start' | 'end' | 'head') => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = handle;
  };

  // Global mouse/touch move + up for all dragging
  useEffect(() => {
    const move = (e: MouseEvent | TouchEvent) => {
      if (!draggingRef.current) return;
      const clientX =
        'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const t = timelineXToTime(clientX);
      if (draggingRef.current === 'start') {
        const clamped = Math.max(0, Math.min(t, trimEndRef.current - 0.1));
        trimStartRef.current = clamped;
        setTrimStart(clamped);
      }
      if (draggingRef.current === 'end') {
        const clamped = Math.max(trimStartRef.current + 0.1, Math.min(t, durationRef.current));
        trimEndRef.current = clamped;
        setTrimEnd(clamped);
      }
      if (draggingRef.current === 'head') seekTo(t);
    };
    const up = () => {
      draggingRef.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [timelineXToTime]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoUrl) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const v = videoRef.current;
      if (!v) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seekTo(v.currentTime - (e.shiftKey ? 10 : 5));
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        seekTo(v.currentTime + (e.shiftKey ? 10 : 5));
      }
      if (e.key === ',') stepFrame(-1);
      if (e.key === '.') stepFrame(1);
      if (e.key === 'm' || e.key === 'M') setMuted(m => !m);
      if (e.key === 'l' || e.key === 'L') setLoop(l => !l);
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [videoUrl, undo]);

  // ── Canvas: render text overlays ──────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    let raf = 0;

    const drawFrame = () => {
      const vw = v.videoWidth || v.offsetWidth;
      const vh = v.videoHeight || v.offsetHeight;
      if (c.width !== vw || c.height !== vh) {
        c.width = vw;
        c.height = vh;
      }
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      const t = v.currentTime;
      overlays
        .filter(o => t >= o.startTime && t <= o.endTime)
        .forEach(o => {
          ctx.save();
          ctx.font = `${o.fontWeight} ${o.fontSize}px system-ui, sans-serif`;
          ctx.fillStyle = o.color;
          ctx.shadowColor = 'rgba(0,0,0,0.85)';
          ctx.shadowBlur = 6;
          ctx.fillText(o.text, o.x * c.width, o.y * c.height);
          if (selOverlay === o.id) {
            const w = ctx.measureText(o.text).width;
            ctx.strokeStyle = 'rgba(96,165,250,0.9)';
            ctx.lineWidth = 2;
            ctx.shadowBlur = 0;
            ctx.strokeRect(
              o.x * c.width - 6,
              o.y * c.height - o.fontSize - 4,
              w + 12,
              o.fontSize + 14
            );
          }
          ctx.restore();
        });
    };

    // Only run rAF loop while playing — pause = static frame, no GPU drain
    const onPlay = () => {
      const loop = () => {
        drawFrame();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };
    const onPause = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      drawFrame();
    };

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', drawFrame);

    drawFrame();
    if (!v.paused) onPlay();

    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', drawFrame);
    };
  }, [overlays, selOverlay]);

  // ── Canvas click/drag: select and reposition text overlays ────────────────
  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    const v = videoRef.current;
    if (!c || !v) return;
    const rect = c.getBoundingClientRect();
    const scaleX = c.width / rect.width;
    const scaleY = c.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const t = v.currentTime;
    const ctx = c.getContext('2d')!;

    // Hit-test visible overlays in reverse (topmost first)
    const visible = overlays.filter(o => t >= o.startTime && t <= o.endTime);
    for (let i = visible.length - 1; i >= 0; i--) {
      const o = visible[i];
      ctx.font = `${o.fontWeight} ${o.fontSize}px system-ui, sans-serif`;
      const w = ctx.measureText(o.text).width;
      const ox = o.x * c.width;
      const oy = o.y * c.height;
      if (mx >= ox - 6 && mx <= ox + w + 6 && my >= oy - o.fontSize - 4 && my <= oy + 14) {
        setSelOverlay(o.id);
        canvasDragRef.current = { id: o.id, offX: mx - ox, offY: my - oy };
        return;
      }
    }
    setSelOverlay(null);
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onMove = (e: MouseEvent) => {
      if (!canvasDragRef.current) return;
      const rect = c.getBoundingClientRect();
      const nx =
        ((e.clientX - rect.left) * (c.width / rect.width) - canvasDragRef.current.offX) / c.width;
      const ny =
        ((e.clientY - rect.top) * (c.height / rect.height) - canvasDragRef.current.offY) / c.height;
      setOverlays(prev =>
        prev.map(o =>
          o.id === canvasDragRef.current!.id
            ? { ...o, x: Math.max(0, Math.min(1, nx)), y: Math.max(0.05, Math.min(0.98, ny)) }
            : o
        )
      );
    };
    const onUp = () => {
      canvasDragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── Overlay CRUD ──────────────────────────────────────────────────────────
  const addOverlay = () => {
    pushUndo(overlays);
    const id = Date.now().toString();
    const now = videoRef.current?.currentTime ?? trimStart;
    setOverlays(prev => [
      ...prev,
      {
        id,
        text: 'New Text',
        x: 0.05,
        y: 0.15,
        startTime: now,
        endTime: Math.min(now + 3, trimEnd),
        fontSize: 56,
        color: '#ffffff',
        fontWeight: 'bold',
      },
    ]);
    setSelOverlay(id);
  };

  const updateOverlay = (id: string, patch: Partial<TextOverlay>) =>
    setOverlays(prev => prev.map(o => (o.id === id ? { ...o, ...patch } : o)));

  const deleteOverlay = (id: string) => {
    pushUndo(overlays);
    setOverlays(prev => prev.filter(o => o.id !== id));
    if (selOverlay === id) setSelOverlay(null);
  };

  // ── AI command — powered by Claude ───────────────────────────────────────
  const applyAI = async () => {
    const cmd = aiInput.trim();
    if (!cmd) return;
    setAiProcessing(true);
    setAiMessage('');
    try {
      const res = await fetch('/api/video-command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ command: cmd, duration }),
      });
      const data = await res.json();
      if (data.message) setAiMessage(data.message);

      const currentOverlays = overlays;
      let newOverlays = [...currentOverlays];
      let newTrimStart = trimStartRef.current;
      let newTrimEnd = trimEndRef.current;
      let newSpeed = speed;

      for (const action of data.actions ?? []) {
        if (action.type === 'trim') {
          newTrimStart = Math.max(0, action.start);
          newTrimEnd = Math.min(duration, action.end);
        } else if (action.type === 'trimStart') {
          newTrimStart = 0;
          newTrimEnd = Math.min(duration, action.seconds);
        } else if (action.type === 'speed') {
          newSpeed = Math.max(0.25, Math.min(4, action.value));
          if (videoRef.current) videoRef.current.playbackRate = newSpeed;
        } else if (action.type === 'addText') {
          const id = Date.now().toString() + Math.random();
          const start = action.at ?? 0;
          newOverlays = [
            ...newOverlays,
            {
              id,
              text: action.text,
              x: action.x ?? 0.05,
              y: action.y ?? 0.15,
              startTime: start,
              endTime: Math.min(start + (action.duration ?? 3), duration),
              fontSize: action.fontSize ?? 56,
              color: action.color ?? '#ffffff',
              fontWeight: 'bold',
            },
          ];
          setSelOverlay(id);
        } else if (action.type === 'removeText') {
          newOverlays = [];
        } else if (action.type === 'mute') {
          setMuted(action.value);
        } else if (action.type === 'loop') {
          setLoop(action.value);
        } else if (action.type === 'reset') {
          newTrimStart = 0;
          newTrimEnd = duration;
        }
      }

      if ((data.actions ?? []).length > 0) {
        pushFullUndo(currentOverlays, trimStartRef.current, trimEndRef.current, speed);
        setOverlays(newOverlays);
        setTrimStart(newTrimStart);
        trimStartRef.current = newTrimStart;
        setTrimEnd(newTrimEnd);
        trimEndRef.current = newTrimEnd;
        setSpeed(newSpeed);
        setAiInput('');
      }
    } catch {
      setAiMessage('Could not reach AI — check connection.');
    } finally {
      setAiProcessing(false);
    }
  };

  // ── FFmpeg export ─────────────────────────────────────────────────────────
  const exportVideo = async () => {
    if (!videoFile) return;
    setProcessing(true);
    setExportUrl('');
    try {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { fetchFile } = await import('@ffmpeg/util');
      if (!ffmpegRef.current) {
        setProcStatus('Loading FFmpeg…');
        const ff = new FFmpeg();
        ff.on('log', ({ message }: { message: string }) => setProcStatus(message.slice(0, 80)));
        await ff.load({ coreURL: FFMPEG_CORE, wasmURL: FFMPEG_WASM });
        ffmpegRef.current = ff;
      }
      const ff = ffmpegRef.current;
      setProcStatus('Writing file…');
      await ff.writeFile('input.mp4', await fetchFile(videoFile));

      const args: string[] = ['-i', 'input.mp4', '-ss', String(trimStart), '-to', String(trimEnd)];

      const textFilters = overlays.map(
        o =>
          `drawtext=text='${o.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}':x=${Math.round(o.x * 1280)}:y=${Math.round(o.y * 720)}:fontsize=${o.fontSize}:fontcolor=${o.color}:enable='between(t\\,${o.startTime}\\,${o.endTime})'`
      );

      if (speed !== 1) {
        const vfParts = [`setpts=${(1 / speed).toFixed(4)}*PTS`, ...textFilters];
        args.push(
          '-vf',
          vfParts.join(','),
          '-af',
          `atempo=${Math.min(2, Math.max(0.5, speed))}`,
          '-c:v',
          'libx264',
          '-c:a',
          'aac'
        );
      } else if (overlays.length) {
        args.push('-vf', textFilters.join(','), '-c:a', 'copy');
      } else {
        args.push('-c', 'copy');
      }

      if (muted) args.push('-an');
      args.push('output.mp4');

      setProcStatus('Processing…');
      await ff.exec(args);
      setProcStatus('Reading output…');
      const data = await ff.readFile('output.mp4');
      const blobData = data instanceof Uint8Array ? data.buffer.slice(0) : data;
      setExportUrl(URL.createObjectURL(new Blob([blobData as ArrayBuffer], { type: 'video/mp4' })));
      setProcStatus('Done');
    } catch (err: unknown) {
      setProcStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProcessing(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fmt = (s: number) => {
    if (!isFinite(s)) return '0:00.0';
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return `${m}:${parseFloat(sec) < 10 ? '0' : ''}${sec}`;
  };

  const sel = overlays.find(o => o.id === selOverlay);

  // ── Upload screen ─────────────────────────────────────────────────────────
  if (!videoUrl)
    return (
      <div className="ve-panel">
        <div className="ve-header">
          <span>⬡ Video Editor</span>
        </div>
        <div
          className="ve-upload"
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => document.getElementById('ve-file-input')?.click()}
        >
          <div className="ve-upload-icon">▸</div>
          <div className="ve-upload-title">Drop a video here</div>
          <div className="ve-upload-sub">or click to browse · MP4, MOV, WebM</div>
          <div className="ve-upload-shortcuts">
            Space · play/pause &nbsp;·&nbsp; ← → · seek 5s &nbsp;·&nbsp; , . · frame step
            &nbsp;·&nbsp; M · mute &nbsp;·&nbsp; Ctrl+Z · undo
          </div>
          <input
            id="ve-file-input"
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) loadVideo(f);
            }}
          />
        </div>
      </div>
    );

  return (
    <div className="ve-panel">
      <div className="ve-header">
        <span>⬡ Video Editor</span>
        <div className="ve-header-actions">
          <button
            className="ve-btn ve-btn-sm"
            onClick={() => {
              setVideoUrl('');
              setVideoFile(null);
            }}
          >
            ← New
          </button>
          <button className="ve-btn ve-btn-primary" onClick={exportVideo} disabled={processing}>
            {processing ? `◈ ${procStatus}` : '↓ Export MP4'}
          </button>
          {exportUrl && (
            <a className="ve-btn ve-btn-success" href={exportUrl} download="based-edit.mp4">
              ↓ Download
            </a>
          )}
        </div>
      </div>

      <div className="ve-workspace">
        {/* Video + overlay canvas */}
        <div className="ve-player-wrap">
          <video
            ref={videoRef}
            src={videoUrl}
            className="ve-video"
            onLoadedMetadata={onMetadata}
            onTimeUpdate={onTimeUpdate}
            onEnded={onEnded}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            playsInline
          />
          <canvas ref={canvasRef} className="ve-canvas-overlay" onMouseDown={onCanvasMouseDown} />
        </div>

        {/* Right panel: text overlays */}
        <div className="ve-side">
          <div className="ve-side-title">
            Text Overlays
            <div style={{ display: 'flex', gap: 4 }}>
              {undoStack.current.length > 0 && (
                <button className="ve-btn ve-btn-sm" onClick={undo} title="Undo (Ctrl+Z)">
                  ↩
                </button>
              )}
              <button className="ve-btn ve-btn-sm" onClick={addOverlay}>
                + Add
              </button>
            </div>
          </div>

          <div className="ve-overlay-list">
            {overlays.length === 0 && (
              <div className="ve-overlay-empty">
                No overlays yet · click + Add, then drag text on the video to reposition
              </div>
            )}
            {overlays.map(o => (
              <div
                key={o.id}
                className={`ve-overlay-item${selOverlay === o.id ? ' selected' : ''}`}
                onClick={() => {
                  setSelOverlay(o.id);
                  seekTo(o.startTime);
                }}
              >
                <span className="ve-overlay-swatch" style={{ background: o.color }} />
                <span className="ve-overlay-text">{o.text}</span>
                <span className="ve-overlay-time">
                  {fmt(o.startTime)}–{fmt(o.endTime)}
                </span>
                <button
                  className="ve-overlay-del"
                  onClick={e => {
                    e.stopPropagation();
                    deleteOverlay(o.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {sel && (
            <div className="ve-overlay-editor">
              <label className="ve-label">Text</label>
              <input
                className="ve-input"
                value={sel.text}
                onChange={e => updateOverlay(sel.id, { text: e.target.value })}
              />

              <div className="ve-row">
                <div className="ve-field">
                  <label className="ve-label">Start (s)</label>
                  <input
                    className="ve-input ve-input-sm"
                    type="number"
                    step="0.1"
                    value={sel.startTime.toFixed(1)}
                    onChange={e =>
                      updateOverlay(sel.id, { startTime: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>
                <div className="ve-field">
                  <label className="ve-label">End (s)</label>
                  <input
                    className="ve-input ve-input-sm"
                    type="number"
                    step="0.1"
                    value={sel.endTime.toFixed(1)}
                    onChange={e =>
                      updateOverlay(sel.id, { endTime: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>

              <div className="ve-row">
                <div className="ve-field">
                  <label className="ve-label">Size</label>
                  <input
                    className="ve-input ve-input-sm"
                    type="number"
                    min="8"
                    max="200"
                    value={sel.fontSize}
                    onChange={e =>
                      updateOverlay(sel.id, { fontSize: parseInt(e.target.value) || 56 })
                    }
                  />
                </div>
                <div className="ve-field">
                  <label className="ve-label">Color</label>
                  <input
                    type="color"
                    value={sel.color}
                    onChange={e => updateOverlay(sel.id, { color: e.target.value })}
                    className="ve-color"
                  />
                </div>
              </div>

              <div className="ve-row">
                <div className="ve-field">
                  <label className="ve-label">X (0–1)</label>
                  <input
                    className="ve-input ve-input-sm"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={sel.x.toFixed(2)}
                    onChange={e => updateOverlay(sel.id, { x: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="ve-field">
                  <label className="ve-label">Y (0–1)</label>
                  <input
                    className="ve-input ve-input-sm"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={sel.y.toFixed(2)}
                    onChange={e => updateOverlay(sel.id, { y: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <label className="ve-label" style={{ marginTop: 2 }}>
                Style
              </label>
              <div className="ve-row">
                <button
                  className={`ve-btn ve-btn-sm${sel.fontWeight === 'bold' ? ' ve-btn-primary' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => updateOverlay(sel.id, { fontWeight: 'bold' })}
                >
                  Bold
                </button>
                <button
                  className={`ve-btn ve-btn-sm${sel.fontWeight === 'normal' ? ' ve-btn-primary' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => updateOverlay(sel.id, { fontWeight: 'normal' })}
                >
                  Normal
                </button>
              </div>

              <button className="ve-delete-overlay-btn" onClick={() => deleteOverlay(sel.id)}>
                Delete overlay
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Playback controls — row 1: transport */}
      <div className="ve-controls">
        <div className="ve-controls-row">
          <button
            className="ve-play-btn"
            onClick={() => seekTo(trimStart)}
            title="Go to trim start"
          >
            ⏮
          </button>
          <button className="ve-play-btn" onClick={() => stepFrame(-1)} title=", — prev frame">
            ‹
          </button>
          <button className="ve-play-btn ve-play-main" onClick={togglePlay} title="Space">
            {playing ? '⏸' : '▶'}
          </button>
          <button className="ve-play-btn" onClick={() => stepFrame(1)} title=". — next frame">
            ›
          </button>
          <button className="ve-play-btn" onClick={() => seekTo(trimEnd)} title="Go to trim end">
            ⏭
          </button>
          <span className="ve-time">
            {fmt(currentTime)} / {fmt(duration)}
          </span>
          <span className="ve-trim-label">
            Trim {fmt(trimStart)} → {fmt(trimEnd)}{' '}
            <span className="ve-trim-dur">({fmt(trimEnd - trimStart)})</span>
          </span>
          <div style={{ flex: 1 }} />
          <button
            className={`ve-icon-btn${loop ? ' active' : ''}`}
            onClick={() => setLoop(l => !l)}
            title="L — loop trim region"
          >
            ⟳ Loop
          </button>
        </div>

        {/* Row 2: speed + volume */}
        <div className="ve-controls-row ve-controls-row2">
          <span className="ve-controls-label">Speed</span>
          <div className="ve-speed-group">
            {SPEEDS.map(s => (
              <button
                key={s}
                className={`ve-speed-btn${speed === s ? ' active' : ''}`}
                onClick={() => {
                  setSpeed(s);
                  if (videoRef.current) videoRef.current.playbackRate = s;
                }}
              >
                {s}×
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button className="ve-icon-btn" onClick={() => setMuted(m => !m)} title="M — mute/unmute">
            {muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={muted ? 0 : volume}
            className="ve-volume-slider"
            onChange={e => {
              setVolume(parseFloat(e.target.value));
              setMuted(false);
            }}
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="ve-timeline-wrap">
        <div ref={timelineRef} className="ve-timeline" onClick={onTimelineClick}>
          {/* Thumbnails */}
          <div className="ve-thumbs">
            {thumbsReady ? (
              thumbs.map((src, i) => <img key={i} src={src} className="ve-thumb" alt="" />)
            ) : (
              <div className="ve-thumbs-loading">Generating thumbnails…</div>
            )}
          </div>

          {/* Trim shading */}
          <div className="ve-trim-shade ve-trim-shade-l" style={{ width: pct(trimStart) }} />
          <div className="ve-trim-shade ve-trim-shade-r" style={{ left: pct(trimEnd), right: 0 }} />

          {/* Yellow bracket showing active trim region */}
          <div
            className="ve-trim-bracket"
            style={{ left: pct(trimStart), width: `calc(${pct(trimEnd)} - ${pct(trimStart)})` }}
          />

          {/* Trim handles */}
          <div
            className="ve-handle ve-handle-start"
            style={{ left: pct(trimStart) }}
            onMouseDown={e => onHandleMouseDown(e, 'start')}
            onTouchStart={e => {
              e.preventDefault();
              draggingRef.current = 'start';
            }}
          />
          <div
            className="ve-handle ve-handle-end"
            style={{ left: pct(trimEnd) }}
            onMouseDown={e => onHandleMouseDown(e, 'end')}
            onTouchStart={e => {
              e.preventDefault();
              draggingRef.current = 'end';
            }}
          />

          {/* Playhead */}
          <div
            className="ve-playhead"
            style={{ left: pct(currentTime) }}
            onMouseDown={e => onHandleMouseDown(e, 'head')}
            onTouchStart={e => {
              e.preventDefault();
              draggingRef.current = 'head';
            }}
          />

          {/* Overlay markers */}
          {overlays.map(o => (
            <div
              key={o.id}
              className={`ve-overlay-marker${selOverlay === o.id ? ' active' : ''}`}
              style={{
                left: pct(o.startTime),
                width: `calc(${pct(o.endTime)} - ${pct(o.startTime)})`,
              }}
              onClick={e => {
                e.stopPropagation();
                setSelOverlay(o.id);
                seekTo(o.startTime);
              }}
            />
          ))}
        </div>

        {/* Time ruler */}
        <div className="ve-ruler">
          {duration > 0 &&
            Array.from({ length: Math.min(10, Math.floor(duration) + 1) }, (_, i) => {
              const t = (i / Math.min(10, Math.floor(duration))) * duration;
              return (
                <span key={i} className="ve-ruler-mark" style={{ left: pct(t) }}>
                  {fmt(t).split('.')[0]}
                </span>
              );
            })}
        </div>
      </div>

      {/* AI input */}
      <div className="ve-ai-bar">
        <span className="ve-ai-icon">◈</span>
        <input
          className="ve-ai-input"
          placeholder='Tell Based what to edit — "cut the first 5 seconds", "make it 2x faster", "add title at 0"…'
          value={aiInput}
          onChange={e => {
            setAiInput(e.target.value);
            setAiMessage('');
          }}
          onKeyDown={e => e.key === 'Enter' && !aiProcessing && applyAI()}
        />
        <button
          className="ve-btn ve-btn-primary"
          onClick={applyAI}
          disabled={!aiInput.trim() || aiProcessing}
        >
          {aiProcessing ? '◈ Thinking…' : '◈ Apply AI'}
        </button>
      </div>
      {aiMessage && <div className="ve-ai-message">{aiMessage}</div>}
    </div>
  );
}

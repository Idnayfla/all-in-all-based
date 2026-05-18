'use client';
import { useRef, useState, useEffect, useCallback } from 'react';

interface TextOverlay {
  id: string;
  text: string;
  x: number; y: number;
  startTime: number; endTime: number;
  fontSize: number; color: string;
}

const FFMPEG_CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js';
const FFMPEG_WASM = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm';
const THUMB_COUNT = 20;

export default function VideoEditorPanel() {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const ffmpegRef  = useRef<any>(null);

  const [videoFile,  setVideoFile]  = useState<File | null>(null);
  const [videoUrl,   setVideoUrl]   = useState('');
  const [duration,   setDuration]   = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing,    setPlaying]    = useState(false);
  const [trimStart,  setTrimStart]  = useState(0);
  const [trimEnd,    setTrimEnd]    = useState(0);
  const [thumbs,     setThumbs]     = useState<string[]>([]);
  const [overlays,   setOverlays]   = useState<TextOverlay[]>([]);
  const [selOverlay, setSelOverlay] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [procStatus, setProcStatus] = useState('');
  const [exportUrl,  setExportUrl]  = useState('');
  const [aiInput,    setAiInput]    = useState('');
  const [dragging,   setDragging]   = useState<'start'|'end'|'head'|null>(null);
  const draggingRef = useRef<'start'|'end'|'head'|null>(null);

  // ── Load video ────────────────────────────────────────────────────────────
  const loadVideo = (file: File) => {
    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(url);
    setExportUrl('');
    setOverlays([]);
    setThumbs([]);
    setCurrentTime(0);
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
  const onEnded      = () => setPlaying(false);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    else {
      if (v.currentTime < trimStart || v.currentTime >= trimEnd) v.currentTime = trimStart;
      v.play(); setPlaying(true);
    }
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    const check = () => { if (v.currentTime >= trimEnd) { v.pause(); setPlaying(false); } };
    v.addEventListener('timeupdate', check);
    return () => v.removeEventListener('timeupdate', check);
  }, [playing, trimEnd]);

  // ── Thumbnails ────────────────────────────────────────────────────────────
  const generateThumbs = async (video: HTMLVideoElement, dur: number) => {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 68;
    const ctx = c.getContext('2d')!;
    const results: string[] = [];
    for (let i = 0; i < THUMB_COUNT; i++) {
      await new Promise<void>(res => {
        video.currentTime = (i / (THUMB_COUNT - 1)) * dur;
        video.onseeked = () => { ctx.drawImage(video, 0, 0, 120, 68); results.push(c.toDataURL('image/jpeg', 0.5)); res(); };
      });
    }
    video.currentTime = 0;
    setThumbs(results);
  };

  // ── Timeline drag ─────────────────────────────────────────────────────────
  const timelineX = useCallback((clientX: number): number => {
    const r = timelineRef.current?.getBoundingClientRect();
    if (!r || !duration) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  }, [duration]);

  const onTimelineMouseDown = (e: React.MouseEvent, handle: 'start'|'end'|'head') => {
    e.preventDefault();
    draggingRef.current = handle;
    setDragging(handle);
  };

  useEffect(() => {
    const move = (e: MouseEvent | TouchEvent) => {
      if (!draggingRef.current) return;
      const clientX = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const t = timelineX(clientX);
      if (draggingRef.current === 'start')  setTrimStart(Math.min(t, trimEnd - 0.5));
      if (draggingRef.current === 'end')    setTrimEnd(Math.max(t, trimStart + 0.5));
      if (draggingRef.current === 'head') {
        setCurrentTime(t);
        if (videoRef.current) videoRef.current.currentTime = t;
      }
    };
    const up = () => { draggingRef.current = null; setDragging(null); };
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
  }, [timelineX, trimStart, trimEnd]);

  // ── Canvas overlay for text preview ──────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    let raf = 0;
    const draw = () => {
      c.width  = v.videoWidth  || v.offsetWidth;
      c.height = v.videoHeight || v.offsetHeight;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      const t = v.currentTime;
      overlays.filter(o => t >= o.startTime && t <= o.endTime).forEach(o => {
        ctx.save();
        ctx.font      = `bold ${o.fontSize}px system-ui, sans-serif`;
        ctx.fillStyle = o.color;
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur  = 4;
        ctx.fillText(o.text, o.x * c.width, o.y * c.height);
        ctx.restore();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [overlays]);

  // ── Text overlay editing ──────────────────────────────────────────────────
  const addOverlay = () => {
    const id = Date.now().toString();
    setOverlays(prev => [...prev, { id, text: 'New Text', x: 0.1, y: 0.2, startTime: trimStart, endTime: Math.min(trimStart + 3, trimEnd), fontSize: 48, color: '#ffffff' }]);
    setSelOverlay(id);
  };

  const updateOverlay = (id: string, patch: Partial<TextOverlay>) =>
    setOverlays(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));

  const deleteOverlay = (id: string) => {
    setOverlays(prev => prev.filter(o => o.id !== id));
    if (selOverlay === id) setSelOverlay(null);
  };

  // ── AI command parser ─────────────────────────────────────────────────────
  const applyAI = () => {
    const s = aiInput.trim().toLowerCase();
    let matched = false;

    // "trim from X to Y" / "trim X to Y"
    const trimRange = s.match(/trim.*?(\d+\.?\d*)\s*(?:s|sec)?\s*to\s*(\d+\.?\d*)/);
    if (trimRange) {
      setTrimStart(Math.max(0, parseFloat(trimRange[1])));
      setTrimEnd(Math.min(duration, parseFloat(trimRange[2])));
      matched = true;
    }
    // "trim to X seconds" / "keep first X"
    const trimTo = s.match(/(?:trim to|keep first|first)\s*(\d+\.?\d*)\s*(?:s|sec)/);
    if (!matched && trimTo) {
      setTrimStart(0);
      setTrimEnd(Math.min(duration, parseFloat(trimTo[1])));
      matched = true;
    }
    // "add text 'X' at Y"
    const addText = s.match(/add text\s+['"]?(.+?)['"]?\s+at\s+(\d+\.?\d*)/);
    if (!matched && addText) {
      const id = Date.now().toString();
      const start = parseFloat(addText[2]);
      setOverlays(prev => [...prev, { id, text: addText[1], x: 0.1, y: 0.1, startTime: start, endTime: Math.min(start + 3, duration), fontSize: 48, color: '#ffffff' }]);
      setSelOverlay(id);
      matched = true;
    }
    // "remove all text"
    if (!matched && s.includes('remove') && s.includes('text')) { setOverlays([]); matched = true; }
    // "reset trim"
    if (!matched && (s.includes('reset') || s.includes('full video'))) { setTrimStart(0); setTrimEnd(duration); matched = true; }

    if (matched) setAiInput('');
    else alert(`Couldn't understand: "${aiInput}"\n\nTry: "trim from 5 to 30", "trim to 20s", "add text 'Hello' at 5"`);
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

      if (overlays.length) {
        const filters = overlays.map(o =>
          `drawtext=text='${o.text.replace(/'/g, "\\'")}':x=${Math.round(o.x * 1280)}:y=${Math.round(o.y * 720)}:fontsize=${o.fontSize}:fontcolor=${o.color}:enable='between(t\\,${o.startTime}\\,${o.endTime})'`
        ).join(',');
        args.push('-vf', filters, '-c:a', 'copy');
      } else {
        args.push('-c', 'copy');
      }

      args.push('output.mp4');

      setProcStatus('Processing…');
      await ff.exec(args);

      setProcStatus('Reading output…');
      const data = await ff.readFile('output.mp4');
      const blob = new Blob([data], { type: 'video/mp4' });
      setExportUrl(URL.createObjectURL(blob));
      setProcStatus('Done');
    } catch (err: any) {
      setProcStatus(`Error: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  // ── Format helpers ────────────────────────────────────────────────────────
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };
  const pct = (t: number) => duration ? `${(t / duration) * 100}%` : '0%';

  const sel = overlays.find(o => o.id === selOverlay);

  // ── Upload screen ─────────────────────────────────────────────────────────
  if (!videoUrl) return (
    <div className="ve-panel">
      <div className="ve-header"><span>⬡ Video Editor</span></div>
      <div
        className="ve-upload"
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => document.getElementById('ve-file-input')?.click()}
      >
        <div className="ve-upload-icon">▸</div>
        <div className="ve-upload-title">Drop a video here</div>
        <div className="ve-upload-sub">or click to browse · MP4, MOV, WebM</div>
        <input
          id="ve-file-input"
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) loadVideo(f); }}
        />
      </div>
    </div>
  );

  return (
    <div className="ve-panel">
      <div className="ve-header">
        <span>⬡ Video Editor</span>
        <div className="ve-header-actions">
          <button className="ve-btn ve-btn-sm" onClick={() => { setVideoUrl(''); setVideoFile(null); }}>← New</button>
          <button className="ve-btn ve-btn-primary" onClick={exportVideo} disabled={processing}>
            {processing ? `◈ ${procStatus}` : '↓ Export MP4'}
          </button>
          {exportUrl && <a className="ve-btn ve-btn-success" href={exportUrl} download="based-edit.mp4">↓ Download</a>}
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
          <canvas ref={canvasRef} className="ve-canvas-overlay" />
        </div>

        {/* Text overlay panel */}
        <div className="ve-side">
          <div className="ve-side-title">
            Text Overlays
            <button className="ve-btn ve-btn-sm" onClick={addOverlay}>+ Add</button>
          </div>
          <div className="ve-overlay-list">
            {overlays.length === 0 && <div className="ve-overlay-empty">No overlays yet</div>}
            {overlays.map(o => (
              <div
                key={o.id}
                className={`ve-overlay-item${selOverlay === o.id ? ' selected' : ''}`}
                onClick={() => setSelOverlay(o.id)}
              >
                <span className="ve-overlay-text">{o.text}</span>
                <span className="ve-overlay-time">{fmt(o.startTime)}–{fmt(o.endTime)}</span>
                <button className="ve-overlay-del" onClick={e => { e.stopPropagation(); deleteOverlay(o.id); }}>✕</button>
              </div>
            ))}
          </div>

          {sel && (
            <div className="ve-overlay-editor">
              <label className="ve-label">Text</label>
              <input className="ve-input" value={sel.text} onChange={e => updateOverlay(sel.id, { text: e.target.value })} />
              <div className="ve-row">
                <div className="ve-field">
                  <label className="ve-label">Start (s)</label>
                  <input className="ve-input ve-input-sm" type="number" step="0.1" value={sel.startTime.toFixed(1)}
                    onChange={e => updateOverlay(sel.id, { startTime: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="ve-field">
                  <label className="ve-label">End (s)</label>
                  <input className="ve-input ve-input-sm" type="number" step="0.1" value={sel.endTime.toFixed(1)}
                    onChange={e => updateOverlay(sel.id, { endTime: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="ve-row">
                <div className="ve-field">
                  <label className="ve-label">Size</label>
                  <input className="ve-input ve-input-sm" type="number" value={sel.fontSize}
                    onChange={e => updateOverlay(sel.id, { fontSize: parseInt(e.target.value) || 48 })} />
                </div>
                <div className="ve-field">
                  <label className="ve-label">Color</label>
                  <input type="color" value={sel.color} onChange={e => updateOverlay(sel.id, { color: e.target.value })} className="ve-color" />
                </div>
              </div>
              <div className="ve-row">
                <div className="ve-field">
                  <label className="ve-label">X (0–1)</label>
                  <input className="ve-input ve-input-sm" type="number" step="0.01" min="0" max="1" value={sel.x.toFixed(2)}
                    onChange={e => updateOverlay(sel.id, { x: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="ve-field">
                  <label className="ve-label">Y (0–1)</label>
                  <input className="ve-input ve-input-sm" type="number" step="0.01" min="0" max="1" value={sel.y.toFixed(2)}
                    onChange={e => updateOverlay(sel.id, { y: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Playback controls */}
      <div className="ve-controls">
        <button className="ve-play-btn" onClick={togglePlay}>{playing ? '⏸' : '▶'}</button>
        <span className="ve-time">{fmt(currentTime)} / {fmt(duration)}</span>
        <span className="ve-trim-label">Trim: {fmt(trimStart)} → {fmt(trimEnd)}</span>
      </div>

      {/* Timeline */}
      <div className="ve-timeline-wrap">
        <div ref={timelineRef} className="ve-timeline">
          {/* Thumbnails */}
          <div className="ve-thumbs">
            {thumbs.map((src, i) => <img key={i} src={src} className="ve-thumb" alt="" />)}
          </div>

          {/* Shade outside trim */}
          <div className="ve-trim-shade ve-trim-shade-l" style={{ width: pct(trimStart) }} />
          <div className="ve-trim-shade ve-trim-shade-r" style={{ left: pct(trimEnd), width: `calc(100% - ${pct(trimEnd)})` }} />

          {/* Trim handles */}
          <div className="ve-handle ve-handle-start" style={{ left: pct(trimStart) }}
            onMouseDown={e => onTimelineMouseDown(e, 'start')}
            onTouchStart={e => { e.preventDefault(); draggingRef.current = 'start'; setDragging('start'); }} />
          <div className="ve-handle ve-handle-end" style={{ left: pct(trimEnd) }}
            onMouseDown={e => onTimelineMouseDown(e, 'end')}
            onTouchStart={e => { e.preventDefault(); draggingRef.current = 'end'; setDragging('end'); }} />

          {/* Playhead */}
          <div className="ve-playhead" style={{ left: pct(currentTime) }}
            onMouseDown={e => onTimelineMouseDown(e, 'head')}
            onTouchStart={e => { e.preventDefault(); draggingRef.current = 'head'; setDragging('head'); }} />

          {/* Overlay markers */}
          {overlays.map(o => (
            <div key={o.id} className={`ve-overlay-marker${selOverlay === o.id ? ' active' : ''}`}
              style={{ left: pct(o.startTime), width: `calc(${pct(o.endTime)} - ${pct(o.startTime)})` }}
              onClick={() => setSelOverlay(o.id)} />
          ))}
        </div>
      </div>

      {/* AI input */}
      <div className="ve-ai-bar">
        <span className="ve-ai-icon">◈</span>
        <input
          className="ve-ai-input"
          placeholder='AI edit: "trim from 5 to 30", "add text \'Hello\' at 5", "trim to 20s"'
          value={aiInput}
          onChange={e => setAiInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && applyAI()}
        />
        <button className="ve-btn ve-btn-primary" onClick={applyAI} disabled={!aiInput.trim()}>Apply</button>
      </div>
    </div>
  );
}

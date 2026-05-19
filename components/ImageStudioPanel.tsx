'use client';
import { useRef, useState, useCallback, useEffect, type MouseEvent } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────
interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
}

interface Filters {
  brightness: number;  // 0–200 (100 = normal)
  contrast: number;
  saturation: number;
  blur: number;        // 0–20 px
}

type Tool = 'brush' | 'eraser' | 'fill' | 'mask' | 'text' | 'eyedropper';
type AiMode = 'generate' | 'transform' | 'inpaint';

const W = 800;
const H = 600;
const DEFAULT_FILTERS: Filters = { brightness: 100, contrast: 100, saturation: 100, blur: 0 };

let _lid = 0;
function mkLayer(name?: string): Layer {
  _lid++;
  return { id: `l${_lid}-${Date.now()}`, name: name ?? `Layer ${_lid}`, visible: true, opacity: 1 };
}

function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0,2), 16),
    parseInt(h.slice(2,4), 16),
    parseInt(h.slice(4,6), 16),
    255,
  ];
}

function colorsMatch(a: number[], b: [number,number,number,number], tol = 8) {
  return Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]) + Math.abs(a[3]-b[3]) <= tol;
}

function filtersToCSS(f: Filters) {
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) blur(${f.blur}px)`;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function ImageStudioPanel() {
  const [layers, setLayers]     = useState<Layer[]>(() => [mkLayer('Background')]);
  const [activeId, setActiveId] = useState('');
  const [tool, setTool]         = useState<Tool>('brush');
  const [color, setColor]       = useState('#000000');
  const [brushSize, setBrushSize] = useState(14);
  const [filters, setFilters]   = useState<Filters>(DEFAULT_FILTERS);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiMode, setAiMode]     = useState<AiMode>('generate');
  const [generating, setGenerating] = useState(false);
  const [status, setStatus]     = useState('');
  const [activeTab, setActiveTab] = useState<'tools' | 'layers' | 'filters' | 'ai'>('tools');

  const [textInput,   setTextInput]   = useState('');
  const [textPos,     setTextPos]     = useState<{ x: number; y: number } | null>(null);
  const [fontSize,    setFontSize]    = useState(32);
  const [undoStack,   setUndoStack]   = useState<Map<string, ImageData>[]>([]);
  const [redoStack,   setRedoStack]   = useState<Map<string, ImageData>[]>([]);

  const displayRef  = useRef<HTMLCanvasElement>(null);
  const maskRef     = useRef<HTMLCanvasElement>(null);
  const offscreens  = useRef<Record<string, HTMLCanvasElement>>({});
  const drawing     = useRef(false);
  const lastPos     = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setActiveId(layers[0]?.id ?? '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Offscreen canvas per layer ──────────────────────────────────────
  const getOffscreen = useCallback((id: string) => {
    if (!offscreens.current[id]) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      offscreens.current[id] = c;
    }
    return offscreens.current[id];
  }, []);

  // ── Composite all layers → display canvas ──────────────────────────
  const composite = useCallback((layerList: Layer[], showMask: boolean) => {
    const dc = displayRef.current?.getContext('2d');
    if (!dc) return;
    dc.clearRect(0, 0, W, H);
    for (let y = 0; y < H; y += 16) {
      for (let x = 0; x < W; x += 16) {
        dc.fillStyle = (x / 16 + y / 16) % 2 === 0 ? '#333' : '#222';
        dc.fillRect(x, y, 16, 16);
      }
    }
    layerList.forEach(layer => {
      if (!layer.visible) return;
      const oc = offscreens.current[layer.id];
      if (!oc) return;
      dc.globalAlpha = layer.opacity;
      dc.drawImage(oc, 0, 0);
    });
    dc.globalAlpha = 1;
    if (showMask && maskRef.current) dc.drawImage(maskRef.current, 0, 0);
  }, []);

  // ── Undo / Redo ─────────────────────────────────────────────────────
  const captureSnapshot = useCallback((): Map<string, ImageData> => {
    const snap = new Map<string, ImageData>();
    Object.entries(offscreens.current).forEach(([id, c]) => {
      snap.set(id, c.getContext('2d')!.getImageData(0, 0, W, H));
    });
    return snap;
  }, []);

  const pushUndo = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-29), captureSnapshot()]);
    setRedoStack([]);
  }, [captureSnapshot]);

  const applySnapshot = useCallback((snap: Map<string, ImageData>, layerList: Layer[]) => {
    snap.forEach((data, id) => {
      const c = offscreens.current[id];
      if (c) c.getContext('2d')!.putImageData(data, 0, 0);
    });
    composite(layerList, false);
  }, [composite]);

  const undo = useCallback(() => {
    setUndoStack(prev => {
      if (!prev.length) return prev;
      const snap = prev[prev.length - 1];
      const next = prev.slice(0, -1);
      setRedoStack(r => [...r, captureSnapshot()]);
      applySnapshot(snap, layers);
      return next;
    });
  }, [captureSnapshot, applySnapshot, layers]);

  const redo = useCallback(() => {
    setRedoStack(prev => {
      if (!prev.length) return prev;
      const snap = prev[prev.length - 1];
      const next = prev.slice(0, -1);
      setUndoStack(u => [...u, captureSnapshot()]);
      applySnapshot(snap, layers);
      return next;
    });
  }, [captureSnapshot, applySnapshot, layers]);

  useEffect(() => { composite(layers, tool === 'mask'); }, [layers, composite, tool]);

  // ── Canvas coords ───────────────────────────────────────────────────
  const getPos = (e: { clientX: number; clientY: number }) => {
    const rect = displayRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top)  * (H / rect.height),
    };
  };

  // ── Draw stroke ─────────────────────────────────────────────────────
  const drawStroke = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const isMask = tool === 'mask';
    const target = isMask ? maskRef.current : getOffscreen(activeId);
    if (!target) return;
    const ctx = target.getContext('2d')!;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
    if (isMask) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,60,60,0.55)';
    } else if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    composite(layers, isMask);
  }, [tool, brushSize, color, activeId, layers, composite, getOffscreen]);

  // ── Flood fill ──────────────────────────────────────────────────────
  const floodFill = useCallback((x: number, y: number) => {
    const oc = getOffscreen(activeId);
    const ctx = oc.getContext('2d')!;
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const xi = Math.floor(x), yi = Math.floor(y);
    const idx = (yi * W + xi) * 4;
    const target: [number,number,number,number] = [d[idx], d[idx+1], d[idx+2], d[idx+3]];
    const fill = hexToRgba(color);
    if (colorsMatch(Array.from(target), fill)) return;
    const stack: [number,number][] = [[xi, yi]];
    const visited = new Uint8Array(W * H);
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
      const i = (cy * W + cx) * 4;
      if (visited[cy * W + cx]) continue;
      if (!colorsMatch([d[i], d[i+1], d[i+2], d[i+3]], target)) continue;
      visited[cy * W + cx] = 1;
      d[i] = fill[0]; d[i+1] = fill[1]; d[i+2] = fill[2]; d[i+3] = fill[3];
      stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
    }
    ctx.putImageData(img, 0, 0);
    composite(layers, false);
  }, [activeId, color, layers, composite, getOffscreen]);

  // ── Mouse / touch handlers ──────────────────────────────────────────
  const commitText = useCallback(() => {
    if (!textInput.trim() || !textPos) { setTextPos(null); setTextInput(''); return; }
    pushUndo();
    const oc = getOffscreen(activeId);
    const ctx = oc.getContext('2d')!;
    ctx.font = `${fontSize}px Inter, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(textInput, textPos.x, textPos.y);
    composite(layers, false);
    setTextPos(null);
    setTextInput('');
  }, [textInput, textPos, fontSize, color, activeId, layers, composite, getOffscreen, pushUndo]);

  const sampleColor = useCallback((x: number, y: number) => {
    const oc = getOffscreen(activeId);
    const d = oc.getContext('2d')!.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    if (d[3] === 0) return; // transparent — don't pick
    const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    setColor(hex);
    setTool('brush');
  }, [activeId, getOffscreen]);

  const onMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    const pos = getPos(e);
    if (tool === 'fill')       { pushUndo(); floodFill(pos.x, pos.y); return; }
    if (tool === 'eyedropper') { sampleColor(pos.x, pos.y); return; }
    if (tool === 'text')       { setTextPos(pos); return; }
    pushUndo();
    drawing.current = true;
    lastPos.current = pos;
    drawStroke(pos, pos);
  };
  const onMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !lastPos.current) return;
    const pos = getPos(e);
    drawStroke(lastPos.current, pos);
    lastPos.current = pos;
  };
  const onMouseUp = () => { drawing.current = false; lastPos.current = null; };

  const onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const t = e.touches[0];
    const pos = getPos({ clientX: t.clientX, clientY: t.clientY });
    if (tool === 'fill') { floodFill(pos.x, pos.y); return; }
    drawing.current = true;
    lastPos.current = pos;
    drawStroke(pos, pos);
  };
  const onTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!drawing.current || !lastPos.current) return;
    const t = e.touches[0];
    const pos = getPos({ clientX: t.clientX, clientY: t.clientY });
    drawStroke(lastPos.current, pos);
    lastPos.current = pos;
  };

  // ── Layer ops ───────────────────────────────────────────────────────
  const addLayer = () => {
    const l = mkLayer();
    setLayers(prev => [...prev, l]);
    setActiveId(l.id);
  };

  const deleteLayer = (id: string) => {
    setLayers(prev => {
      if (prev.length === 1) return prev;
      const next = prev.filter(l => l.id !== id);
      if (id === activeId) setActiveId(next[next.length - 1].id);
      delete offscreens.current[id];
      return next;
    });
  };

  const moveLayer = (id: string, dir: 1 | -1) => {
    setLayers(prev => {
      const i = prev.findIndex(l => l.id === id);
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const updateLayer = (id: string, patch: Partial<Layer>) =>
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));

  const clearMask = () => {
    const mc = maskRef.current;
    if (!mc) return;
    mc.getContext('2d')!.clearRect(0, 0, W, H);
    composite(layers, true);
  };

  // ── Flatten to data URL (with optional filters) ─────────────────────
  const flatten = useCallback((withFilters = false): string => {
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d')!;
    if (withFilters) ctx.filter = filtersToCSS(filters);
    layers.forEach(layer => {
      if (!layer.visible) return;
      const oc = offscreens.current[layer.id];
      if (!oc) return;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(oc, 0, 0);
    });
    ctx.globalAlpha = 1;
    return out.toDataURL('image/png');
  }, [layers, filters]);

  // ── Load image URL onto a new layer ────────────────────────────────
  const loadUrlToLayer = async (url: string, name: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = url; });
    const l = mkLayer(name);
    const oc = getOffscreen(l.id);
    oc.getContext('2d')!.drawImage(img, 0, 0, W, H);
    setLayers(prev => { const next = [...prev, l]; composite(next, false); return next; });
    setActiveId(l.id);
  };

  // ── Import image from disk ──────────────────────────────────────────
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    loadUrlToLayer(url, file.name.replace(/\.[^.]+$/, ''));
    e.target.value = '';
  };

  // ── AI actions ──────────────────────────────────────────────────────
  const runAI = async () => {
    if (!aiPrompt.trim()) return;
    setGenerating(true);
    setStatus(aiMode === 'generate' ? 'Generating image…' : 'Processing with AI…');
    try {
      if (aiMode === 'generate') {
        const res = await fetch('/api/image', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: aiPrompt }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        await loadUrlToLayer(data.url, `AI: ${aiPrompt.slice(0, 24)}`);

      } else if (aiMode === 'transform') {
        const base64 = flatten(false).split(',')[1];
        const res = await fetch('/api/image', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: aiPrompt, sourceImageData: base64, sourceMediaType: 'image/png' }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        await loadUrlToLayer(data.url, `Transform: ${aiPrompt.slice(0, 20)}`);

      } else { // inpaint
        const sourceBase64 = flatten(false).split(',')[1];
        const maskDataUrl  = maskRef.current?.toDataURL('image/png') ?? '';
        const res = await fetch('/api/image/edit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: 'inpaint',
            sourceImageData: sourceBase64,
            sourceMediaType: 'image/png',
            prompt: aiPrompt,
            maskDataUrl,
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        await loadUrlToLayer(data.url, `Inpaint: ${aiPrompt.slice(0, 20)}`);
        clearMask();
      }

      setAiPrompt('');
      setStatus('');
    } catch (err: any) {
      setStatus(err.message ?? 'Error');
    } finally {
      setGenerating(false);
    }
  };

  // ── Export ──────────────────────────────────────────────────────────
  const exportImage = () => {
    const url = flatten(true);
    const a = document.createElement('a');
    a.href = url; a.download = 'based-image.png'; a.click();
  };

  // ── Filter CSS preview on display canvas ────────────────────────────
  const filterCSS = filtersToCSS(filters);
  const hasFilters = filters.brightness !== 100 || filters.contrast !== 100 ||
                     filters.saturation !== 100 || filters.blur !== 0;

  const selLayer = layers.find(l => l.id === activeId);

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="image-studio">

      {/* Toolbar */}
      <div className="image-studio-toolbar">
        <span className="image-studio-logo">◈ Image Studio</span>

        <div className="image-studio-tools">
          {([
            { id: 'brush',      label: '✏ Brush' },
            { id: 'eraser',     label: '⌫ Eraser' },
            { id: 'fill',       label: '⬡ Fill' },
            { id: 'text',       label: 'T Text' },
            { id: 'eyedropper', label: '◉ Pick' },
            { id: 'mask',       label: '⊙ Mask' },
          ] as { id: Tool; label: string }[]).map(t => (
            <button
              key={t.id}
              className={`image-tool-btn${tool === t.id ? ' active' : ''}`}
              onClick={() => setTool(t.id)}
              title={t.id === 'mask' ? 'Paint mask for AI inpaint' : t.id === 'eyedropper' ? 'Pick color from canvas' : t.id === 'text' ? 'Click canvas to place text' : undefined}
            >{t.label}</button>
          ))}
          <div className="image-tool-sep" />
          <button className="image-tool-btn" onClick={undo} disabled={undoStack.length === 0} title="Undo">↩ Undo</button>
          <button className="image-tool-btn" onClick={redo} disabled={redoStack.length === 0} title="Redo">↪ Redo</button>
        </div>

        <div className="image-studio-header-right">
          {status && <span className="image-studio-status">{status}</span>}
          <input type="color" value={color} onChange={e => setColor(e.target.value)} className="image-color-picker" title="Color" />
          {tool === 'text' ? (
            <>
              <input type="range" min={8} max={120} value={fontSize} onChange={e => setFontSize(parseInt(e.target.value))} className="image-size-slider" title={`Font size: ${fontSize}px`} />
              <span className="image-size-label">{fontSize}px</span>
            </>
          ) : (
            <>
              <input type="range" min={1} max={80} value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} className="image-size-slider" title={`Brush size: ${brushSize}px`} />
              <span className="image-size-label">{brushSize}px</span>
            </>
          )}
          <label className="image-btn image-btn-sm" title="Import image">
            ↑ Import
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImport} />
          </label>
          <button className="image-btn image-btn-sm" onClick={exportImage}>↓ Export PNG</button>
        </div>
      </div>

      {/* Body */}
      <div className="image-studio-body">

        {/* Canvas area */}
        <div className="image-canvas-wrap">
          <canvas
            ref={displayRef}
            width={W} height={H}
            className="image-canvas"
            style={{ filter: hasFilters ? filterCSS : undefined, cursor: tool === 'fill' ? 'crosshair' : 'default' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onMouseUp}
          />
          <canvas ref={maskRef} width={W} height={H} style={{ display: 'none' }} />
          {tool === 'mask' && (
            <div className="image-mask-hint">
              Paint the area to edit in red, then use AI → Inpaint
              <button className="image-btn image-btn-sm" style={{ marginLeft: 8 }} onClick={clearMask}>Clear mask</button>
            </div>
          )}
          {textPos && (
            <div
              className="image-text-overlay"
              style={{
                left: `${(textPos.x / W) * 100}%`,
                top:  `${(textPos.y / H) * 100}%`,
              }}
            >
              <input
                autoFocus
                className="image-text-input"
                style={{ fontSize: `${fontSize * (displayRef.current?.getBoundingClientRect().width ?? W) / W}px`, color }}
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') { setTextPos(null); setTextInput(''); } }}
                onBlur={commitText}
                placeholder="Type here…"
              />
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="image-right-panel">
          <div className="image-panel-tabs">
            {(['tools', 'layers', 'filters', 'ai'] as const).map(tab => (
              <button key={tab} className={`image-panel-tab${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>
                {tab === 'tools' ? '✏ Tools' : tab === 'layers' ? '⬡ Layers' : tab === 'filters' ? '◉ Filters' : '◈ AI'}
              </button>
            ))}
          </div>

          {/* Tools panel */}
          {activeTab === 'tools' && (
            <div className="image-tools-panel">
              <div className="image-tools-section">
                <div className="image-tools-label">Tool</div>
                <div className="image-tools-grid">
                  {([
                    { id: 'brush',      label: '✏',  title: 'Brush' },
                    { id: 'eraser',     label: '⌫',  title: 'Eraser' },
                    { id: 'fill',       label: '⬡',  title: 'Fill bucket' },
                    { id: 'text',       label: 'T',   title: 'Text' },
                    { id: 'eyedropper', label: '◉',  title: 'Color picker' },
                    { id: 'mask',       label: '⊙',  title: 'Mask (for AI inpaint)' },
                  ] as { id: Tool; label: string; title: string }[]).map(t => (
                    <button key={t.id} className={`image-tool-grid-btn${tool === t.id ? ' active' : ''}`} onClick={() => setTool(t.id)} title={t.title}>
                      <span className="image-tool-icon">{t.label}</span>
                      <span className="image-tool-name">{t.title}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="image-tools-section">
                <div className="image-tools-label">Color</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={color} onChange={e => setColor(e.target.value)} className="image-color-picker-lg" />
                  <span style={{ fontSize: 11, color: 'var(--fg3)', fontFamily: 'monospace' }}>{color}</span>
                </div>
              </div>
              <div className="image-tools-section">
                <div className="image-tools-label">{tool === 'text' ? 'Font Size' : 'Brush Size'} — {tool === 'text' ? fontSize : brushSize}px</div>
                {tool === 'text'
                  ? <input type="range" min={8} max={120} value={fontSize} onChange={e => setFontSize(parseInt(e.target.value))} className="image-filter-slider" />
                  : <input type="range" min={1} max={80} value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} className="image-filter-slider" />
                }
              </div>
              <div className="image-tools-section">
                <div className="image-tools-label">History</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="image-btn image-btn-sm" onClick={undo} disabled={undoStack.length === 0}>↩ Undo ({undoStack.length})</button>
                  <button className="image-btn image-btn-sm" onClick={redo} disabled={redoStack.length === 0}>↪ Redo ({redoStack.length})</button>
                </div>
              </div>
            </div>
          )}

          {/* Layers */}
          {activeTab === 'layers' && (
            <div className="image-layers">
              <div className="image-layers-header">
                <span>Layers</span>
                <button className="image-btn image-btn-sm" onClick={addLayer}>+ Add</button>
              </div>
              {[...layers].reverse().map(layer => (
                <div
                  key={layer.id}
                  className={`image-layer-row${layer.id === activeId ? ' active' : ''}`}
                  onClick={() => setActiveId(layer.id)}
                >
                  <button
                    className="image-layer-vis"
                    onClick={e => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
                    title="Toggle visibility"
                  >{layer.visible ? '●' : '○'}</button>
                  <input
                    className="image-layer-name"
                    value={layer.name}
                    onClick={e => e.stopPropagation()}
                    onChange={e => updateLayer(layer.id, { name: e.target.value })}
                  />
                  <input
                    type="range" min={0} max={1} step={0.01} value={layer.opacity}
                    className="image-layer-opacity"
                    title={`Opacity: ${Math.round(layer.opacity * 100)}%`}
                    onClick={e => e.stopPropagation()}
                    onChange={e => { e.stopPropagation(); updateLayer(layer.id, { opacity: parseFloat(e.target.value) }); }}
                  />
                  <div className="image-layer-btns">
                    <button onClick={e => { e.stopPropagation(); moveLayer(layer.id, 1); }} title="Move up">↑</button>
                    <button onClick={e => { e.stopPropagation(); moveLayer(layer.id, -1); }} title="Move down">↓</button>
                    <button onClick={e => { e.stopPropagation(); deleteLayer(layer.id); }} title="Delete">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          {activeTab === 'filters' && (
            <div className="image-filters">
              {([
                { key: 'brightness', label: 'Brightness', min: 0, max: 200 },
                { key: 'contrast',   label: 'Contrast',   min: 0, max: 200 },
                { key: 'saturation', label: 'Saturation', min: 0, max: 200 },
                { key: 'blur',       label: 'Blur (px)',  min: 0, max: 20  },
              ] as { key: keyof Filters; label: string; min: number; max: number }[]).map(fx => (
                <div key={fx.key} className="image-filter-row">
                  <span className="image-filter-label">{fx.label}</span>
                  <input
                    type="range" min={fx.min} max={fx.max} value={filters[fx.key]}
                    className="image-filter-slider"
                    onChange={e => setFilters(prev => ({ ...prev, [fx.key]: parseFloat(e.target.value) }))}
                  />
                  <span className="image-filter-value">
                    {fx.key === 'blur' ? `${filters[fx.key]}px` : `${filters[fx.key]}%`}
                  </span>
                </div>
              ))}
              <button
                className="image-btn image-btn-sm"
                style={{ marginTop: 12 }}
                onClick={() => setFilters(DEFAULT_FILTERS)}
              >Reset filters</button>
            </div>
          )}

          {/* AI */}
          {activeTab === 'ai' && (
            <div className="image-ai-panel">
              <div className="image-ai-mode-row">
                {([
                  { id: 'generate',  label: 'Generate' },
                  { id: 'transform', label: 'Transform' },
                  { id: 'inpaint',   label: 'Inpaint' },
                ] as { id: AiMode; label: string }[]).map(m => (
                  <button
                    key={m.id}
                    className={`image-ai-mode-btn${aiMode === m.id ? ' active' : ''}`}
                    onClick={() => { setAiMode(m.id); if (m.id === 'inpaint') setTool('mask'); }}
                  >{m.label}</button>
                ))}
              </div>

              <div className="image-ai-desc">
                {aiMode === 'generate' && 'Describe an image to create on a new layer.'}
                {aiMode === 'transform' && 'Describe how to transform the current canvas.'}
                {aiMode === 'inpaint'   && 'Paint a mask, then describe what to place there.'}
              </div>

              <textarea
                className="image-ai-prompt"
                placeholder={
                  aiMode === 'generate'  ? 'A neon cityscape at dusk, ultra detailed…' :
                  aiMode === 'transform' ? 'Make it look like a watercolour painting…' :
                                           'Replace the selected area with a cat…'
                }
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runAI(); }}
                rows={4}
              />

              <button
                className="image-btn image-btn-primary"
                onClick={runAI}
                disabled={generating || !aiPrompt.trim()}
              >
                {generating ? 'Working…' : aiMode === 'generate' ? '◈ Generate' : aiMode === 'transform' ? '◈ Transform' : '◈ Inpaint'}
              </button>

              {aiMode === 'inpaint' && (
                <div className="image-ai-mask-note">
                  Switch to <strong>Mask</strong> tool and paint the area to replace, then click Inpaint.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

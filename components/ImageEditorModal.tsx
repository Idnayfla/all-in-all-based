// components/ImageEditorModal.tsx
'use client';
import { useRef, useState, useEffect, useCallback } from 'react';

interface ImageEditorModalProps {
  sourceImageUrl: string;
  onConfirm: (resultUrl: string, prompt: string) => void;
  onClose: () => void;
}

type Mode = 'transform' | 'inpaint';

export default function ImageEditorModal({ sourceImageUrl, onConfirm, onClose }: ImageEditorModalProps) {
  const [mode, setMode] = useState<Mode>('transform');
  const [prompt, setPrompt] = useState('');
  const [currentSourceUrl, setCurrentSourceUrl] = useState(sourceImageUrl);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(24);
  const [isSourceLoading, setIsSourceLoading] = useState(true);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const strokeHistory = useRef<ImageData[]>([]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokeHistory.current = [];
  }, []);

  const positionCanvas = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const rect = img.getBoundingClientRect();
    const parentRect = img.parentElement!.getBoundingClientRect();
    canvas.style.left = `${rect.left - parentRect.left}px`;
    canvas.style.top = `${rect.top - parentRect.top}px`;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }, []);

  // Reset result + canvas when source or mode changes
  useEffect(() => {
    setResultUrl(null);
    setError(null);
    clearCanvas();
  }, [currentSourceUrl, mode, clearCanvas]);

  // Re-position canvas when switching to inpaint if image already loaded
  useEffect(() => {
    if (mode === 'inpaint' && imgRef.current?.complete) {
      positionCanvas();
    }
  }, [mode, positionCanvas]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    strokeHistory.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    isDrawing.current = true;
    const rect = canvas.getBoundingClientRect();
    const pos = getPos(e);
    const radius = (brushSize / 2) * (canvas.width / rect.width);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = brushSize * (canvas.width / rect.width);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDrawing = () => { isDrawing.current = false; };

  const undoStroke = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const prev = strokeHistory.current.pop();
    if (prev) ctx.putImageData(prev, 0, 0);
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setResultUrl(null);

    const maskDataUrl =
      mode === 'inpaint' && canvasRef.current
        ? canvasRef.current.toDataURL('image/png')
        : undefined;

    try {
      const res = await fetch('/api/image/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, sourceImageUrl: currentSourceUrl, prompt, maskDataUrl }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'Server error');
      setResultUrl(data.url);
    } catch (err: any) {
      setError(err.message ?? 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleChain = () => {
    if (!resultUrl) return;
    setIsSourceLoading(true);
    setCurrentSourceUrl(resultUrl);
  };

  const handleConfirm = () => {
    if (!resultUrl) return;
    onConfirm(resultUrl, prompt);
    onClose();
  };

  return (
    <div className="image-editor-overlay">
      <div className="image-editor-header">
        <div className="image-editor-title">✏ EDIT IMAGE</div>
        <div className="image-editor-tabs">
          <button
            className={`image-editor-tab${mode === 'transform' ? ' active' : ''}`}
            onClick={() => setMode('transform')}
          >Transform</button>
          <button
            className={`image-editor-tab${mode === 'inpaint' ? ' active' : ''}`}
            onClick={() => setMode('inpaint')}
          >Inpaint</button>
        </div>
        <button className="image-editor-close" onClick={onClose}>✕</button>
      </div>

      <div className="image-editor-canvas-area">
        <div className="image-editor-pane">
          <div className="image-editor-pane-label">Original</div>
          <div className="image-editor-image-wrap">
            <img
              ref={imgRef}
              src={currentSourceUrl}
              alt="source"
              className="image-editor-source"
              onLoad={() => { setIsSourceLoading(false); positionCanvas(); }}
              draggable={false}
            />
            {mode === 'inpaint' && (
              <canvas
                ref={canvasRef}
                className="image-editor-canvas"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
            )}
          </div>
          {mode === 'inpaint' && (
            <div className="image-editor-brush-tools">
              <button className="image-editor-brush-btn" onClick={undoStroke}>↩ Undo</button>
              <button className="image-editor-brush-btn" onClick={clearCanvas}>⬜ Clear</button>
              <div className="image-editor-brush-size">
                <span>Size</span>
                <input
                  type="range" min={8} max={60} value={brushSize}
                  onChange={e => setBrushSize(Number(e.target.value))}
                />
                <span>{brushSize}px</span>
              </div>
            </div>
          )}
        </div>

        <div className="image-editor-pane">
          <div className="image-editor-pane-label">Result</div>
          <div className="image-editor-image-wrap">
            {isGenerating ? (
              <div className="image-editor-placeholder">⏳ Generating…</div>
            ) : resultUrl ? (
              <img src={resultUrl} alt="result" className="image-editor-result" />
            ) : (
              <div className="image-editor-placeholder">generate to see result</div>
            )}
          </div>
          {resultUrl && !isGenerating && (
            <div className="image-editor-result-actions">
              <a
                className="image-editor-download-link"
                href={resultUrl}
                download
                target="_blank"
                rel="noreferrer"
              >↓ Download</a>
              <button className="image-editor-chain-btn" onClick={handleChain}>↺ Edit this</button>
            </div>
          )}
          {error && <div className="image-editor-error">❌ {error}</div>}
        </div>
      </div>

      <div className="image-editor-footer">
        <textarea
          className="image-editor-prompt"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={
            mode === 'inpaint'
              ? 'Describe what to put in the masked area…'
              : 'Describe how to transform the image…'
          }
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); }
          }}
        />
        <button
          className="image-editor-generate-btn"
          onClick={handleGenerate}
          disabled={isGenerating || isSourceLoading || !prompt.trim()}
        >
          {isGenerating ? '⏳' : isSourceLoading ? '⏳' : 'Generate'}
        </button>
        <button
          className="image-editor-confirm-btn"
          onClick={handleConfirm}
          disabled={!resultUrl || isGenerating}
        >Confirm ✓</button>
      </div>
    </div>
  );
}

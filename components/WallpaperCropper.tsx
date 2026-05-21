'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  src: string;
  onCrop: (dataUrl: string) => void;
  onSkip: () => void;
}

type HandlePos = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const HANDLE_SIZE = 10;
const MIN_CROP = 20;

const HANDLE_CURSORS: Record<HandlePos, string> = {
  nw: 'nw-resize',
  n: 'n-resize',
  ne: 'ne-resize',
  w: 'w-resize',
  e: 'e-resize',
  sw: 'sw-resize',
  s: 's-resize',
  se: 'se-resize',
};

export default function WallpaperCropper({ src, onCrop, onSkip }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // displayW/H: canvas size in CSS pixels (constrained to 90vw × 70vh)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  // crop rect in canvas-pixel space (may differ from CSS pixels on HiDPI — we work in logical px)
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [loaded, setLoaded] = useState(false);

  // drag state stored in a ref so canvas draw loop doesn't need re-renders
  const dragState = useRef<{
    type: 'move' | 'resize';
    handle?: HandlePos;
    startX: number;
    startY: number;
    origCrop: CropRect;
  } | null>(null);

  // ── Load image and compute display size ────────────────────────────────
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const maxW = window.innerWidth * 0.9;
      const maxH = window.innerHeight * 0.7;
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      setDisplaySize({ w, h });
      // Default crop: full image
      setCrop({ x: 0, y: 0, w, h });
      setLoaded(true);
    };
    img.src = src;
  }, [src]);

  // ── Draw canvas whenever crop changes ──────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !loaded) return;
    const { w: dw, h: dh } = displaySize;
    if (dw === 0 || dh === 0) return;

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, dw, dh);
    // Draw full image
    ctx.drawImage(img, 0, 0, dw, dh);

    const { x, y, w, h } = crop;

    // Dim everything outside crop
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    // Top
    ctx.fillRect(0, 0, dw, y);
    // Bottom
    ctx.fillRect(0, y + h, dw, dh - y - h);
    // Left
    ctx.fillRect(0, y, x, h);
    // Right
    ctx.fillRect(x + w, y, dw - x - w, h);
    ctx.restore();

    // Crop border
    ctx.save();
    ctx.strokeStyle = 'var(--accent, #6c63ff)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();

    // Rule-of-thirds grid (subtle)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      const gx = x + (w / 3) * i;
      const gy = y + (h / 3) * i;
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.stroke();
    }
    ctx.restore();

    // Handles
    const handles = getHandleRects(crop);
    for (const [, rect] of Object.entries(handles)) {
      ctx.save();
      ctx.fillStyle = 'var(--accent, #6c63ff)';
      ctx.fillRect(rect.hx, rect.hy, HANDLE_SIZE, HANDLE_SIZE);
      ctx.restore();
    }
  }, [crop, displaySize, loaded]);

  useEffect(() => {
    draw();
  }, [draw]);

  // ── Handle rects ────────────────────────────────────────────────────────
  function getHandleRects(r: CropRect): Record<HandlePos, { hx: number; hy: number }> {
    const hs = HANDLE_SIZE;
    const cx = r.x + r.w / 2 - hs / 2;
    const cy = r.y + r.h / 2 - hs / 2;
    return {
      nw: { hx: r.x - hs / 2, hy: r.y - hs / 2 },
      n: { hx: cx, hy: r.y - hs / 2 },
      ne: { hx: r.x + r.w - hs / 2, hy: r.y - hs / 2 },
      w: { hx: r.x - hs / 2, hy: cy },
      e: { hx: r.x + r.w - hs / 2, hy: cy },
      sw: { hx: r.x - hs / 2, hy: r.y + r.h - hs / 2 },
      s: { hx: cx, hy: r.y + r.h - hs / 2 },
      se: { hx: r.x + r.w - hs / 2, hy: r.y + r.h - hs / 2 },
    };
  }

  function hitTestHandle(px: number, py: number, r: CropRect): HandlePos | null {
    const handles = getHandleRects(r);
    const hs = HANDLE_SIZE;
    for (const [pos, { hx, hy }] of Object.entries(handles) as [
      HandlePos,
      { hx: number; hy: number },
    ][]) {
      if (px >= hx - 4 && px <= hx + hs + 4 && py >= hy - 4 && py <= hy + hs + 4) return pos;
    }
    return null;
  }

  function hitTestBody(px: number, py: number, r: CropRect): boolean {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  // ── Pointer helpers ─────────────────────────────────────────────────────
  function getCanvasPos(e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX =
      'touches' in e
        ? ((e as TouchEvent).touches[0]?.clientX ?? (e as TouchEvent).changedTouches[0].clientX)
        : (e as MouseEvent).clientX;
    const clientY =
      'touches' in e
        ? ((e as TouchEvent).touches[0]?.clientY ?? (e as TouchEvent).changedTouches[0].clientY)
        : (e as MouseEvent).clientY;
    // canvas CSS size == canvas.width/height (no device pixel scaling needed for interaction)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function clamp(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v));
  }

  function onPointerDown(e: React.MouseEvent | React.TouchEvent) {
    if (!loaded) return;
    e.preventDefault();
    const { x: px, y: py } = getCanvasPos(e);
    const handle = hitTestHandle(px, py, crop);
    if (handle) {
      dragState.current = { type: 'resize', handle, startX: px, startY: py, origCrop: { ...crop } };
    } else if (hitTestBody(px, py, crop)) {
      dragState.current = { type: 'move', startX: px, startY: py, origCrop: { ...crop } };
    }
  }

  const applyDrag = useCallback(
    (px: number, py: number) => {
      const ds = dragState.current;
      if (!ds) return;
      const dx = px - ds.startX;
      const dy = py - ds.startY;
      const { w: canvasW, h: canvasH } = displaySize;
      const o = ds.origCrop;

      if (ds.type === 'move') {
        setCrop({
          x: clamp(o.x + dx, 0, canvasW - o.w),
          y: clamp(o.y + dy, 0, canvasH - o.h),
          w: o.w,
          h: o.h,
        });
        return;
      }

      // Resize
      let { x, y, w, h } = o;
      const handle = ds.handle!;

      if (handle.includes('e')) w = clamp(o.w + dx, MIN_CROP, canvasW - o.x);
      if (handle.includes('s')) h = clamp(o.h + dy, MIN_CROP, canvasH - o.y);
      if (handle.includes('w')) {
        const newX = clamp(o.x + dx, 0, o.x + o.w - MIN_CROP);
        w = o.w - (newX - o.x);
        x = newX;
      }
      if (handle.includes('n')) {
        const newY = clamp(o.y + dy, 0, o.y + o.h - MIN_CROP);
        h = o.h - (newY - o.y);
        y = newY;
      }
      setCrop({ x, y, w, h });
    },
    [displaySize]
  );

  // Attach global mousemove/mouseup/touchmove/touchend so drag works even when cursor leaves canvas
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragState.current) return;
      e.preventDefault();
      const { x, y } = getCanvasPos(e);
      applyDrag(x, y);
    }
    function onTouchMove(e: TouchEvent) {
      if (!dragState.current) return;
      e.preventDefault();
      const { x, y } = getCanvasPos(e);
      applyDrag(x, y);
    }
    function onUp() {
      dragState.current = null;
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [applyDrag]);

  // ── Cursor update on mousemove ──────────────────────────────────────────
  function onCanvasMouseMove(e: React.MouseEvent) {
    if (!loaded) return;
    const { x: px, y: py } = getCanvasPos(e);
    const handle = hitTestHandle(px, py, crop);
    if (handle) {
      canvasRef.current!.style.cursor = HANDLE_CURSORS[handle];
    } else if (hitTestBody(px, py, crop)) {
      canvasRef.current!.style.cursor = 'move';
    } else {
      canvasRef.current!.style.cursor = 'crosshair';
    }
  }

  // ── Apply crop ─────────────────────────────────────────────────────────
  function handleApply() {
    const img = imgRef.current;
    if (!img) return;
    const { w: dw, h: dh } = displaySize;
    if (dw === 0 || dh === 0) return;

    // Map crop rect (in display-canvas space) back to natural image pixels
    const scaleX = img.naturalWidth / dw;
    const scaleY = img.naturalHeight / dh;

    const sx = Math.round(crop.x * scaleX);
    const sy = Math.round(crop.y * scaleY);
    const sw = Math.round(crop.w * scaleX);
    const sh = Math.round(crop.h * scaleY);

    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    out.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    onCrop(out.toDataURL('image/jpeg', 0.92));
  }

  if (!loaded || displaySize.w === 0) {
    return (
      <div className="cropper-overlay">
        <div className="cropper-modal">
          <div className="cropper-loading">◈ Loading image·</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="cropper-overlay"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onSkip();
      }}
    >
      <div className="cropper-modal" onClick={e => e.stopPropagation()}>
        <div className="cropper-header">
          <span className="cropper-title">◈ Crop Wallpaper</span>
          <span className="cropper-hint">Drag to move · Handles to resize</span>
        </div>

        <div className="cropper-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={displaySize.w}
            height={displaySize.h}
            className="cropper-canvas"
            onMouseDown={onPointerDown}
            onMouseMove={onCanvasMouseMove}
            onTouchStart={onPointerDown}
          />
        </div>

        <div className="cropper-actions">
          <button className="cropper-skip-btn" onClick={onSkip}>
            → Skip
          </button>
          <button className="cropper-apply-btn" onClick={handleApply}>
            ⊙ Apply Crop
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';
import { useRef, useState, useEffect } from 'react';

interface Props {
  url: string;
  onClose: () => void;
  format?: 'png' | 'jpg';
}
interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move' | null;

const RATIOS: { label: string; ratio: number | null }[] = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '2:1', ratio: 2 },
  { label: '9:16', ratio: 9 / 16 },
];

export default function ImageCropModal({ url, onClose, format = 'png' }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [crop, setCrop] = useState<CropRect>({ x: 10, y: 10, w: 80, h: 80 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [activeRatio, setActiveRatio] = useState<number | null>(null);
  const dragging = useRef<{
    handle: Handle;
    startMx: number;
    startMy: number;
    startCrop: CropRect;
  } | null>(null);

  const applyRatio = (ratio: number | null) => {
    setActiveRatio(ratio);
    if (!ratio || !wrapRef.current) return;
    const wRect = wrapRef.current.getBoundingClientRect();
    const imgAspect = wRect.width / wRect.height;
    setCrop(prev => {
      const cx = prev.x + prev.w / 2;
      const cy = prev.y + prev.h / 2;
      const pixelRatio = ratio / imgAspect;
      let w = prev.w;
      let h = w / pixelRatio;
      if (h > 100) {
        h = 100;
        w = h * pixelRatio;
      }
      if (w > 100) {
        w = 100;
        h = w / pixelRatio;
      }
      const x = Math.max(0, Math.min(100 - w, cx - w / 2));
      const y = Math.max(0, Math.min(100 - h, cy - h / 2));
      return { x, y, w, h };
    });
  };

  const startDrag = (handle: Handle, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    dragging.current = { handle, startMx: clientX, startMy: clientY, startCrop: { ...crop } };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current || !wrapRef.current) return;
      const wRect = wrapRef.current.getBoundingClientRect();
      const clientX =
        'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const clientY =
        'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
      const dx = ((clientX - dragging.current.startMx) / wRect.width) * 100;
      const dy = ((clientY - dragging.current.startMy) / wRect.height) * 100;
      const s = dragging.current.startCrop;
      const MIN = 5;
      const ratio = activeRatio ? activeRatio / (wRect.width / wRect.height) : null;
      setCrop(() => {
        let { x, y, w, h } = s;
        if (dragging.current!.handle === 'move') {
          x = Math.max(0, Math.min(100 - w, s.x + dx));
          y = Math.max(0, Math.min(100 - h, s.y + dy));
        } else if (dragging.current!.handle === 'nw') {
          const nx = Math.min(s.x + dx, s.x + s.w - MIN);
          w = s.w - (nx - s.x);
          x = nx;
          if (ratio) {
            h = w / ratio;
          } else {
            const ny = Math.min(s.y + dy, s.y + s.h - MIN);
            h = s.h - (ny - s.y);
            y = ny;
          }
        } else if (dragging.current!.handle === 'ne') {
          w = Math.max(MIN, s.w + dx);
          if (ratio) {
            h = w / ratio;
          } else {
            const ny = Math.min(s.y + dy, s.y + s.h - MIN);
            h = s.h - (ny - s.y);
            y = ny;
          }
        } else if (dragging.current!.handle === 'sw') {
          const nx = Math.min(s.x + dx, s.x + s.w - MIN);
          w = s.w - (nx - s.x);
          x = nx;
          if (ratio) {
            h = w / ratio;
          } else {
            h = Math.max(MIN, s.h + dy);
          }
        } else if (dragging.current!.handle === 'se') {
          w = Math.max(MIN, s.w + dx);
          if (ratio) {
            h = w / ratio;
          } else {
            h = Math.max(MIN, s.h + dy);
          }
        }
        return {
          x: Math.max(0, x),
          y: Math.max(0, y),
          w: Math.min(w, 100 - Math.max(0, x)),
          h: Math.min(h, 100 - Math.max(0, y)),
        };
      });
    };
    const onUp = () => {
      dragging.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [activeRatio]);

  const [cropError, setCropError] = useState<string | null>(null);

  const applyCrop = () => {
    setCropError(null);
    try {
      const img = imgRef.current;
      if (!img) return;
      const scaleX = img.naturalWidth / img.offsetWidth;
      const scaleY = img.naturalHeight / img.offsetHeight;
      const sx = (crop.x / 100) * img.offsetWidth * scaleX;
      const sy = (crop.y / 100) * img.offsetHeight * scaleY;
      const sw = Math.max(1, Math.round((crop.w / 100) * img.offsetWidth * scaleX));
      const sh = Math.max(1, Math.round((crop.h / 100) * img.offsetHeight * scaleY));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setCropError('Crop failed — canvas unavailable in this browser.');
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
      setCroppedUrl(canvas.toDataURL(mime, format === 'jpg' ? 0.92 : undefined));
    } catch (err: unknown) {
      console.error('[applyCrop]', err);
      setCropError('Crop failed — please try again.');
    }
  };

  const download = () => {
    if (!croppedUrl) return;
    const a = document.createElement('a');
    a.href = croppedUrl;
    a.download = `cropped.${format}`;
    a.click();
  };

  return (
    <div className="crop-overlay" onClick={onClose}>
      <div className="crop-modal" onClick={e => e.stopPropagation()}>
        <div className="crop-modal-header">
          <span className="crop-modal-title">◈ Crop Image</span>
          <div className="crop-ratio-pills">
            {RATIOS.map(r => (
              <button
                key={r.label}
                className={`crop-ratio-pill${activeRatio === r.ratio ? ' active' : ''}`}
                onClick={() => applyRatio(r.ratio)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button className="crop-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="crop-modal-body">
          <div className="crop-pane">
            <div className="crop-pane-label">Drag to crop</div>
            <div ref={wrapRef} className="crop-image-wrap" style={{ userSelect: 'none' }}>
              <img
                ref={imgRef}
                src={url}
                alt="source"
                className="crop-source-img"
                onLoad={() => setImgLoaded(true)}
                draggable={false}
              />
              {imgLoaded && (
                <>
                  <div className="crop-shade crop-shade-t" style={{ height: `${crop.y}%` }} />
                  <div
                    className="crop-shade crop-shade-b"
                    style={{ top: `${crop.y + crop.h}%`, height: `${100 - crop.y - crop.h}%` }}
                  />
                  <div
                    className="crop-shade crop-shade-l"
                    style={{ top: `${crop.y}%`, height: `${crop.h}%`, width: `${crop.x}%` }}
                  />
                  <div
                    className="crop-shade crop-shade-r"
                    style={{
                      top: `${crop.y}%`,
                      height: `${crop.h}%`,
                      left: `${crop.x + crop.w}%`,
                      width: `${100 - crop.x - crop.w}%`,
                    }}
                  />
                  <div
                    className="crop-rect"
                    style={{
                      left: `${crop.x}%`,
                      top: `${crop.y}%`,
                      width: `${crop.w}%`,
                      height: `${crop.h}%`,
                    }}
                    onMouseDown={e => startDrag('move', e)}
                    onTouchStart={e => startDrag('move', e)}
                  >
                    {(['nw', 'ne', 'sw', 'se'] as const).map(h => (
                      <div
                        key={h}
                        className={`crop-handle crop-handle-${h}`}
                        onMouseDown={e => startDrag(h, e)}
                        onTouchStart={e => startDrag(h, e)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="crop-dimensions">
              {imgLoaded && imgRef.current && (
                <>
                  {Math.round((crop.w / 100) * imgRef.current.naturalWidth)} ×{' '}
                  {Math.round((crop.h / 100) * imgRef.current.naturalHeight)} px
                </>
              )}
            </div>
          </div>

          <div className="crop-pane">
            <div className="crop-pane-label">Preview</div>
            <div className="crop-preview-wrap">
              {croppedUrl ? (
                <img src={croppedUrl} alt="cropped" className="crop-preview-img" />
              ) : (
                <div className="crop-preview-empty">Apply crop to preview</div>
              )}
            </div>
          </div>
        </div>

        <div className="crop-modal-footer">
          <button className="crop-apply-btn" onClick={applyCrop} disabled={!imgLoaded}>
            Apply Crop
          </button>
          {croppedUrl && (
            <button className="crop-download-btn" onClick={download}>
              ↓ Download {format.toUpperCase()}
            </button>
          )}
          {cropError && (
            <span className="crop-error-msg" onClick={() => setCropError(null)}>
              {cropError}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

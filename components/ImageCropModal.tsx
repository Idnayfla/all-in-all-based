'use client';
import { useRef, useState, useEffect } from 'react';

interface Props { url: string; onClose: () => void; }
interface CropRect { x: number; y: number; w: number; h: number; }
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move' | null;

export default function ImageCropModal({ url, onClose }: Props) {
  const imgRef  = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [crop, setCrop]           = useState<CropRect>({ x: 10, y: 10, w: 80, h: 80 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const dragging = useRef<{ handle: Handle; startMx: number; startMy: number; startCrop: CropRect } | null>(null);

  const startDrag = (handle: Handle, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); e.stopPropagation();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    dragging.current = { handle, startMx: clientX, startMy: clientY, startCrop: { ...crop } };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current || !wrapRef.current) return;
      const wRect = wrapRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
      const dx = ((clientX - dragging.current.startMx) / wRect.width) * 100;
      const dy = ((clientY - dragging.current.startMy) / wRect.height) * 100;
      const s = dragging.current.startCrop;
      const MIN = 5;
      setCrop(() => {
        let { x, y, w, h } = s;
        if (dragging.current!.handle === 'move') {
          x = Math.max(0, Math.min(100 - w, s.x + dx));
          y = Math.max(0, Math.min(100 - h, s.y + dy));
        } else if (dragging.current!.handle === 'nw') {
          const nx = Math.min(s.x + dx, s.x + s.w - MIN); w = s.w - (nx - s.x); x = nx;
          const ny = Math.min(s.y + dy, s.y + s.h - MIN); h = s.h - (ny - s.y); y = ny;
        } else if (dragging.current!.handle === 'ne') {
          w = Math.max(MIN, s.w + dx);
          const ny = Math.min(s.y + dy, s.y + s.h - MIN); h = s.h - (ny - s.y); y = ny;
        } else if (dragging.current!.handle === 'sw') {
          const nx = Math.min(s.x + dx, s.x + s.w - MIN); w = s.w - (nx - s.x); x = nx;
          h = Math.max(MIN, s.h + dy);
        } else if (dragging.current!.handle === 'se') {
          w = Math.max(MIN, s.w + dx); h = Math.max(MIN, s.h + dy);
        }
        return {
          x: Math.max(0, x), y: Math.max(0, y),
          w: Math.min(w, 100 - Math.max(0, x)),
          h: Math.min(h, 100 - Math.max(0, y)),
        };
      });
    };
    const onUp = () => { dragging.current = null; };
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
  }, []);

  const applyCrop = () => {
    const img = imgRef.current;
    if (!img) return;
    const scaleX = img.naturalWidth  / img.offsetWidth;
    const scaleY = img.naturalHeight / img.offsetHeight;
    const sx = (crop.x / 100) * img.offsetWidth  * scaleX;
    const sy = (crop.y / 100) * img.offsetHeight * scaleY;
    const sw = (crop.w / 100) * img.offsetWidth  * scaleX;
    const sh = (crop.h / 100) * img.offsetHeight * scaleY;
    const canvas = document.createElement('canvas');
    canvas.width = sw; canvas.height = sh;
    canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    setCroppedUrl(canvas.toDataURL('image/png'));
  };

  const download = () => {
    if (!croppedUrl) return;
    const a = document.createElement('a');
    a.href = croppedUrl; a.download = 'cropped.png'; a.click();
  };

  return (
    <div className="crop-overlay" onClick={onClose}>
      <div className="crop-modal" onClick={e => e.stopPropagation()}>
        <div className="crop-modal-header">
          <span className="crop-modal-title">◈ Crop Image</span>
          <button className="crop-modal-close" onClick={onClose}>✕</button>
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
                  <div className="crop-shade crop-shade-b" style={{ top: `${crop.y + crop.h}%`, height: `${100 - crop.y - crop.h}%` }} />
                  <div className="crop-shade crop-shade-l" style={{ top: `${crop.y}%`, height: `${crop.h}%`, width: `${crop.x}%` }} />
                  <div className="crop-shade crop-shade-r" style={{ top: `${crop.y}%`, height: `${crop.h}%`, left: `${crop.x + crop.w}%`, width: `${100 - crop.x - crop.w}%` }} />
                  <div
                    className="crop-rect"
                    style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
                    onMouseDown={e => startDrag('move', e)}
                    onTouchStart={e => startDrag('move', e)}
                  >
                    {(['nw','ne','sw','se'] as const).map(h => (
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
              {croppedUrl
                ? <img src={croppedUrl} alt="cropped" className="crop-preview-img" />
                : <div className="crop-preview-empty">Apply crop to preview</div>
              }
            </div>
          </div>
        </div>

        <div className="crop-modal-footer">
          <button className="crop-apply-btn" onClick={applyCrop} disabled={!imgLoaded}>
            Apply Crop
          </button>
          {croppedUrl && (
            <button className="crop-download-btn" onClick={download}>↓ Download PNG</button>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';
import { useState, useEffect } from 'react';
import { LogoConfig, LOGO_DEFAULTS } from '@/hooks/useLogoConfig';
import LogoDisplay from './LogoDisplay';

const SHIMMER_SWATCHES = ['#a89aff', '#6af7c8', '#f7c86a', '#ff6b6b', '#ffffff', '#6af7f7'];
const ICON_BG_SWATCHES = ['#0a0a0f', '#15102a', '#0a1020', '#1a1018'];
const SHAPES: LogoConfig['iconShape'][] = ['bolt', 'diamond', 'hex', 'circle'];
const SHAPE_LABELS: Record<string, string> = { bolt: '⚡', diamond: '◆', hex: '⬡', circle: '●' };

export default function LogoEditorModal({ config, onSave, onClose }: {
  config: LogoConfig;
  onSave: (c: LogoConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<LogoConfig>({ ...config });
  const patch = (partial: Partial<LogoConfig>) => setDraft(d => ({ ...d, ...partial }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Only updates draft — real config unchanged until Save is clicked
  const handleReset = () => setDraft({ ...LOGO_DEFAULTS });

  return (
    <div className="logo-editor-backdrop" onClick={onClose}>
      <div className="logo-editor-panel" onClick={e => e.stopPropagation()}>

        <div className="logo-editor-header">
          <span className="logo-editor-title">Customize Logo</span>
          <button className="logo-editor-close" onClick={onClose}>✕</button>
        </div>

        <div className="logo-preview-wrap">
          <LogoDisplay config={draft} />
        </div>

        <div className="logo-editor-controls">

          <label className="logo-editor-label">Name</label>
          <input
            className="logo-editor-input"
            value={draft.text}
            maxLength={12}
            onChange={e => patch({ text: e.target.value })}
          />

          <label className="logo-editor-label">Icon shape</label>
          <div className="logo-shape-picker">
            {SHAPES.map(s => (
              <button
                key={s}
                className={`logo-shape-btn${draft.iconShape === s ? ' active' : ''}`}
                onClick={() => patch({ iconShape: s })}
                title={s}
              >
                {SHAPE_LABELS[s]}
              </button>
            ))}
          </div>

          <label className="logo-editor-label">Shimmer color</label>
          <div className="logo-swatch-row">
            {SHIMMER_SWATCHES.map(c => (
              <button
                key={c}
                className={`logo-swatch${draft.shimmerColor === c ? ' active' : ''}`}
                style={{ background: c }}
                onClick={() => patch({ shimmerColor: c })}
              />
            ))}
            <input
              type="color"
              className="logo-color-input"
              value={draft.shimmerColor}
              onChange={e => patch({ shimmerColor: e.target.value })}
              title="Custom shimmer color"
            />
          </div>

          <label className="logo-editor-label">Icon background</label>
          <div className="logo-swatch-row">
            {ICON_BG_SWATCHES.map(c => (
              <button
                key={c}
                className={`logo-swatch${draft.iconBg === c ? ' active' : ''}`}
                style={{ background: c, outline: c === '#0a0a0f' ? '1px solid #3a3060' : 'none', outlineOffset: '1px' }}
                onClick={() => patch({ iconBg: c })}
              />
            ))}
            <input
              type="color"
              className="logo-color-input"
              value={draft.iconBg}
              onChange={e => patch({ iconBg: e.target.value })}
              title="Custom icon background"
            />
          </div>

          <label className="logo-editor-label">
            Speed <span className="logo-editor-value">{draft.speed.toFixed(1)}s</span>
          </label>
          <div className="logo-slider-row">
            <span className="logo-slider-cap">Fast</span>
            <input
              type="range" min="0.8" max="4.0" step="0.1"
              className="logo-editor-slider"
              value={draft.speed}
              onChange={e => patch({ speed: parseFloat(e.target.value) })}
            />
            <span className="logo-slider-cap">Slow</span>
          </div>

          <label className="logo-editor-label">
            Shimmer width <span className="logo-editor-value">{draft.shimmerWidth}%</span>
          </label>
          <div className="logo-slider-row">
            <span className="logo-slider-cap">Narrow</span>
            <input
              type="range" min="15" max="70" step="5"
              className="logo-editor-slider"
              value={draft.shimmerWidth}
              onChange={e => patch({ shimmerWidth: parseInt(e.target.value, 10) })}
            />
            <span className="logo-slider-cap">Wide</span>
          </div>

        </div>

        <div className="logo-editor-footer">
          <button className="logo-reset-link" onClick={handleReset}>Reset to defaults</button>
          {/* Note: reset only updates draft/preview — Save must be clicked to persist */}
          <button className="logo-save-btn" onClick={() => onSave(draft)}>Save</button>
        </div>

      </div>
    </div>
  );
}

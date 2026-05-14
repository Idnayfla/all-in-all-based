'use client';
import { useEffect, useRef } from 'react';

export interface AppTheme {
  mode: 'dark' | 'oled' | 'light';
  accent: string;
  fontMono: string;
}

export const DEFAULT_THEME: AppTheme = {
  mode: 'dark',
  accent: '#7c6af7',
  fontMono: "'Space Mono', monospace",
};

const ACCENT_SWATCHES = [
  { color: '#7c6af7', label: 'Purple' },
  { color: '#6af7c8', label: 'Cyan' },
  { color: '#f76aaa', label: 'Pink' },
  { color: '#f7a56a', label: 'Orange' },
  { color: '#6aadf7', label: 'Blue' },
  { color: '#6af7a5', label: 'Green' },
];

const FONTS = [
  { value: "'Space Mono', monospace",    label: 'Space Mono' },
  { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono' },
  { value: "'Fira Code', monospace",     label: 'Fira Code' },
  { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono' },
];

export function applyTheme(theme: AppTheme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.mode === 'dark' ? '' : theme.mode);
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--font-mono', theme.fontMono);
  document.body.style.fontFamily = theme.fontMono;
}

export function loadTheme(): AppTheme {
  try {
    const raw = localStorage.getItem('based_theme');
    if (raw) return { ...DEFAULT_THEME, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_THEME;
}

export function saveThemeLocally(theme: AppTheme) {
  localStorage.setItem('based_theme', JSON.stringify(theme));
}

interface Props {
  theme: AppTheme;
  onChange: (theme: AppTheme) => void;
}

export default function ThemeCustomizer({ theme, onChange }: Props) {
  const colorInputRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<AppTheme>) => {
    onChange({ ...theme, ...patch });
  };

  const isCustomAccent = !ACCENT_SWATCHES.find(s => s.color === theme.accent);

  return (
    <div className="theme-customizer">
      {/* Mode */}
      <div className="theme-row">
        <span className="theme-row-label">Mode</span>
        <div className="theme-mode-btns">
          {(['dark', 'oled', 'light'] as const).map(m => (
            <button
              key={m}
              className={`theme-mode-btn${theme.mode === m ? ' active' : ''}`}
              onClick={() => update({ mode: m })}
            >
              {m === 'dark' ? '◑ Dark' : m === 'oled' ? '● OLED' : '○ Light'}
            </button>
          ))}
        </div>
      </div>

      {/* Accent color */}
      <div className="theme-row">
        <span className="theme-row-label">Accent Color</span>
        <div className="theme-accent-swatches">
          {ACCENT_SWATCHES.map(s => (
            <button
              key={s.color}
              className={`theme-swatch${theme.accent === s.color ? ' active' : ''}`}
              style={{ background: s.color }}
              title={s.label}
              onClick={() => update({ accent: s.color })}
            />
          ))}
          <div
            className={`theme-swatch-custom${isCustomAccent ? ' active' : ''}`}
            style={{ background: isCustomAccent ? theme.accent : 'transparent' }}
            title="Custom color"
            onClick={() => colorInputRef.current?.click()}
          >
            {!isCustomAccent && <span>+</span>}
            <input
              ref={colorInputRef}
              type="color"
              value={theme.accent}
              onChange={e => update({ accent: e.target.value })}
              style={{ position: 'absolute', opacity: 0, width: 28, height: 28, cursor: 'pointer' }}
            />
          </div>
        </div>
      </div>

      {/* Font */}
      <div className="theme-row">
        <span className="theme-row-label">Font</span>
        <select
          className="theme-font-select"
          value={theme.fontMono}
          onChange={e => update({ fontMono: e.target.value })}
          style={{ fontFamily: theme.fontMono }}
        >
          {FONTS.map(f => (
            <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

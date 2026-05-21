'use client';
import { useRef, useEffect, useState } from 'react';

export type PersonaKey = 'based' | 'coder' | 'designer' | 'advisor' | 'coach';

export const PERSONAS: {
  key: PersonaKey;
  name: string;
  desc: string;
  symbol: string;
}[] = [
  { key: 'based', name: 'Based', desc: 'Default personality', symbol: 'B>' },
  { key: 'coder', name: 'Coder', desc: 'Senior engineer — precise, code-first', symbol: '◈' },
  { key: 'designer', name: 'Designer', desc: 'UI/UX — layouts, aesthetics, opinions', symbol: '⬡' },
  { key: 'advisor', name: 'Advisor', desc: 'Strategic — frameworks, trade-offs', symbol: '◉' },
  { key: 'coach', name: 'Coach', desc: 'Growth — clarity, accountability', symbol: '⊙' },
];

interface PersonaSwitcherProps {
  persona: PersonaKey;
  onChange: (p: PersonaKey) => void;
  disabled?: boolean;
}

export default function PersonaSwitcher({ persona, onChange, disabled }: PersonaSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = PERSONAS.find(p => p.key === persona) ?? PERSONAS[0];

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(v => !v);
    }
  };

  return (
    <div className="persona-switcher" ref={rootRef}>
      <button
        type="button"
        className={`persona-switcher-btn${open ? ' active' : ''}`}
        onClick={() => !disabled && setOpen(v => !v)}
        onKeyDown={handleKey}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Persona: ${current.name}`}
      >
        <span className="persona-switcher-symbol">{current.symbol}</span>
        <span className="persona-switcher-name">{current.name}</span>
        <span className="persona-switcher-arrow">▾</span>
      </button>

      {open && (
        <div className="persona-switcher-panel" role="listbox" aria-label="Select persona">
          {PERSONAS.map(p => (
            <button
              key={p.key}
              type="button"
              role="option"
              aria-selected={p.key === persona}
              className={`persona-switcher-option${p.key === persona ? ' selected' : ''}`}
              onClick={() => {
                onChange(p.key);
                setOpen(false);
              }}
            >
              <span className="persona-switcher-opt-symbol">{p.symbol}</span>
              <span className="persona-switcher-opt-label">
                <span className="persona-switcher-opt-name">{p.name}</span>
                <span className="persona-switcher-opt-desc">{p.desc}</span>
              </span>
              {p.key === persona && <span className="persona-switcher-check">◈</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

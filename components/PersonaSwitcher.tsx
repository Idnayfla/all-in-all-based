'use client';
import { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

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
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const current = PERSONAS.find(p => p.key === persona) ?? PERSONAS[0];

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggle = () => {
    if (disabled) return;
    if (!open && btnRef.current) {
      setRect(btnRef.current.getBoundingClientRect());
    }
    setOpen(v => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  };

  const panel = open && rect && mounted ? createPortal(
    <div
      className="persona-switcher-panel"
      role="listbox"
      aria-label="Select persona"
      style={{ position: 'fixed', top: rect.bottom + 8, left: rect.left, zIndex: 9999 }}
    >
      {PERSONAS.map(p => (
        <button
          key={p.key}
          type="button"
          role="option"
          aria-selected={p.key === persona}
          className={`persona-switcher-option${p.key === persona ? ' selected' : ''}`}
          onClick={() => { onChange(p.key); setOpen(false); }}
        >
          <span className="persona-switcher-opt-symbol">{p.symbol}</span>
          <span className="persona-switcher-opt-label">
            <span className="persona-switcher-opt-name">{p.name}</span>
            <span className="persona-switcher-opt-desc">{p.desc}</span>
          </span>
          {p.key === persona && <span className="persona-switcher-check">◈</span>}
        </button>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <div className="persona-switcher" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className={`persona-switcher-btn${open ? ' active' : ''}`}
        onClick={toggle}
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
      {panel}
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export type GenerationMode = 'chat' | 'flux' | 'nano-banana' | 'seedance';

const MODES: { value: GenerationMode; icon: string; label: string }[] = [
  { value: 'chat',        icon: '💬', label: 'Chat' },
  { value: 'flux',        icon: '🎨', label: 'Image · FLUX' },
  { value: 'nano-banana', icon: '🍌', label: 'Image · Nano Banana 2' },
  { value: 'seedance',    icon: '🎬', label: 'Video · Seedance 2.0' },
];

interface ModeDropdownProps {
  mode: GenerationMode;
  onChange: (m: GenerationMode) => void;
  disabled: boolean;
}

export default function ModeDropdown({ mode, onChange, disabled }: ModeDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const current = MODES.find(m => m.value === mode) ?? MODES[0];

  return (
    <div ref={ref} className="mode-dropdown">
      <motion.button
        className={`mode-dropdown-btn${mode !== 'chat' ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title="Switch generation mode"
        whileTap={{ scale: 0.93 }}
      >
        <span className="mode-dropdown-icon">{current.icon}</span>
        <motion.span
          className="mode-dropdown-arrow"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >▼</motion.span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="mode-dropdown-panel"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            {MODES.map(m => (
              <button
                key={m.value}
                className={`mode-dropdown-option${mode === m.value ? ' selected' : ''}`}
                onClick={() => { onChange(m.value); setOpen(false); }}
              >
                <span>{m.icon}</span>
                <span className="mode-dropdown-label">{m.label}</span>
                {mode === m.value && <span className="mode-dropdown-check">✓</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

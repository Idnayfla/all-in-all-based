'use client';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export type GenerationMode = 'chat' | 'flux' | 'nano-banana' | 'seedance' | 'music' | '3d';

const MODES: { value: GenerationMode; icon: string; label: string; pro?: boolean }[] = [
  { value: 'chat', icon: 'B>', label: 'Chat' },
  { value: 'flux', icon: '◈', label: 'Image · FLUX', pro: true },
  { value: 'nano-banana', icon: '◈', label: 'Image · Nano Banana 2', pro: true },
  { value: 'seedance', icon: '▸', label: 'Video · Seedance 2.0', pro: true },
  { value: 'music', icon: '♪', label: 'Music · Stable Audio', pro: true },
  { value: '3d', icon: '◉', label: '3D Scene · Three.js', pro: true },
];

interface ModeDropdownProps {
  mode: GenerationMode;
  onChange: (m: GenerationMode) => void;
  disabled: boolean;
  subscriptionTier?: 'free' | 'pro';
  onProRequired?: () => void;
  onPanelSwitch?: (panel: string) => void;
}

export default function ModeDropdown({
  mode,
  onChange,
  disabled,
  subscriptionTier,
  onProRequired,
  onPanelSwitch,
}: ModeDropdownProps) {
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
        >
          ▼
        </motion.span>
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
            {MODES.map(m => {
              const locked = !!m.pro && subscriptionTier === 'free';
              return (
                <button
                  key={m.value}
                  className={`mode-dropdown-option${mode === m.value ? ' selected' : ''}${locked ? ' mode-dropdown-option--locked' : ''}`}
                  onClick={() => {
                    if (locked) {
                      onProRequired?.();
                      setOpen(false);
                      return;
                    }
                    onChange(m.value);
                    if (m.value === '3d') {
                      onPanelSwitch?.('3d');
                    }
                    setOpen(false);
                  }}
                >
                  <span>{m.icon}</span>
                  <span className="mode-dropdown-label">{m.label}</span>
                  {locked ? (
                    <span className="mode-dropdown-pro-badge">⬡ Pro</span>
                  ) : (
                    mode === m.value && <span className="mode-dropdown-check">✓</span>
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

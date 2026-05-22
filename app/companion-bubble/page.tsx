'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

declare global {
  interface Window {
    bubbleAPI?: {
      toggle: () => void;
      onStateChange: (cb: (state: 'open' | 'closed') => void) => void;
    };
  }
}

export default function CompanionBubblePage() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    window.bubbleAPI?.onStateChange(state => setIsOpen(state === 'open'));
  }, []);

  return (
    <div className="desktop-bubble-root">
      <motion.button
        className={`desktop-bubble-btn${isOpen ? ' desktop-bubble-btn--open' : ''}`}
        onClick={() => window.bubbleAPI?.toggle()}
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: isOpen ? 1 : 3, repeat: Infinity, ease: 'easeInOut' }}
        aria-label="Toggle Based Companion"
      >
        <span className="desktop-bubble-label">B&gt;</span>
        <motion.span
          className="desktop-bubble-ring desktop-bubble-ring--1"
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: isOpen ? 1 : 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.span
          className="desktop-bubble-ring desktop-bubble-ring--2"
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{
            duration: isOpen ? 1 : 3,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: 0.4,
          }}
        />
      </motion.button>
    </div>
  );
}

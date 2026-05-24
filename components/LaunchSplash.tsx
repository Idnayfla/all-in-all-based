'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { playWelcomeAudio } from '@/lib/welcomeAudio';

type SplashState = 'waiting' | 'exiting' | 'done';

export default function LaunchSplash() {
  const [state, setState] = useState<SplashState | null>(null);

  useEffect(() => {
    if (window.location.pathname === '/companion') return;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) setState('waiting');
  }, []);

  function handleTap() {
    if (state !== 'waiting') return;
    setState('exiting');
    playWelcomeAudio();
    setTimeout(() => setState('done'), 450);
  }

  const visible = state === 'waiting' || state === 'exiting';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          className="launch-splash"
          onClick={handleTap}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="launch-splash__pulse" />
          <div className="launch-splash__content">
            <img
              src="/brand-icon-animated.svg"
              className="launch-splash__icon"
              alt="Based"
              width={96}
              height={96}
            />
            <h1 className="launch-splash__title">BASED</h1>
            <p className="launch-splash__tagline">your personal assistant AI</p>
          </div>
          <motion.p
            className="launch-splash__hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            Tap anywhere to enter
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Platform = 'android' | 'ios' | null;

export default function InstallPrompt() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<Platform>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Never show if already installed
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    // Never show if dismissed this session
    if (sessionStorage.getItem('install-dismissed')) return;

    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isAndroid = /android/i.test(ua);

    if (isIOS) {
      setPlatform('ios');
      const timer = setTimeout(() => setVisible(true), 3000);
      return () => clearTimeout(timer);
    }

    if (isAndroid) {
      function onBeforeInstallPrompt(e: Event) {
        e.preventDefault();
        deferredPrompt.current = e as BeforeInstallPromptEvent;
        setPlatform('android');
        const timer = setTimeout(() => setVisible(true), 3000);
        // Store timer reference for cleanup
        timerRef.current = timer;
      }
      window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    }
  }, []);

  function dismiss() {
    sessionStorage.setItem('install-dismissed', '1');
    setVisible(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  }

  async function install() {
    if (!deferredPrompt.current) return;
    await deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    if (outcome === 'accepted') deferredPrompt.current = null;
    setVisible(false);
  }

  if (!platform) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="install-prompt"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <div className="install-prompt__body">
            {platform === 'android' ? (
              <>
                <p className="install-prompt__text">Install Based for the full experience</p>
                <button className="install-prompt__install" onClick={install}>
                  Install
                </button>
              </>
            ) : (
              <p className="install-prompt__text">
                Install Based: tap <strong>Share</strong> then <strong>Add to Home Screen</strong>
              </p>
            )}
          </div>
          <button className="install-prompt__dismiss" onClick={dismiss} aria-label="Dismiss">
            ×
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ServiceWorkerInit() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {});

    function onControllerChange() {
      setUpdateReady(true);
    }

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () =>
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  useEffect(() => {
    if (!updateReady) return;
    const timer = setTimeout(() => setUpdateReady(false), 10_000);
    return () => clearTimeout(timer);
  }, [updateReady]);

  return (
    <AnimatePresence>
      {updateReady && (
        <motion.div
          key="sw-update"
          className="sw-update-toast"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
        >
          <span>Based updated</span>
          <button className="sw-update-toast__reload" onClick={() => window.location.reload()}>
            Reload
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

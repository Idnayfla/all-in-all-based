'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/** Spawn the lavender entrance ripple from center, then clean itself up. */
function fireEntranceRipple() {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'landing-entrance-ripple';
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

/**
 * Fires the lavender entrance ripple on every route change.
 * Skips the first render (the splash screen handles initial entry).
 */
export default function RouteRipple() {
  const pathname = usePathname();
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    fireEntranceRipple();
  }, [pathname]);

  return null;
}

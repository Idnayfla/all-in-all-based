import { useEffect, useRef } from 'react';

type Panel =
  | 'chat'
  | 'editor'
  | 'preview'
  | 'debug'
  | 'video'
  | 'studio'
  | 'image'
  | 'notes'
  | '3d'
  | 'spec';
const ORDER: Panel[] = [
  'chat',
  'editor',
  'preview',
  'debug',
  'video',
  'studio',
  'image',
  'notes',
  '3d',
  'spec',
];

export function useSwipePanels(active: Panel, setActive: (p: Panel) => void, enabled: boolean) {
  const startX = useRef(0);
  const startY = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    function onTouchStart(e: TouchEvent) {
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
    }

    function onTouchEnd(e: TouchEvent) {
      const dx = e.changedTouches[0].clientX - startX.current;
      const dy = e.changedTouches[0].clientY - startY.current;

      // Ignore vertical-dominant swipes (scrolling)
      if (Math.abs(dy) > Math.abs(dx)) return;
      if (Math.abs(dx) < 48) return;

      const idx = ORDER.indexOf(active);
      if (idx === -1) return;

      if (dx < 0 && idx < ORDER.length - 1) setActive(ORDER[idx + 1]); // swipe left → next
      if (dx > 0 && idx > 0) setActive(ORDER[idx - 1]); // swipe right → prev
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [active, setActive, enabled]);
}

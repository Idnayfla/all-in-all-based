import posthog from 'posthog-js';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = 'https://us.i.posthog.com';

/**
 * Called once from PostHogProvider's useEffect — guaranteed client-side.
 * Module-level init is intentionally removed: Next.js can evaluate modules
 * during SSR/edge pre-rendering where posthog-js may lock the singleton
 * with an empty token before the real key is available, causing all
 * subsequent posthog.init() calls (which posthog-js deduplicates) to be
 * silently ignored and events never sent.
 */
export function initPostHog() {
  if (typeof window === 'undefined') return;
  if (!POSTHOG_KEY) return;
  // posthog-js deduplicates init calls — only initialises once per page load
  if (posthog.__loaded) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false,
    persistence: 'localStorage+cookie',
    loaded: ph => {
      // Expose on window for devtools inspection: window.__posthog?.config?.token
      if (process.env.NODE_ENV === 'development') {
        (window as unknown as Record<string, unknown>).__posthog = ph;
      }
    },
  });
}

export function identifyUser(userId: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  posthog.identify(userId, props);
}

export function track(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  posthog.capture(event, props);
}

export { posthog };

// Server-side event capture via PostHog REST API — no posthog-node needed.
// Fire-and-forget: never awaited, never throws.
export function captureServerEvent(
  distinctId: string,
  event: string,
  properties: Record<string, unknown>
): void {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || !distinctId) return;
  void fetch('https://us.i.posthog.com/capture/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, event, distinct_id: distinctId, properties }),
  }).catch(() => {});
}

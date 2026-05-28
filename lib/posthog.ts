import posthog from 'posthog-js';

if (typeof window !== 'undefined') {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (key) {
    posthog.init(key, {
      api_host: 'https://us.i.posthog.com',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false,
      persistence: 'localStorage+cookie',
    });
  }
}

// kept for backward compatibility — PostHogProvider still calls this
export function initPostHog() {}

export function identifyUser(userId: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  posthog.identify(userId, props);
}

export function track(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  posthog.capture(event, props);
}

export { posthog };

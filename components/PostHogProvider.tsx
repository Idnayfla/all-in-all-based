'use client';
import { useEffect } from 'react';
import { initPostHog, identifyUser } from '@/lib/posthog';

export default function PostHogProvider({
  userId,
  email,
  tier,
  children,
}: {
  userId?: string;
  email?: string;
  tier?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    initPostHog();
  }, []);

  useEffect(() => {
    if (userId) {
      identifyUser(userId, { email, tier });
    }
  }, [userId, email, tier]);

  return <>{children}</>;
}

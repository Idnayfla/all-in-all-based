'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

async function fireCompleteRegistrationIfNew() {
  const { data } = await supabase.auth.getUser();
  const createdAt = data?.user?.created_at;
  if (createdAt && Date.now() - new Date(createdAt).getTime() < 60_000) {
    (window as Window & { fbq?: (...args: unknown[]) => void }).fbq?.(
      'track',
      'CompleteRegistration'
    );
  }
}

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    const hashType = new URLSearchParams(window.location.hash.slice(1)).get('type');

    if (hashType === 'recovery') {
      router.replace('/auth/reset-password');
      return;
    }

    let done = false;
    const go = (path: string) => {
      if (!done) {
        done = true;
        router.replace(path);
      }
    };

    if (code) {
      let exchangeStarted = false;

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(event => {
        if (!exchangeStarted) return;
        if (event === 'PASSWORD_RECOVERY') go('/auth/reset-password');
        else if (event === 'SIGNED_IN') {
          fireCompleteRegistrationIfNew().finally(() => go('/'));
        } else if (event === 'TOKEN_REFRESHED') go('/');
      });

      exchangeStarted = true;
      supabase.auth.exchangeCodeForSession(code).catch(() => go('/'));

      return () => subscription.unsubscribe();
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN') {
        fireCompleteRegistrationIfNew().finally(() => go('/'));
      } else if (event === 'TOKEN_REFRESHED') go('/');
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) go('/');
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0d0d0d',
        color: '#a0a0a0',
        fontFamily: 'monospace',
        fontSize: '14px',
      }}
    >
      Signing in...
    </div>
  );
}

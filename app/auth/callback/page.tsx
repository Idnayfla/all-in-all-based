'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/auth/reset-password');
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        router.replace('/');
      }
    });

    const hashType = new URLSearchParams(window.location.hash.slice(1)).get('type');

    if (code) {
      supabase.auth.exchangeCodeForSession(code).catch(() => {
        router.replace('/');
      });
    } else if (hashType === 'recovery') {
      // let onAuthStateChange fire PASSWORD_RECOVERY and handle the redirect
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) router.replace('/');
      });
    }

    return () => subscription.unsubscribe();
  }, [router]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0d0d0d', color: '#a0a0a0',
      fontFamily: 'monospace', fontSize: '14px',
    }}>
      Signing in...
    </div>
  );
}

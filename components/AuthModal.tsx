'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';

type Tab = 'signin' | 'signup';

interface Props {
  defaultTab?: Tab;
  onClose?: () => void;
}

export default function AuthModal({ defaultTab = 'signin', onClose }: Props) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const clearForm = () => {
    setEmail('');
    setPassword('');
    setConfirm('');
    setError('');
    setMessage('');
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error)
      setError(
        error.message.toLowerCase().includes('rate limit')
          ? 'Too many emails sent recently — please wait a few minutes and try again.'
          : error.message
      );
    else setMessage('Check your inbox to verify your email.');
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email address first');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/send-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? 'Failed to send reset email');
      else setMessage('Password reset email sent. Check your inbox.');
    } catch {
      setError('Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="auth-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="auth-box"
        initial={{ opacity: 0, scale: 0.94, y: -12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: -12 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      >
        {onClose && (
          <button className="auth-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
        <div className="auth-logo">B&gt;</div>
        <div className="auth-title">Welcome to Based</div>

        <div className="auth-oauth-stack">
          <button className="auth-google-btn" onClick={() => handleOAuth('google')}>
            <span className="auth-google-icon">G</span>
            Continue with Google
          </button>
          <button className="auth-oauth-btn" onClick={() => handleOAuth('github')}>
            <span className="auth-oauth-icon">GH</span>
            Continue with GitHub
          </button>
        </div>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab${tab === 'signin' ? ' active' : ''}`}
            onClick={() => {
              setTab('signin');
              clearForm();
            }}
          >
            Sign In
          </button>
          <button
            className={`auth-tab${tab === 'signup' ? ' active' : ''}`}
            onClick={() => {
              setTab('signup');
              clearForm();
            }}
          >
            Sign Up
          </button>
        </div>

        {message ? (
          <div className="auth-message">{message}</div>
        ) : (
          <form
            onSubmit={tab === 'signin' ? handleSignIn : handleSignUp}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <input
              className="auth-input"
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <input
              className="auth-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
            />
            {tab === 'signup' && (
              <input
                className="auth-input"
                type="password"
                placeholder="Confirm password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            )}
            {error && <div className="auth-error">{error}</div>}
            <motion.button
              className="auth-submit"
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.97 }}
              style={{ marginTop: 6 }}
            >
              {loading ? '...' : tab === 'signin' ? 'Sign In' : 'Create Account'}
            </motion.button>
            {tab === 'signin' && (
              <button
                type="button"
                className="auth-forgot"
                onClick={handleForgotPassword}
                style={{ marginTop: 2 }}
              >
                Forgot password?
              </button>
            )}
            {tab === 'signup' && (
              <p className="auth-consent">
                By creating an account you agree to our{' '}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="auth-consent-link"
                >
                  Terms
                </a>{' '}
                and{' '}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="auth-consent-link"
                >
                  Privacy Policy
                </a>
                .
              </p>
            )}
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}

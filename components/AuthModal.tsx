'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';

type Tab = 'signin' | 'signup';

const OAUTH_PROVIDERS = [
  { id: 'google'  as const, label: 'Google',    icon: 'G'  },
  { id: 'github'  as const, label: 'GitHub',    icon: '⌥' },
  { id: 'azure'   as const, label: 'Microsoft', icon: 'M'  },
  { id: 'apple'   as const, label: 'Apple',     icon: '' },
];

export default function AuthModal() {
  const [tab, setTab]         = useState<Tab>('signin');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [message, setMessage] = useState('');

  const clearForm = () => {
    setEmail(''); setPassword(''); setConfirm('');
    setError(''); setMessage('');
  };

  const handleOAuth = async (provider: typeof OAUTH_PROVIDERS[number]['id']) => {
    setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match"); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return; }
    setError(''); setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setMessage('Check your inbox to verify your email.');
  };

  const handleForgotPassword = async () => {
    if (!email) { setError('Enter your email address first'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    if (error) setError(error.message);
    else setMessage('Password reset email sent.');
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
        <div className="auth-logo">B&gt;</div>
        <div className="auth-title">Welcome to Based</div>

        <div className="auth-oauth-grid">
          {OAUTH_PROVIDERS.map(p => (
            <button
              key={p.id}
              className="auth-oauth-btn"
              onClick={() => handleOAuth(p.id)}
            >
              <span className="auth-oauth-icon">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>

        <div className="auth-divider"><span>or</span></div>

        <div className="auth-tabs">
          <button
            className={`auth-tab${tab === 'signin' ? ' active' : ''}`}
            onClick={() => { setTab('signin'); clearForm(); }}
          >Sign In</button>
          <button
            className={`auth-tab${tab === 'signup' ? ' active' : ''}`}
            onClick={() => { setTab('signup'); clearForm(); }}
          >Sign Up</button>
        </div>

        {message ? (
          <div className="auth-message">{message}</div>
        ) : (
          <form onSubmit={tab === 'signin' ? handleSignIn : handleSignUp}>
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
            >
              {loading ? '...' : tab === 'signin' ? 'Sign In' : 'Create Account'}
            </motion.button>
            {tab === 'signin' && (
              <button
                type="button"
                className="auth-forgot"
                onClick={handleForgotPassword}
              >
                Forgot password?
              </button>
            )}
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}

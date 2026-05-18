'use client';

import { useState, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function BetaGateForm() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || loading) return;
    setLoading(true);
    setError('');

    const res = await fetch('/api/beta-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    });

    if (res.ok) {
      const from = searchParams.get('from') ?? '/';
      window.location.href = from;
    } else {
      setError('Invalid access code.');
      setLoading(false);
      inputRef.current?.select();
    }
  }

  return (
    <form onSubmit={submit} className="gate-form">
      <input
        ref={inputRef}
        className={`gate-input${error ? ' gate-input--error' : ''}`}
        type="text"
        value={code}
        onChange={e => { setCode(e.target.value); setError(''); }}
        placeholder="Access code"
        autoFocus
        autoComplete="off"
        spellCheck={false}
      />
      {error && <div className="gate-error">{error}</div>}
      <button className="gate-btn" type="submit" disabled={loading || !code.trim()}>
        {loading ? '…' : 'Enter →'}
      </button>
    </form>
  );
}

export default function BetaGatePage() {
  return (
    <div className="gate-root">
      <div className="gate-card">
        <div className="gate-logo">B&gt;</div>
        <h1 className="gate-title">Beta Access</h1>
        <p className="gate-desc">This is a private beta. Enter your access code to continue.</p>

        <Suspense fallback={<div className="gate-loading">Loading…</div>}>
          <BetaGateForm />
        </Suspense>

        <p className="gate-hint">
          No code? <a href="mailto:husgogogo@gmail.com" className="gate-hint-link">Request access</a>
        </p>
      </div>
    </div>
  );
}

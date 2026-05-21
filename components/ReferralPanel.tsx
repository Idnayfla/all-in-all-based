'use client';

import { useState, useEffect } from 'react';

interface ReferralData {
  code: string;
  referralCount: number;
  bonusDaysLeft: number;
}

interface Props {
  getHeaders: () => Promise<HeadersInit>;
}

export default function ReferralPanel({ getHeaders }: Props) {
  const [data, setData] = useState<ReferralData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getHeaders()
      .then(headers =>
        fetch('/api/referral', { headers }).then(r => {
          if (!r.ok) throw new Error(`Request failed (${r.status})`);
          return r.json();
        })
      )
      .then((d: ReferralData) => setData(d))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load referral info')
      );
  }, [getHeaders]);

  if (error) return <div className="referral-loading">{error}</div>;
  if (!data) return <div className="referral-loading">Loading…</div>;

  const link = `https://getbased.dev/?ref=${data.code}`;

  function copyLink() {
    navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="referral-panel">
      <p className="referral-desc">
        Share Based, earn Pro time for you and a friend. Your friend gets{' '}
        <strong>3 days free Pro</strong> when they sign up. You get <strong>7 days free Pro</strong>{' '}
        when they subscribe.
      </p>

      <div className="referral-link-row">
        <span className="referral-link-text">{link}</span>
        <button className="referral-copy-btn" onClick={copyLink}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      <div className="referral-stats">
        <div className="referral-stat">
          <span className="referral-stat-value">{data.referralCount}</span>
          <span className="referral-stat-label">successful referrals</span>
        </div>
        {data.bonusDaysLeft > 0 && (
          <div className="referral-stat referral-stat--bonus">
            <span className="referral-stat-value">{data.bonusDaysLeft}</span>
            <span className="referral-stat-label">bonus Pro days left</span>
          </div>
        )}
      </div>
    </div>
  );
}

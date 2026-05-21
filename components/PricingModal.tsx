'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { track } from '@/lib/posthog';

interface PricingModalProps {
  reason?: 'generations' | 'projects' | 'upgrade';
  generationsUsed?: number;
  projectCount?: number;
  onClose: () => void;
  getHeaders: () => Promise<HeadersInit>;
  onSwitchToFreeAI?: () => void;
}

const REASON_MSG: Record<string, string> = {
  generations: "You've used all 10 free generations this month.",
  projects: 'Free accounts are limited to 3 projects.',
  upgrade: 'Unlock everything Based has to offer.',
};

const PRO_FEATURES = [
  'Unlimited builds — no monthly cap, no anxiety',
  'Unlimited projects — save everything, lose nothing',
  'Based AI — Claude Sonnet, not free-tier Groq',
  'Priority speed — seconds, not minutes',
  'All media generation — images, video, and music',
  'Voice activation — talk to Based, it listens',
  'Windows companion — floating AI on your desktop',
  'AI memory — remembers your style across every session',
  'Gallery + sharing — publish builds, remix the community',
  'You make this possible — every subscription funds the next feature',
];

const FREE_LIMITS = [
  '10 generations / month',
  '3 projects',
  'Chat + code generation',
  'Cloud sync across devices',
];

export default function PricingModal({
  reason = 'upgrade',
  generationsUsed,
  projectCount,
  onClose,
  getHeaders,
  onSwitchToFreeAI,
}: PricingModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const upgrade = async () => {
    track('pro_upgrade_clicked', { reason });
    (window as Window & { fbq?: (...args: unknown[]) => void }).fbq?.('track', 'InitiateCheckout');
    setLoading(true);
    setError('');
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/stripe/checkout', { method: 'POST', headers });
      const { url, error: err } = await res.json();
      if (err) throw new Error(err);
      window.location.href = url;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="pricing-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="pricing-card"
        initial={{ scale: 0.94, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 16 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <button className="pricing-close" onClick={onClose}>
          ✕
        </button>

        <div className="pricing-header">
          <div className="pricing-logo">B&gt;</div>
          <h2 className="pricing-title">Upgrade to Based Pro</h2>
          <p className="pricing-reason">{REASON_MSG[reason]}</p>
        </div>

        <div className="pricing-tiers">
          <div className="pricing-tier pricing-tier--free">
            <div className="pricing-tier-name">Free</div>
            <div className="pricing-tier-price">
              $0 <span>/mo</span>
            </div>
            <ul className="pricing-tier-list">
              {FREE_LIMITS.map(f => (
                <li key={f}>
                  <span className="pricing-check pricing-check--dim">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            {generationsUsed !== undefined && (
              <div className="pricing-usage-bar">
                <div
                  className="pricing-usage-fill"
                  style={{ width: `${Math.min(100, (generationsUsed / 10) * 100)}%` }}
                />
                <span>{generationsUsed}/10 generations used</span>
              </div>
            )}
          </div>

          <div className="pricing-tier pricing-tier--pro">
            <div className="pricing-tier-badge">Most popular</div>
            <div className="pricing-tier-name">Pro</div>
            <div className="pricing-tier-price">
              <span className="pricing-original-price">$20</span>
              $12 <span>/mo</span>
            </div>
            <div className="pricing-founding-label">Founding member price</div>
            <ul className="pricing-tier-list">
              {PRO_FEATURES.map(f => (
                <li key={f}>
                  <span className="pricing-check">✓</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {error && <div className="pricing-error">{error}</div>}

        <button className="pricing-upgrade-btn" onClick={upgrade} disabled={loading}>
          {loading ? 'Redirecting to Stripe...' : 'Upgrade to Pro — $12/month  ·  was $20'}
        </button>
        {onSwitchToFreeAI && (
          <button className="pricing-free-ai-btn" onClick={onSwitchToFreeAI}>
            Or use Free AI — Llama 3.3 70B, unlimited, unrestricted →
          </button>
        )}
        <p className="pricing-note">Cancel anytime. Powered by Stripe.</p>
      </motion.div>
    </motion.div>
  );
}

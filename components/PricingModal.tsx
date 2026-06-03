'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { track } from '@/lib/posthog';

interface PricingModalProps {
  reason?: 'generations' | 'projects' | 'companion' | 'upgrade';
  generationsUsed?: number;
  projectCount?: number;
  onClose: () => void;
  getHeaders: () => Promise<HeadersInit>;
  onSwitchToFreeAI?: () => void;
}

const REASON_MSG: Record<string, string> = {
  generations: "You've used all 10 free builds this month. Keep going with Pro.",
  projects: "You've got 3 projects — Pro removes the cap entirely.",
  upgrade: 'One subscription. Unlimited everything.',
  companion: 'The full companion experience is a Pro feature.',
};

const PRO_FEATURES = [
  'Unlimited builds — no cap, no anxiety',
  'Based AI — Claude Sonnet, not free-tier Llama',
  'AI memory — remembers your style, projects, and context',
  'All creative tools — images, video, and music generation',
  'Unlimited projects — save everything, lose nothing',
  'Windows companion — floating AI on your desktop',
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
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new Error('Payment service unavailable — please try again or contact support.');
      }
      const { url, error: err } = await res.json();
      if (err) throw new Error(err);
      if (!url) throw new Error('No checkout URL returned — please try again.');
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

        <div className="pricing-payment-methods">
          <span className="pricing-payment-badge">Apple Pay</span>
          <span className="pricing-payment-badge">Google Pay</span>
          <span className="pricing-payment-badge">Visa</span>
          <span className="pricing-payment-badge">Mastercard</span>
          <span className="pricing-payment-badge">+ more</span>
        </div>

        <p className="pricing-founder-note">
          Made by one person in Singapore. Your $12/mo directly funds the next feature.
        </p>

        <p className="pricing-legal">
          By upgrading you agree to our{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="pricing-legal-link">
            Terms of Service
          </a>
          {', '}
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="pricing-legal-link"
          >
            Privacy Policy
          </a>
          {' and '}
          <a
            href="/refund"
            target="_blank"
            rel="noopener noreferrer"
            className="pricing-legal-link"
          >
            Refund Policy
          </a>
          .
        </p>

        <button className="pricing-upgrade-btn" onClick={upgrade} disabled={loading}>
          {loading ? 'Redirecting to Stripe...' : 'Keep building — $12/month  ·  was $20'}
        </button>
        {onSwitchToFreeAI && (
          <button className="pricing-free-ai-btn" onClick={onSwitchToFreeAI}>
            Not ready? Use Llama 3.3 instead — slower, no memory, no Claude
          </button>
        )}
        <p className="pricing-note">Cancel anytime. Powered by Stripe.</p>
      </motion.div>
    </motion.div>
  );
}

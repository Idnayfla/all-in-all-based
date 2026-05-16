'use client';
import { motion } from 'framer-motion';

interface Props {
  onSignIn: (tab?: 'signin' | 'signup') => void;
}

const FEATURES = [
  { icon: '⟳', title: 'Live Preview', desc: 'See your app render in real time as Based generates each file.' },
  { icon: '◉', title: 'AI Memory', desc: 'Based learns your style and remembers context across every session.' },
  { icon: '◈', title: 'Multi-file Apps', desc: 'HTML, CSS, JS, and more — all generated together and kept in sync.' },
];

export default function LandingPage({ onSignIn }: Props) {
  return (
    <div className="landing-root">
      <header className="landing-header">
        <div className="landing-logo">B&gt;</div>
        <button className="landing-signin-btn" onClick={() => onSignIn('signin')}>Sign In</button>
      </header>

      <section className="landing-hero">
        <motion.div
          className="landing-hero-badge"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          AI Dev Studio
        </motion.div>
        <motion.h1
          className="landing-headline"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          You describe it.<br />Based builds it.
        </motion.h1>
        <motion.p
          className="landing-subheadline"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          Generate HTML apps, games, dashboards, and tools from a single message.
          Live preview. Persistent memory. No setup required.
        </motion.p>
        <motion.div
          className="landing-ctas"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <button className="landing-cta-primary" onClick={() => onSignIn('signup')}>Start Building Free</button>
          <button className="landing-cta-secondary" onClick={() => onSignIn('signin')}>Sign In</button>
        </motion.div>
        <motion.div
          className="landing-hint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          Free plan · 10 generations/month · No credit card required
        </motion.div>
      </section>

      <section className="landing-features">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            className="landing-feature-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + i * 0.1 }}
          >
            <span className="landing-feature-icon">{f.icon}</span>
            <div className="landing-feature-title">{f.title}</div>
            <div className="landing-feature-desc">{f.desc}</div>
          </motion.div>
        ))}
      </section>

      <section className="landing-pricing">
        <motion.div
          className="landing-pricing-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          Simple pricing
        </motion.div>
        <motion.div
          className="landing-pricing-tiers"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
        >
          <div className="landing-tier landing-tier--free">
            <div className="landing-tier-label">Free</div>
            <div className="landing-tier-price">$0<span>/mo</span></div>
            <ul className="landing-tier-features">
              <li>10 generations/month</li>
              <li>3 projects</li>
              <li>Live preview</li>
              <li>AI memory</li>
            </ul>
            <button className="landing-tier-cta" onClick={() => onSignIn('signup')}>Get Started</button>
          </div>
          <div className="landing-tier landing-tier--pro">
            <div className="landing-tier-pro-badge">PRO</div>
            <div className="landing-tier-label">Pro</div>
            <div className="landing-tier-price">$12<span>/mo</span></div>
            <ul className="landing-tier-features">
              <li>Unlimited generations</li>
              <li>Unlimited projects</li>
              <li>AI Companion</li>
              <li>Priority support</li>
            </ul>
            <button className="landing-tier-cta landing-tier-cta--pro" onClick={() => onSignIn('signup')}>Upgrade to Pro</button>
          </div>
        </motion.div>
      </section>

      <footer className="landing-footer">
        <span>Built by Hus Alfyandi</span>
        <span className="landing-footer-sep">·</span>
        <span>getbased.dev</span>
      </footer>
    </div>
  );
}

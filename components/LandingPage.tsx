'use client';
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface Props {
  onSignIn: (tab?: 'signin' | 'signup') => void;
}

interface GalleryItem {
  id: string;
  project_name: string;
  author_name: string | null;
  remix_count: number;
}

const FEATURES = [
  { icon: '▶', title: 'Live Preview',    desc: 'Your app renders in real time as Based writes each file — no refresh, no copy-paste.' },
  { icon: '◉', title: 'AI Memory',       desc: 'Based remembers your style, stack preferences, and project context across sessions.' },
  { icon: '◈', title: 'Image · Video · Music', desc: 'Generate visuals, animated video, and audio tracks alongside your code — all in one place.' },
  { icon: '⬡', title: 'Any language',    desc: 'HTML/CSS/JS, Python, Node — describe what you need and Based picks the right stack.' },
];

function LandingGalleryCard({ item }: { item: GalleryItem }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { rootMargin: '200px' }
    );
    if (wrapRef.current) observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <a href="/gallery" className="landing-gal-card">
      <div className="landing-gal-preview" ref={wrapRef}>
        {visible ? (
          <iframe
            src={`/api/share/preview/${item.id}`}
            title={item.project_name}
            sandbox="allow-scripts"
            scrolling="no"
          />
        ) : (
          <div className="landing-gal-placeholder"><span>B&gt;</span></div>
        )}
      </div>
      <div className="landing-gal-card-body">
        <span className="landing-gal-card-name">{item.project_name}</span>
        <span className="landing-gal-card-meta">by {item.author_name ?? 'Anonymous'} · ↻ {item.remix_count}</span>
      </div>
    </a>
  );
}

export default function LandingPage({ onSignIn }: Props) {
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);

  useEffect(() => {
    fetch('/api/gallery')
      .then(r => r.json())
      .then(d => setGalleryItems((d.items ?? []).slice(0, 3)))
      .catch(() => {});
  }, []);

  return (
    <div className="landing-root">
      <header className="landing-header">
        <div className="landing-logo">B&gt;</div>
        <nav className="landing-header-nav">
          <a href="/gallery" className="landing-nav-link">Gallery</a>
          <a href="/roadmap" className="landing-nav-link">Roadmap</a>
          <button className="landing-signin-btn" onClick={() => onSignIn('signin')}>Sign In</button>
        </nav>
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
          Describe what you want — Based writes the code, generates images, and renders a live preview.
          No setup. No IDE. Just ship.
        </motion.p>
        <motion.div
          className="landing-ctas"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <button className="landing-cta-primary" onClick={() => onSignIn('signup')}>Sign Up Free</button>
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

      <section className="landing-demo">
        <motion.div
          className="landing-demo-window"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, type: 'spring', stiffness: 200, damping: 28 }}
        >
          <div className="landing-demo-bar">
            <span className="landing-demo-dot" />
            <span className="landing-demo-dot" />
            <span className="landing-demo-dot" />
            <span className="landing-demo-bar-title">Based — Live Preview</span>
          </div>
          <div className="landing-demo-placeholder">
            <div className="landing-demo-placeholder-inner">
              <div className="landing-demo-placeholder-icon">◈</div>
              <div className="landing-demo-placeholder-text">Screenshot coming soon</div>
              <div className="landing-demo-placeholder-sub">Drop a PNG at <code>public/demo-screenshot.png</code> and swap the placeholder div for an &lt;img&gt;</div>
            </div>
          </div>
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

      {galleryItems.length > 0 && (
        <section className="landing-gallery">
          <div className="landing-gallery-header">
            <div>
              <div className="landing-gallery-label">Community Gallery</div>
              <h2 className="landing-gallery-title">Built with Based.</h2>
              <p className="landing-gallery-sub">Real projects, built by real people. Browse and remix anything.</p>
            </div>
            <a href="/gallery" className="landing-gallery-browse-btn">Browse all →</a>
          </div>
          <div className="landing-gal-grid">
            {galleryItems.map(item => (
              <LandingGalleryCard key={item.id} item={item} />
            ))}
          </div>
          <div className="landing-gallery-cta-row">
            <a href="/gallery" className="landing-gallery-cta-link">See everything in the gallery →</a>
          </div>
        </section>
      )}

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
              <li>PNG &amp; Excel export</li>
              <li>Per-project memory</li>
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
              <li>Image generation — FLUX &amp; Nano Banana</li>
              <li>Video generation — Seedance 2.0</li>
              <li>Music generation — Stable Audio</li>
              <li>AI Personality tuning</li>
              <li>Incognito mode</li>
              <li>Global AI memory across projects</li>
              <li>Export — JPG, GIF, PDF, Word, PowerPoint</li>
            </ul>
            <button className="landing-tier-cta landing-tier-cta--pro" onClick={() => onSignIn('signup')}>Upgrade to Pro</button>
          </div>
        </motion.div>
      </section>

      <footer className="landing-footer">
        <span>Built by Hus Alfyandi</span>
        <span className="landing-footer-sep">·</span>
        <a href="/roadmap" className="landing-footer-link">Roadmap</a>
        <span className="landing-footer-sep">·</span>
        <a href="/gallery" className="landing-footer-link">Gallery</a>
        <span className="landing-footer-sep">·</span>
        <a href="https://ko-fi.com/basedfund" target="_blank" rel="noopener noreferrer" className="landing-footer-link">◈ Support</a>
      </footer>
    </div>
  );
}

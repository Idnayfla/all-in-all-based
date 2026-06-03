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

const PILLARS = [
  {
    icon: '◈',
    title: 'All Models',
    desc: 'Based routes every request to the best AI model for the job — code, vision, audio, reasoning. You never choose.',
  },
  {
    icon: '⬡',
    title: 'All Tasks',
    desc: 'Build apps, answer questions, analyse data, write content, generate media. One companion, every task.',
  },
  {
    icon: '◉',
    title: 'All Generation',
    desc: 'Code · Images · Video · Music — describe it, Based creates it. Live preview updates as each file is written.',
  },
  {
    icon: '⊙',
    title: 'Community-Driven',
    desc: 'Hit a bug? Report it. Love a feature? Support it. Based gets better every time you use it.',
  },
];

const MARQUEE_ITEMS = [
  { icon: '◈', label: 'Build apps' },
  { icon: '◉', label: 'Generate images' },
  { icon: '⬡', label: 'Edit video' },
  { icon: '◈', label: 'Compose music' },
  { icon: '⊙', label: 'Answer anything' },
  { icon: '◉', label: 'Remember everything' },
  { icon: '⬡', label: 'Play instruments' },
  { icon: '◈', label: 'Build games' },
  { icon: '⊙', label: 'Export documents' },
  { icon: '◉', label: 'Record voice' },
  { icon: '◈', label: 'Real-time data' },
  { icon: '⬡', label: 'Live preview' },
];

const BENTO = [
  {
    icon: '⊙',
    title: 'Everywhere',
    desc: 'Floating on your desktop. On your phone. In your browser. Based shows up wherever you are — and never leaves.',
    tag: 'Windows · Web · Mobile coming',
  },
  {
    icon: '◈',
    title: 'Everything',
    desc: 'Code, images, video, music, data, documents. One companion that does it all — no app switching, no juggling tools.',
    tag: '12+ capabilities',
  },
  {
    icon: '◉',
    title: 'Always',
    desc: 'Remembers your name, your projects, your style. Every session picks up exactly where you left off.',
    tag: 'Global AI memory',
  },
];

const SHIPPED_RECENT = [
  { icon: '◈', label: 'Onboarding', desc: 'Gen counter, memory pitch, one-click quick-create' },
  { icon: '⬡', label: 'Community Loop', desc: 'Vote on features, get notified when they ship' },
  { icon: '◉', label: 'Gallery', desc: 'Public showcase — publish builds, remix the community' },
  {
    icon: '⊙',
    label: 'Windows Companion',
    desc: 'Floating AI overlay — always on top, always ready',
  },
  { icon: '▸', label: 'Music Studio', desc: 'Full DAW — piano, drums, voice recording, FX rack' },
];

const COMING_NEXT = [
  { label: 'Mobile App', desc: 'iOS + Android — native feel, companion on your phone' },
  { label: 'Pantheon SDK', desc: "npm package — use Based's AI routing in your own apps" },
  { label: 'Team Workspaces', desc: 'Share projects, collaborate in real time' },
  { label: 'Based Model', desc: 'Our own fine-tuned model, trained on your builds' },
];

const COMPARISONS = [
  { them: 'One AI, one job', us: 'One AI, every job' },
  { them: 'Outputs text', us: 'Outputs apps, images, video, music' },
  { them: 'You manage the tools', us: 'Based manages everything' },
  { them: 'Forgets you every session', us: 'Remembers your style forever' },
  { them: 'You find the bugs', us: 'Report it — we fix it' },
];

function LandingGalleryCard({ item }: { item: GalleryItem }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
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
          <div className="landing-gal-placeholder">
            <span>B&gt;</span>
          </div>
        )}
      </div>
      <div className="landing-gal-card-body">
        <span className="landing-gal-card-name">{item.project_name}</span>
        <span className="landing-gal-card-meta">
          by {item.author_name ?? 'Anonymous'} · ↻ {item.remix_count}
        </span>
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

  const doubled = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];

  return (
    <div className="landing-root">
      <header className="landing-header">
        <div className="landing-logo">B&gt;</div>
        <nav className="landing-header-nav">
          <a href="/gallery" className="landing-nav-link">
            Gallery
          </a>
          <a href="/changelog" className="landing-nav-link">
            What&apos;s New
          </a>
          <a href="/vote" className="landing-nav-link">
            Vote
          </a>
          <a href="/roadmap" className="landing-nav-link">
            Roadmap
          </a>
          <button className="landing-signin-btn" onClick={() => onSignIn('signin')}>
            Sign In
          </button>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section className="landing-hero">
        <div className="landing-hero-glow" />
        <motion.div
          className="landing-hero-badge"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          ◈ Personal Assistant AI
        </motion.div>
        <motion.h1
          className="landing-headline"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, type: 'spring', stiffness: 180, damping: 24 }}
        >
          <span style={{ whiteSpace: 'nowrap' }}>Never leaves</span>
          <br />
          your side.
        </motion.h1>
        <motion.p
          className="landing-subheadline"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
        >
          Not a tool. Not just a chatbot. Based is your personal assistant AI — it builds your apps,
          edits your video, composes your music, answers anything, and remembers everything about
          you.
        </motion.p>
        <motion.div
          className="landing-ctas"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
        >
          <button className="landing-cta-primary" onClick={() => onSignIn('signup')}>
            Start free →
          </button>
          <button className="landing-cta-secondary" onClick={() => onSignIn('signin')}>
            Sign In
          </button>
          <a
            href="https://github.com/Idnayfla/all-in-all-based/releases/download/v0.1.5/Based.Setup.0.1.5.exe"
            className="landing-cta-download"
            download
          >
            ↓ Windows App
          </a>
        </motion.div>
        <motion.div
          className="landing-hint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
        >
          Free to start · 10 generations/month · No credit card needed
        </motion.div>
      </section>

      {/* ── Capability marquee ── */}
      <div className="landing-marquee">
        <div className="landing-marquee-track">
          {doubled.map((item, i) => (
            <span key={i} className="landing-marquee-item">
              <span className="landing-marquee-dot">{item.icon}</span>
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Companion story bento ── */}
      <section className="landing-bento-section">
        {BENTO.map((card, i) => (
          <motion.div
            key={card.title}
            className="landing-bento-card"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.1, type: 'spring', stiffness: 200, damping: 26 }}
          >
            <span className="landing-bento-icon">{card.icon}</span>
            <div className="landing-bento-title">{card.title}</div>
            <div className="landing-bento-desc">{card.desc}</div>
            <span className="landing-bento-tag">{card.tag}</span>
          </motion.div>
        ))}
      </section>

      {/* ── Four pillars ── */}
      <section className="landing-features">
        {PILLARS.map((f, i) => (
          <motion.div
            key={f.title}
            className="landing-feature-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.1 }}
          >
            <span className="landing-feature-icon">{f.icon}</span>
            <div className="landing-feature-title">{f.title}</div>
            <div className="landing-feature-desc">{f.desc}</div>
          </motion.div>
        ))}
      </section>

      {/* ── Comparison ── */}
      <section className="landing-comparison">
        <motion.div
          className="landing-comparison-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Based vs everything else
        </motion.div>
        <motion.div
          className="landing-comparison-table"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="landing-comparison-col landing-comparison-col--them">
            <div className="landing-comparison-col-header">Others</div>
            {COMPARISONS.map(c => (
              <div key={c.them} className="landing-comparison-row landing-comparison-row--them">
                ✕ {c.them}
              </div>
            ))}
          </div>
          <div className="landing-comparison-col landing-comparison-col--us">
            <div className="landing-comparison-col-header">Based</div>
            {COMPARISONS.map(c => (
              <div key={c.us} className="landing-comparison-row landing-comparison-row--us">
                ◈ {c.us}
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── Community gallery ── */}
      {galleryItems.length > 0 && (
        <section className="landing-gallery">
          <div className="landing-gallery-header">
            <div>
              <div className="landing-gallery-label">Community Gallery</div>
              <h2 className="landing-gallery-title">Built with Based.</h2>
              <p className="landing-gallery-sub">
                Real projects, built by real people. Browse and remix anything.
              </p>
            </div>
            <a href="/gallery" className="landing-gallery-browse-btn">
              Browse all →
            </a>
          </div>
          <div className="landing-gal-grid">
            {galleryItems.map(item => (
              <LandingGalleryCard key={item.id} item={item} />
            ))}
          </div>
          <div className="landing-gallery-cta-row">
            <a href="/gallery" className="landing-gallery-cta-link">
              See everything in the gallery →
            </a>
          </div>
        </section>
      )}

      {/* ── Always shipping strip ── */}
      <section className="landing-roadmap">
        <motion.div
          className="landing-roadmap-header"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div>
            <div className="landing-roadmap-label">Built in public · Shaped by users</div>
            <h2 className="landing-roadmap-title">Always shipping.</h2>
            <p className="landing-roadmap-sub">
              Based gets better every week. Here&apos;s what&apos;s been built and what&apos;s
              coming.
            </p>
          </div>
          <a href="/roadmap" className="landing-roadmap-btn">
            Full roadmap →
          </a>
        </motion.div>
        <motion.div
          className="landing-roadmap-grid"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="landing-roadmap-col">
            <div className="landing-roadmap-col-label">◈ Recently shipped</div>
            {SHIPPED_RECENT.map(item => (
              <div key={item.label} className="landing-roadmap-item">
                <span className="landing-roadmap-item-icon">{item.icon}</span>
                <div>
                  <div className="landing-roadmap-item-name">{item.label}</div>
                  <div className="landing-roadmap-item-desc">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="landing-roadmap-col">
            <div className="landing-roadmap-col-label">⬡ Coming next</div>
            {COMING_NEXT.map(item => (
              <div key={item.label} className="landing-roadmap-item landing-roadmap-item--dim">
                <span className="landing-roadmap-item-icon">⬡</span>
                <div>
                  <div className="landing-roadmap-item-name">{item.label}</div>
                  <div className="landing-roadmap-item-desc">{item.desc}</div>
                </div>
              </div>
            ))}
            <a href="/roadmap" className="landing-roadmap-see-all">
              See full roadmap →
            </a>
          </div>
        </motion.div>
      </section>

      {/* ── Pricing ── */}
      <section className="landing-pricing">
        <motion.div
          className="landing-pricing-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Start free. Upgrade when you love it.
        </motion.div>
        <motion.div
          className="landing-pricing-tiers"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="landing-tier landing-tier--free">
            <div className="landing-tier-label">Free</div>
            <div className="landing-tier-price">
              $0<span>/mo</span>
            </div>
            <ul className="landing-tier-features">
              <li>10 builds/month</li>
              <li>3 projects</li>
              <li>Live preview</li>
              <li>Chat + code generation</li>
              <li>Cloud sync</li>
            </ul>
            <button className="landing-tier-cta" onClick={() => onSignIn('signup')}>
              Start free →
            </button>
          </div>
          <div className="landing-tier landing-tier--pro">
            <div className="landing-tier-pro-badge">PRO</div>
            <div className="landing-tier-label">Pro</div>
            <div className="landing-tier-price">
              <span className="pricing-original-price">$20</span>
              $12<span>/mo</span>
            </div>
            <div className="pricing-founding-label">Founding member price</div>
            <ul className="landing-tier-features">
              <li>Unlimited builds — no cap, no anxiety</li>
              <li>Based AI — Claude Sonnet, not free-tier Llama</li>
              <li>AI memory — remembers your style forever</li>
              <li>All creative tools — images, video, music</li>
              <li>Unlimited projects + Windows companion</li>
            </ul>
            <button
              className="landing-tier-cta landing-tier-cta--pro"
              onClick={() => onSignIn('signup')}
            >
              Keep building →
            </button>
          </div>
        </motion.div>
        <motion.p
          className="landing-pricing-founder"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
        >
          Made by one person in Singapore. Every subscription directly funds the next feature.
        </motion.p>
      </section>

      {/* ── Closing CTA ── */}
      <section className="landing-closer">
        <motion.div
          className="landing-closer-inner"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="landing-closer-badge">B&gt;</div>
          <h2 className="landing-closer-headline">Your companion is waiting.</h2>
          <p className="landing-closer-sub">
            Free to start · 10 generations/month · No credit card needed.
          </p>
          <button className="landing-cta-primary" onClick={() => onSignIn('signup')}>
            Start free →
          </button>
        </motion.div>
      </section>

      <footer className="landing-footer">
        <a href="/roadmap" className="landing-footer-link">
          Roadmap
        </a>
        <span className="landing-footer-sep">·</span>
        <a href="/gallery" className="landing-footer-link">
          Gallery
        </a>
        <span className="landing-footer-sep">·</span>
        <a
          href="https://ko-fi.com/basedfund"
          target="_blank"
          rel="noopener noreferrer"
          className="landing-footer-link"
        >
          ◈ Support
        </a>
        <span className="landing-footer-sep">·</span>
        <a href="/terms" className="landing-footer-link">
          Terms
        </a>
        <span className="landing-footer-sep">·</span>
        <a href="/privacy" className="landing-footer-link">
          Privacy
        </a>
        <span className="landing-footer-sep">·</span>
        <a href="/refund" className="landing-footer-link">
          Refund
        </a>
      </footer>
    </div>
  );
}

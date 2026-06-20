'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface Props {
  onSignIn: (tab?: 'signin' | 'signup') => void;
}

/** Spawn a lavender ripple that expands from the click point, then cleans itself up. */
function fireRipple(e: React.MouseEvent) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'landing-click-ripple';
  el.style.left = `${e.clientX}px`;
  el.style.top = `${e.clientY}px`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

interface GalleryItem {
  id: string;
  project_name: string;
  author_name: string | null;
  remix_count: number;
}

const PILLARS = [
  {
    icon: '◉',
    title: 'Always There',
    desc: 'Based floats on your desktop — always on top, always ready. No tab switching. No losing context. It lives where you work.',
  },
  {
    icon: '◈',
    title: 'Knows You',
    desc: 'Remembers your projects, your style, your preferences. Every session picks up exactly where you left off.',
  },
  {
    icon: '⬡',
    title: 'Actually Builds',
    desc: 'Not just chat. Based generates apps, images, video, and music — live preview updates as each file is written.',
  },
  {
    icon: '⊙',
    title: 'Gets Better',
    desc: 'Hit a bug? Report it. Love a feature? Support it. Based ships every week, shaped by the people who use it.',
  },
];

const MARQUEE_ITEMS = [
  { icon: '◉', label: 'Lives on your desktop' },
  { icon: '◈', label: 'Builds your apps' },
  { icon: '⬡', label: 'Generates images' },
  { icon: '◉', label: 'Composes music' },
  { icon: '⊙', label: 'Remembers you' },
  { icon: '◈', label: 'Edits video' },
  { icon: '⬡', label: 'Sees your screen' },
  { icon: '◉', label: 'Answers anything' },
  { icon: '◈', label: 'Knows your projects' },
  { icon: '⊙', label: 'Always on top' },
  { icon: '⬡', label: 'Speaks and listens' },
  { icon: '◈', label: 'Never forgets' },
];

const BENTO = [
  {
    icon: '◉',
    title: 'Lives on your desktop',
    desc: 'A floating overlay that sits over everything you do. Open it with a hotkey, talk to it, close it. It never forgets the conversation.',
    tag: 'Windows · Web · Mobile coming',
  },
  {
    icon: '◈',
    title: 'Sees what you see',
    desc: 'Share your screen, Based understands your context instantly. No copy-pasting. No explaining. It just knows.',
    tag: 'Ambient vision',
  },
  {
    icon: '⊙',
    title: 'Remembers everything',
    desc: 'Your name, your projects, your preferences, your habits. Based builds a picture of you over time and uses it on every response.',
    tag: 'Persistent AI memory',
  },
];

const SHIPPED_RECENT = [
  {
    icon: '◉',
    label: 'Windows Companion',
    desc: 'Floating AI overlay — always on top, always ready, wake it with your voice',
  },
  {
    icon: '◈',
    label: 'Group Chat',
    desc: 'Bring Based into a group conversation — it listens, weighs in, remembers',
  },
  {
    icon: '⬡',
    label: 'Ambient Vision',
    desc: 'Share your screen, Based sees your context without you explaining it',
  },
  {
    icon: '⊙',
    label: 'AI Memory',
    desc: 'Persistent memory across every session — Based learns who you are over time',
  },
  {
    icon: '▸',
    label: 'Voice Wake Word',
    desc: 'Say "Hey Based" — it listens, responds, speaks back',
  },
];

const COMING_NEXT = [
  { label: 'Mobile App', desc: 'iOS + Android — native feel, companion on your phone' },
  { label: 'Pantheon SDK', desc: "npm package — use Based's AI routing in your own apps" },
  { label: 'Team Workspaces', desc: 'Share projects, collaborate in real time' },
  { label: 'Based Model', desc: 'Our own fine-tuned model, trained on your builds' },
];

const COMPARISONS = [
  { them: 'A tab you open and close', us: 'A companion that lives with you' },
  { them: 'Forgets you every session', us: 'Remembers you forever' },
  { them: 'You explain your context every time', us: 'Already knows your projects' },
  { them: 'Outputs text', us: 'Builds apps, generates images, video, music' },
  { them: 'You juggle 5 different AI tools', us: 'One companion, everything' },
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
    <Link href="/gallery" className="landing-gal-card">
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
    </Link>
  );
}

export default function LandingPage({ onSignIn }: Props) {
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    setEntered(true);
  }, []);

  useEffect(() => {
    fetch('/api/gallery')
      .then(r => r.json())
      .then(d => setGalleryItems((d.items ?? []).slice(0, 3)))
      .catch(() => {});
  }, []);

  const doubled = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];

  return (
    <div className="landing-root">
      {entered && (
        <div
          className="landing-entrance-ripple"
          onAnimationEnd={e => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
      <header className="landing-header">
        <div className="landing-logo">B&gt;</div>
        <nav className="landing-header-nav">
          <Link href="/gallery" className="landing-nav-link">
            Gallery
          </Link>
          <Link href="/changelog" className="landing-nav-link">
            What&apos;s New
          </Link>
          <Link href="/vote" className="landing-nav-link">
            Vote
          </Link>
          <Link href="/roadmap" className="landing-nav-link">
            Roadmap
          </Link>
          <button
            className="landing-signin-btn"
            onClick={e => {
              fireRipple(e);
              onSignIn('signin');
            }}
          >
            Sign In
          </button>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section className="landing-hero">
        <div className="landing-hero-glow" />
        <div className="landing-hero-badge">Your personal AI companion</div>
        <h1 className="landing-headline">
          <span style={{ whiteSpace: 'nowrap' }}>Not a chatbot.</span>
          <br />A companion.
        </h1>
        <p className="landing-subheadline">
          Based lives on your desktop, knows your projects, and actually builds things for you.
          Apps, images, video, music — describe it, watch it appear. And it remembers everything,
          every time.
        </p>
        <div className="landing-ctas">
          <button
            className="landing-cta-primary"
            onClick={e => {
              fireRipple(e);
              onSignIn('signup');
            }}
          >
            Start free →
          </button>
          <button
            className="landing-cta-secondary"
            onClick={e => {
              fireRipple(e);
              onSignIn('signin');
            }}
          >
            Sign In
          </button>
          <a
            href="https://github.com/Idnayfla/all-in-all-based/releases/download/v0.1.6/Based.Setup.0.1.6.exe"
            className="landing-cta-download"
            download
          >
            ↓ Windows App
          </a>
        </div>
        <div className="landing-hint">
          Free to start · 10 generations/month · No credit card needed
        </div>
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
        {BENTO.map(card => (
          <div key={card.title} className="landing-bento-card">
            <span className="landing-bento-icon">{card.icon}</span>
            <div className="landing-bento-title">{card.title}</div>
            <div className="landing-bento-desc">{card.desc}</div>
            <span className="landing-bento-tag">{card.tag}</span>
          </div>
        ))}
      </section>

      {/* ── Four pillars ── */}
      <section className="landing-features">
        {PILLARS.map(f => (
          <div key={f.title} className="landing-feature-card">
            <span className="landing-feature-icon">{f.icon}</span>
            <div className="landing-feature-title">{f.title}</div>
            <div className="landing-feature-desc">{f.desc}</div>
          </div>
        ))}
      </section>

      {/* ── Comparison ── */}
      <section className="landing-comparison">
        <div className="landing-comparison-title">A companion. Not another chatbot.</div>
        <div className="landing-comparison-table">
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
        </div>
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
            <Link href="/gallery" className="landing-gallery-browse-btn">
              Browse all →
            </Link>
          </div>
          <div className="landing-gal-grid">
            {galleryItems.map(item => (
              <LandingGalleryCard key={item.id} item={item} />
            ))}
          </div>
          <div className="landing-gallery-cta-row">
            <Link href="/gallery" className="landing-gallery-cta-link">
              See everything in the gallery →
            </Link>
          </div>
        </section>
      )}

      {/* ── Always shipping strip ── */}
      <section className="landing-roadmap">
        <div className="landing-roadmap-header">
          <div>
            <div className="landing-roadmap-label">Built in public · Shaped by users</div>
            <h2 className="landing-roadmap-title">Always shipping.</h2>
            <p className="landing-roadmap-sub">
              Based gets better every week. Here&apos;s what&apos;s been built and what&apos;s
              coming.
            </p>
          </div>
          <Link href="/roadmap" className="landing-roadmap-btn">
            Full roadmap →
          </Link>
        </div>
        <div className="landing-roadmap-grid">
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
            <Link href="/roadmap" className="landing-roadmap-see-all">
              See full roadmap →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="landing-pricing">
        <div className="landing-pricing-title">Start free. Upgrade when you love it.</div>
        <div className="landing-pricing-tiers">
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
            <button
              className="landing-tier-cta"
              onClick={e => {
                fireRipple(e);
                onSignIn('signup');
              }}
            >
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
              onClick={e => {
                fireRipple(e);
                onSignIn('signup');
              }}
            >
              Keep building →
            </button>
          </div>
        </div>
        <p className="landing-pricing-founder">
          Made by one person in Singapore. Every subscription directly funds the next feature.
        </p>
      </section>

      {/* ── Closing CTA ── */}
      <section className="landing-closer">
        <div className="landing-closer-inner">
          <div className="landing-closer-badge">B&gt;</div>
          <h2 className="landing-closer-headline">Your companion is waiting.</h2>
          <p className="landing-closer-sub">
            Free to start · 10 generations/month · No credit card needed.
          </p>
          <button
            className="landing-cta-primary"
            onClick={e => {
              fireRipple(e);
              onSignIn('signup');
            }}
          >
            Start free →
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <Link href="/roadmap" className="landing-footer-link">
          Roadmap
        </Link>
        <span className="landing-footer-sep">·</span>
        <Link href="/gallery" className="landing-footer-link">
          Gallery
        </Link>
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
        <Link href="/terms" className="landing-footer-link">
          Terms
        </Link>
        <span className="landing-footer-sep">·</span>
        <Link href="/privacy" className="landing-footer-link">
          Privacy
        </Link>
        <span className="landing-footer-sep">·</span>
        <Link href="/refund" className="landing-footer-link">
          Refund
        </Link>
      </footer>
    </div>
  );
}

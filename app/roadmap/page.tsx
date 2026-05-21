import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Roadmap — Based',
  description:
    "See what's been built, what's in progress, and what's coming next to Based — Singapore's overattached companion AI.",
};

const SHIPPED = [
  {
    label: 'Auth + Cloud Storage',
    desc: 'Sign in with Google or email. Projects save to your account and sync everywhere.',
  },
  { label: 'Live Preview', desc: 'See your app render in real time as Based writes each file.' },
  { label: 'Subscriptions', desc: 'Free plan · Pro $12/mo. Stripe-powered, cancel anytime.' },
  {
    label: 'Public Gallery + Remix',
    desc: 'Browse what others built with Based. One click to fork and remix anything.',
  },
  {
    label: 'AI Memory',
    desc: 'Based remembers your style, preferences, and context across every session.',
  },
  {
    label: 'Real-Time Data',
    desc: 'Web search, live weather, and current data built into every generation.',
  },
  {
    label: 'Document Export',
    desc: 'PDF, Word, PowerPoint, Excel — export anything you build in one click.',
  },
  {
    label: 'Image Generation',
    desc: 'FLUX + Nano Banana 2 — text-to-image, image editing, profile icons, logos.',
  },
  { label: 'Video Generation', desc: 'Seedance 2.0 — text-to-video and image-to-video.' },
  {
    label: 'Music Generation',
    desc: 'Stable Audio — generate original music tracks from a description.',
  },
  {
    label: 'Game Engine',
    desc: 'Canvas + Phaser.js — generate playable games directly in the browser.',
  },
  {
    label: 'Referral Program',
    desc: 'Share Based with a link. You and your friend both get 7 days Pro free.',
  },
  { label: 'Incognito Mode', desc: 'Private sessions — nothing saved, nothing remembered.' },
  {
    label: 'Video Editor',
    desc: 'Built-in studio: trim, text overlays, speed control, FFmpeg export. No upload needed.',
  },
  {
    label: 'Music Studio',
    desc: 'Full DAW in your browser — 12 instruments, drum sequencer, voice recording, effects rack.',
  },
];

const NEXT = [
  {
    label: 'Music Studio — Phase 2',
    desc: 'MIDI import, auto-tune, loop browser, mix-down export to MP3.',
  },
  {
    label: 'Image Studio',
    desc: 'Canvas paint with layers, filters, and AI-assisted edits — all in one panel.',
  },
  {
    label: '3D / Blueprint Studio',
    desc: 'Three.js scene builder. Describe a 3D scene or blueprint; Based renders it live.',
  },
  {
    label: 'Proactive Check-ins',
    desc: '"You were working on X — want to continue?" Based meets you where you left off.',
  },
  {
    label: 'Mobile PWA',
    desc: 'Add to home screen on iOS and Android. Feels native, no App Store required.',
  },
  {
    label: 'Windows Floating Companion',
    desc: 'Electron overlay that floats above every window. Screen-aware, voice-ready.',
  },
];

const VISION = [
  { label: 'iOS + Android App', desc: 'Full native apps on the App Store and Play Store.' },
  {
    label: 'Cross-Device Handoff',
    desc: 'Start on your phone, continue on your desktop. Seamless.',
  },
  {
    label: 'Self-Hosted AI Model',
    desc: 'Faster responses, lower cost, zero external limits. Funded by Pro subscriptions.',
  },
  {
    label: 'Feature Request Board',
    desc: 'Vote on what gets built next. The most-requested feature ships first.',
  },
  { label: 'Based for Teams', desc: 'Shared workspace, shared memory, org billing.' },
  {
    label: 'Custom Domain Publishing',
    desc: 'Publish your generated app to your own URL in one click.',
  },
];

function TimelineSection({
  title,
  icon,
  badge,
  items,
  dim,
}: {
  title: string;
  icon: string;
  badge: string;
  items: { label: string; desc: string }[];
  dim?: boolean;
}) {
  return (
    <div className={`rm-section${dim ? ' rm-section--dim' : ''}`}>
      <div className="rm-section-header">
        <span className="rm-section-icon">{icon}</span>
        <span className="rm-section-title">{title}</span>
        <span className="rm-section-badge">{badge}</span>
      </div>
      <div className="rm-items">
        {items.map(item => (
          <div key={item.label} className="rm-item">
            <div className="rm-item-dot">{icon === '✓' ? '◈' : icon === '⬡' ? '⬡' : '◉'}</div>
            <div>
              <div className="rm-item-label">{item.label}</div>
              <div className="rm-item-desc">{item.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RoadmapPage() {
  return (
    <div className="rm-root">
      <header className="rm-header">
        <Link href="/" className="rm-logo">
          B&gt;
        </Link>
        <nav className="rm-header-nav">
          <Link href="/gallery" className="rm-nav-link">
            Gallery
          </Link>
          <Link href="/" className="rm-nav-link">
            App
          </Link>
        </nav>
      </header>

      <section className="rm-hero">
        <div className="rm-hero-badge">Public Roadmap · Updated May 2026</div>
        <h1 className="rm-headline">
          Built in public.
          <br />
          Shaped by you.
        </h1>
        <p className="rm-subheadline">
          Based is Singapore&apos;s overattached companion AI — every task, every device, always by
          your side. Every feature here was driven by real feedback. Your support, free or Pro, is
          what funds what comes next.
        </p>
        <div className="rm-hero-actions">
          <Link href="/" className="rm-cta-primary">
            Open Based →
          </Link>
          <a
            href="https://ko-fi.com/basedfund"
            target="_blank"
            rel="noopener noreferrer"
            className="rm-cta-secondary"
          >
            ◈ Support the build
          </a>
        </div>
        <div className="rm-stats-row">
          <div className="rm-stat">
            <span className="rm-stat-num">16</span>
            <span className="rm-stat-label">Features shipped</span>
          </div>
          <div className="rm-stat">
            <span className="rm-stat-num">5</span>
            <span className="rm-stat-label">Coming next</span>
          </div>
          <div className="rm-stat">
            <span className="rm-stat-num">1</span>
            <span className="rm-stat-label">Vision: Singapore&apos;s companion</span>
          </div>
        </div>
      </section>

      <div className="rm-grid">
        <TimelineSection
          title="Shipped"
          icon="✓"
          badge={`${SHIPPED.length} features`}
          items={SHIPPED}
        />
        <TimelineSection title="Coming next" icon="◉" badge="In progress" items={NEXT} />
        <TimelineSection title="Long-term vision" icon="⬡" badge="Planned" items={VISION} dim />
      </div>

      <section className="rm-mission">
        <div className="rm-mission-inner">
          <div className="rm-mission-icon">B&gt;</div>
          <blockquote className="rm-mission-quote">
            &ldquo;Everyone&apos;s personal overattached companion. Everywhere you go, Based will
            just be floating — waiting for your response, constantly keeping you in check.&rdquo;
          </blockquote>
          <div className="rm-mission-actions">
            <Link href="/" className="rm-cta-primary">
              Try Based free →
            </Link>
          </div>
        </div>
      </section>

      <footer className="rm-footer">
        <Link href="/gallery" className="rm-footer-link">
          Gallery
        </Link>
        <span className="rm-footer-sep">·</span>
        <a
          href="https://ko-fi.com/basedfund"
          target="_blank"
          rel="noopener noreferrer"
          className="rm-footer-link"
        >
          ◈ Ko-fi
        </a>
      </footer>
    </div>
  );
}

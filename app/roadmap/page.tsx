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
  {
    label: 'Image Studio',
    desc: 'Canvas paint with layers, filters, AI generate, inpaint — 30-step undo, text tool, eyedropper.',
  },
  {
    label: '3D / Blueprint Studio',
    desc: 'Three.js scene builder. Describe a 3D scene or blueprint; Based renders it live.',
  },
  {
    label: 'Personal Notes',
    desc: 'Rich text, drawing canvas, tables, code blocks. Export as Markdown, HTML, or plain text.',
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
    desc: 'Always-on-top Electron overlay. Draggable bubble, screen capture, chat without switching windows. Resizable panel.',
  },
  {
    label: 'Android Companion',
    desc: 'Floating bubble on Android. Live screen capture, front camera, back camera photo, chat persists between sessions.',
  },
  {
    label: 'Based Voice',
    desc: 'Based reads its responses aloud in its own voice — self-hosted, no third-party API, no rate limits.',
  },
  {
    label: 'Based Knows You',
    desc: 'Memory loaded every session. Pattern timeline. Onboarding arc. Emotional weather. Morning ritual. GPS memory anchors. Shareable read card.',
  },
  {
    label: 'Feature Request Board',
    desc: 'Live at /vote — submit requests and vote on what ships next. Highest votes go to the top of the queue.',
  },
];

const NEXT = [
  {
    label: 'Android App — Play Store',
    desc: 'Full Play Store listing. Based as a native Android app, not just a PWA.',
  },
  {
    label: 'iOS App — App Store',
    desc: 'Full App Store listing. Based on every iPhone.',
  },
  {
    label: 'Pantheon SDK',
    desc: "npm package + docs site. Use Based's AI routing layer in your own projects.",
  },
  {
    label: 'Custom Domain Publishing',
    desc: 'Publish your generated app to your own URL in one click.',
  },
];

const VISION = [
  {
    label: 'Self-Hosted AI Model',
    desc: 'Faster responses, lower cost, zero external limits. Funded by Pro subscriptions.',
  },
  { label: 'Based for Teams', desc: 'Shared workspace, shared memory, org billing.' },
  {
    label: 'Pantheon — Self-Hosted',
    desc: 'Run Pantheon on your own GPU. Zero API cost, pure margin. Unlocked at ~500 paying users.',
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
          <Link href="/changelog" className="rm-nav-link">
            Changelog
          </Link>
          <Link href="/gallery" className="rm-nav-link">
            Gallery
          </Link>
          <Link href="/" className="rm-nav-link">
            App
          </Link>
        </nav>
      </header>

      <section className="rm-hero">
        <div className="rm-hero-badge">Public Roadmap · Updated June 2026</div>
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
          <Link href="/vote" className="rm-cta-secondary">
            ◈ Vote on what gets built →
          </Link>
        </div>
        <div className="rm-stats-row">
          <div className="rm-stat">
            <span className="rm-stat-num">25</span>
            <span className="rm-stat-label">Features shipped</span>
          </div>
          <div className="rm-stat">
            <span className="rm-stat-num">4</span>
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
        <Link href="/changelog" className="rm-footer-link">
          Changelog
        </Link>
        <span className="rm-footer-sep">·</span>
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
        <span className="rm-footer-sep">·</span>
        <Link href="/terms" className="rm-footer-link">
          Terms
        </Link>
        <span className="rm-footer-sep">·</span>
        <Link href="/privacy" className="rm-footer-link">
          Privacy
        </Link>
        <span className="rm-footer-sep">·</span>
        <Link href="/refund" className="rm-footer-link">
          Refund
        </Link>
      </footer>
    </div>
  );
}

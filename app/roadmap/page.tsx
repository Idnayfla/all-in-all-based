import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Roadmap — Based',
  description: 'See what\'s been built, what\'s in progress, and what\'s coming next to Based.',
};

const SHIPPED = [
  { label: 'Chat with AI',              desc: 'Generate apps, games, dashboards, and tools from a single message.' },
  { label: 'Live preview',              desc: 'See your app render in real time as Based writes each file.' },
  { label: 'Image generation',          desc: 'FLUX & Nano Banana 2 — text-to-image and image editing.' },
  { label: 'Video generation',          desc: 'Seedance 2.0 — text-to-video and image-to-video.' },
  { label: 'Music generation',          desc: 'Stable Audio — generate original music tracks from a description.' },
  { label: 'Document export',           desc: 'PDF, Word, PowerPoint, Excel — export anything you build.' },
  { label: 'AI Memory',                 desc: 'Based remembers your style and context across every session.' },
  { label: 'Mobile-ready',              desc: 'Works on any device — phone, tablet, or desktop.' },
  { label: 'Windows Companion',         desc: 'Floating AI overlay with screen awareness, voice input, and live commentary.' },
  { label: 'Real-time data',            desc: 'Web search and live weather built into every generation.' },
  { label: 'Incognito mode',            desc: 'Private sessions — nothing saved, nothing remembered.' },
  { label: 'Pro / Free tiers',          desc: 'Generous free plan. Pro unlocks everything.' },
];

const BUILDING = [
  { label: 'iOS & Android apps',        desc: 'Native App Store and Play Store releases.' },
  { label: 'Referral program',          desc: 'Share Based, earn Pro time for you and a friend.' },
  { label: 'Public project gallery',    desc: 'Browse and remix what others have built with Based.' },
];

const PLANNED = [
  { label: 'Self-hosted AI model',      desc: 'Faster responses, lower cost, zero external API limits. Funded by Pro subscriptions.' },
  { label: 'Collaboration',             desc: 'Share and co-edit projects with teammates in real time.' },
  { label: 'Custom domain publishing',  desc: 'Publish your generated app to your own URL.' },
  { label: 'Plugin system',             desc: 'Extend Based with your own tools, data sources, and integrations.' },
];

function Section({ title, icon, items, dim }: {
  title: string;
  icon: string;
  items: { label: string; desc: string }[];
  dim?: boolean;
}) {
  return (
    <div className={`rm-section${dim ? ' rm-section--dim' : ''}`}>
      <div className="rm-section-header">
        <span className="rm-section-icon">{icon}</span>
        <span className="rm-section-title">{title}</span>
      </div>
      <div className="rm-items">
        {items.map(item => (
          <div key={item.label} className="rm-item">
            <div className="rm-item-label">{item.label}</div>
            <div className="rm-item-desc">{item.desc}</div>
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
        <Link href="/" className="rm-logo">B&gt;</Link>
        <Link href="/" className="rm-back">← Back</Link>
      </header>

      <section className="rm-hero">
        <div className="rm-hero-badge">Public Roadmap</div>
        <h1 className="rm-headline">Built in the open.</h1>
        <p className="rm-subheadline">
          Every feature here was shaped by people using Based every day.
          Your support — free or Pro — directly funds what comes next.
        </p>
        <a href="https://ko-fi.com/basedfund" target="_blank" rel="noopener noreferrer" className="rm-support-btn">
          ◈ Support the build
        </a>
      </section>

      <div className="rm-grid">
        <Section title="Shipped" icon="✓" items={SHIPPED} />
        <Section title="Building now" icon="◈" items={BUILDING} />
        <Section title="Planned" icon="⬡" items={PLANNED} dim />
      </div>

      <footer className="rm-footer">
        <span>Have an idea?</span>
        <a href="mailto:husgogogo@gmail.com" className="rm-footer-link">husgogogo@gmail.com</a>
        <span className="rm-footer-sep">·</span>
        <Link href="/" className="rm-footer-link">Back to Based</Link>
      </footer>
    </div>
  );
}

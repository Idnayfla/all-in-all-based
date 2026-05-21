import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: "What's New — Based",
  description:
    'Every update, fix, and new feature shipped to Based — the AI dev studio built in Singapore.',
};

type ChangeItem = {
  text: string;
  bold: string;
};

type ChangeSection = {
  kind: 'added' | 'fixed' | 'internal';
  items: ChangeItem[];
};

type ChangeEntry = {
  date: string;
  label: string;
  title: string;
  sections: ChangeSection[];
};

const ENTRIES: ChangeEntry[] = [
  {
    date: '2026-05-21',
    label: 'Beta',
    title: 'API Keys, Persona Settings & Stability',
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'API Keys for Pantheon',
            text: 'Pro users can now generate personal API keys (pk_live_ format) in Settings → API Keys and use them with the Pantheon VSCode extension to connect your editor directly to Based.',
          },
          {
            bold: '3D / Blueprint Studio',
            text: 'Build and preview Three.js 3D scenes with AI generation. Describe a scene and Based renders it live in the browser.',
          },
          {
            bold: 'Persona switcher moved to Settings',
            text: 'The Based / Coder / Designer / Advisor / Coach mode selector is now a persistent preference saved in Settings, so your chosen persona sticks between sessions.',
          },
        ],
      },
      {
        kind: 'fixed',
        items: [
          {
            bold: 'Proactive check-in resume',
            text: 'Clicking "Continue" on a project check-in now always takes you back to the correct project. Also shows a clear message if the project was deleted instead of silently opening a blank session.',
          },
          {
            bold: 'Pro status on refresh',
            text: 'Pro users no longer lose their subscription status after a page refresh. Previously required clearing cache and re-logging in to restore Pro features.',
          },
          {
            bold: 'THREE.js games',
            text: 'Generated games using Three.js no longer crash with "THREE is not defined". The library now loads reliably on every generation.',
          },
        ],
      },
    ],
  },
  {
    date: '2026-05-19',
    label: 'Beta',
    title: 'Generation Engine Reliability',
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'Rotating loading messages',
            text: 'For free users — 14 messages cycle every 3.2s with animated dots, including Pro upsell nudges during the wait.',
          },
          {
            bold: 'Real audio from Mixkit CDN',
            text: 'Horror, jumpscare, and audio-heavy apps now use hosted audio files instead of synthesized browser beeps. Audio is reliable across all browsers.',
          },
        ],
      },
      {
        kind: 'fixed',
        items: [
          {
            bold: 'Small edits no longer regenerate the whole project',
            text: 'The planner now reads existing files and targets only the file that needs changing — "add a button" touches index.html only.',
          },
          {
            bold: 'App buttons no longer break after a few edits',
            text: 'The button safety net now uses exact-word matching and only activates when it recognises its own screen IDs, so it cannot remove .active from screens it does not own.',
          },
          {
            bold: 'Seamless AI provider fallback',
            text: 'If the primary AI provider returns a credit or rate-limit error, generation automatically retries via the secondary provider with no interruption.',
          },
        ],
      },
    ],
  },
  {
    date: '2026-05-19',
    label: 'Beta',
    title: 'All Panels Upgrade',
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'Editor',
            text: 'Word wrap toggle, one-click format, copy to clipboard, download file, live line and character count.',
          },
          {
            bold: 'Preview',
            text: 'Cancel running code mid-execution, errors shown separately in red, open preview in a new browser tab, real PDF export.',
          },
          {
            bold: 'Video Editor',
            text: 'Full undo/redo including trim and speed changes, AI command bar powered by Claude — type plain English to edit your video.',
          },
          {
            bold: 'Image Studio',
            text: '30-step undo/redo, text tool, colour eyedropper, 4-tab panel (Tools / Layers / Filters / AI).',
          },
          {
            bold: 'Music Studio',
            text: 'Solo button now correctly mutes all other tracks. Vocal and audio track export now captured in the mix.',
          },
          {
            bold: 'Notes',
            text: 'Export your notes as Markdown, HTML, or plain text.',
          },
        ],
      },
      {
        kind: 'fixed',
        items: [
          {
            bold: 'Studio solo/mute logic',
            text: 'Was ignoring soloed state — now works correctly.',
          },
          {
            bold: 'PDF export',
            text: 'Was opening a print dialog instead of downloading a file.',
          },
          {
            bold: 'Notes tab clipping',
            text: 'Tab bar now scrolls on smaller screens.',
          },
          {
            bold: 'Code errors',
            text: 'stderr now shown separately from output, in red.',
          },
        ],
      },
    ],
  },
  {
    date: '2026-05-19',
    label: 'Beta',
    title: 'Phase 9: AI Music Generation',
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'AI Gen tab in Studio',
            text: 'Describe a track, pick a genre and duration, get a real audio file. Powered by FAL stable-audio with Haiku prompt enhancement.',
          },
          {
            bold: '10 genre chips',
            text: 'Cinematic, Lo-fi, Electronic, Ambient, Jazz, Rock, Orchestral, Chill, Epic, Dark.',
          },
          {
            bold: 'Duration presets',
            text: '15s, 30s (default), 45s, 60s. Tracks appear in a card list with playback — Pro tier only.',
          },
        ],
      },
    ],
  },
  {
    date: '2026-05-xx',
    label: 'Beta',
    title: 'Personal Notes (Phase 12)',
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'Rich text notes',
            text: 'Font, size, bold, italic, underline, highlight, tables, code blocks.',
          },
          {
            bold: 'Drawing canvas',
            text: 'Sketch directly inside your note.',
          },
          {
            bold: 'Sync + export',
            text: 'Notes sync across devices via your Based account. Export as Markdown, HTML, or plain text.',
          },
        ],
      },
    ],
  },
  {
    date: 'Earlier',
    label: 'Beta',
    title: 'Core Platform',
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'Chat with Based',
            text: 'Claude-powered AI generates HTML/CSS/JS apps live in your browser.',
          },
          {
            bold: 'Live Preview',
            text: 'Iframe render synced in real time with generated output.',
          },
          {
            bold: 'Code Editor',
            text: 'Monaco editor synced with generated files.',
          },
          {
            bold: 'Studios',
            text: 'Music Studio (12 instruments, drum sequencer), Image Studio (layers, filters), Video Editor (trim, speed, text overlays).',
          },
          {
            bold: 'Proactive check-in',
            text: '"You were working on X — want to continue?" Based meets you where you left off.',
          },
          {
            bold: 'User memory',
            text: 'Remembers your projects and preferences across sessions.',
          },
          {
            bold: 'Pro subscription',
            text: '$12/mo. Higher generation limits, AI music generation, and early access to new features.',
          },
        ],
      },
    ],
  },
];

function SectionLabel({ kind }: { kind: ChangeSection['kind'] }) {
  const labels: Record<ChangeSection['kind'], string> = {
    added: 'Added',
    fixed: 'Fixed',
    internal: 'Internal',
  };
  return <div className={`cl-section-label cl-section-label--${kind}`}>{labels[kind]}</div>;
}

export default function ChangelogPage() {
  return (
    <div className="cl-root">
      <header className="cl-header">
        <Link href="/" className="cl-logo">
          B&gt;
        </Link>
        <nav className="cl-header-nav">
          <Link href="/roadmap" className="cl-nav-link">
            Roadmap
          </Link>
          <Link href="/gallery" className="cl-nav-link">
            Gallery
          </Link>
          <Link href="/" className="cl-nav-link">
            App
          </Link>
        </nav>
      </header>

      <section className="cl-hero">
        <div className="cl-hero-badge">What&apos;s New · beta.getbased.dev</div>
        <h1 className="cl-headline">Every update, live.</h1>
        <p className="cl-subheadline">
          Based ships fast. Here&apos;s everything that landed — new features, fixes, and
          improvements, in order.
        </p>
      </section>

      <div className="cl-feed">
        {ENTRIES.map(entry => (
          <article key={`${entry.date}-${entry.title}`} className="cl-entry">
            <div className="cl-entry-meta">
              <span className="cl-entry-date">{entry.date}</span>
              <span className="cl-entry-label">[{entry.label}]</span>
            </div>
            <h2 className="cl-entry-title">{entry.title}</h2>
            {entry.sections.map(section => (
              <div key={section.kind} className="cl-section">
                <SectionLabel kind={section.kind} />
                <ul className="cl-items">
                  {section.items.map(item => (
                    <li key={item.bold} className="cl-item">
                      <span className={`cl-item-dot cl-item-dot--${section.kind}`}>◈</span>
                      <span>
                        <strong>{item.bold}</strong> — {item.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </article>
        ))}
      </div>

      <footer className="cl-footer">
        <Link href="/roadmap" className="cl-footer-link">
          Roadmap
        </Link>
        <span className="cl-footer-sep">·</span>
        <Link href="/gallery" className="cl-footer-link">
          Gallery
        </Link>
        <span className="cl-footer-sep">·</span>
        <a
          href="https://ko-fi.com/basedfund"
          target="_blank"
          rel="noopener noreferrer"
          className="cl-footer-link"
        >
          ◈ Ko-fi
        </a>
      </footer>
    </div>
  );
}

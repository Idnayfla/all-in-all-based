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
  requestedByCommunity?: boolean;
};

const ENTRIES: ChangeEntry[] = [
  {
    date: '2026-06-02',
    label: 'v0.1.5',
    title: 'Resizable Companion',
    requestedByCommunity: true,
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'Resizable companion panel',
            text: 'Drag the left edge of the companion panel to make it wider or narrower (280px–600px). Width is saved between sessions.',
          },
        ],
      },
      {
        kind: 'fixed',
        items: [
          {
            bold: 'Voice playback',
            text: 'TTS audio was silently failing due to a React state updater bug. Voice now plays correctly every time.',
          },
          {
            bold: 'Symbol encoding',
            text: 'Buttons and messages were rendering Based symbols (◈ ⬡ B>) as garbled characters on some systems. Now correct everywhere.',
          },
        ],
      },
    ],
  },
  {
    date: '2026-06-01',
    label: 'v0.1.4',
    title: 'Feature Request Board',
    requestedByCommunity: true,
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'Vote on what gets built',
            text: 'Live at /vote — browse all open feature requests, vote on the ones you want most, and submit your own. Highest-voted requests go to the top of the build queue.',
          },
          {
            bold: 'One vote per request',
            text: 'Toggle your vote at any time. Vote count updates instantly with an optimistic UI — no page refresh needed.',
          },
          {
            bold: 'Submit a request',
            text: 'Signed-in users can submit new feature requests with a title (120 chars) and optional description (500 chars).',
          },
        ],
      },
    ],
  },
  {
    date: '2026-06-01',
    label: 'v0.1.4',
    title: 'Based Knows You',
    requestedByCommunity: true,
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'Based has memory',
            text: 'The companion loads your full memory on every session — it knows what you have told it before and builds on it without being reminded.',
          },
          {
            bold: 'Based has opinions',
            text: 'Based pushes back, names patterns it notices, and matches your energy. It is not a yes-machine — it will tell you when something is a bad idea.',
          },
          {
            bold: 'Pattern timeline',
            text: 'Based tracks recurring themes across sessions. Every fifth session it extracts patterns. At 14 days it surfaces what it has noticed — unprompted.',
          },
          {
            bold: 'Onboarding intimacy arc',
            text: 'First three sessions are structured differently. Based asks specific questions and makes early observations that set the tone for the relationship.',
          },
          {
            bold: 'Emotional weather',
            text: 'Based reads your mood patterns weekly and fires a passive observation when it senses something worth naming. Never intrusive — only when it has something real to say.',
          },
          {
            bold: 'Morning ritual',
            text: 'Between 6–10am, Based opens with something specific to your day — not a generic greeting.',
          },
          {
            bold: 'GPS memory anchors',
            text: 'Based remembers where you were when you had important conversations. Opt-in, coarse location only (~111m), 20 anchors max.',
          },
          {
            bold: 'Shareable read card',
            text: "After emotional weather and pattern surface moments, a chip appears — share Based's read on you as a card.",
          },
          {
            bold: 'Name your Based',
            text: 'Give your companion a name. It persists across web and Android.',
          },
          {
            bold: 'Bubble evolves over 100 days',
            text: 'The Android bubble changes appearance as your relationship deepens — 6 visual stages from default to gold crown at day 100+.',
          },
        ],
      },
      {
        kind: 'fixed',
        items: [
          {
            bold: 'Image crop crash',
            text: 'Cropping an image no longer crashes when canvas context is unavailable.',
          },
          {
            bold: 'Export errors silent',
            text: 'All seven export functions now catch errors and show an inline toast instead of blowing up the error boundary.',
          },
          {
            bold: 'Stuck Working message',
            text: '"Working..." no longer persists after a session is restored from localStorage.',
          },
        ],
      },
    ],
  },
  {
    date: '2026-06-01',
    label: 'v0.1.4',
    title: 'Android Companion',
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'Live screen',
            text: 'Tap Screen in the Android companion and Based sees your screen in real time. Ask it what is on screen, explain an error, or describe a UI.',
          },
          {
            bold: 'Face camera',
            text: 'Tap Camera and Based sees you via the front camera. Show it something, get a reaction.',
          },
          {
            bold: 'Photo capture',
            text: 'Switch to the back camera and tap Photo for a still shot — useful for identifying objects or reading text.',
          },
          {
            bold: 'Bubble animations',
            text: 'Breathing pulse at rest, bounce on entry, ripple on tap, violet glow while Based is thinking.',
          },
          {
            bold: 'Chat persistence',
            text: 'Conversation is saved to device storage and restored exactly when you reopen the companion.',
          },
          {
            bold: 'Keyboard fix',
            text: 'The chat panel now shifts above the keyboard correctly on all Android versions.',
          },
        ],
      },
    ],
  },
  {
    date: '2026-05-30',
    label: 'v0.1.2',
    title: 'Based Voice',
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'Based speaks',
            text: "The companion now reads its responses aloud in Based's own voice. Enable with the ◉ Voice button. Switch between male and female voice.",
          },
          {
            bold: 'Self-hosted voice',
            text: "Based's voice runs on its own infrastructure — no third-party API, no credits, no rate limits.",
          },
          {
            bold: 'Lip-sync pulse',
            text: "The B> bubble button pulses with a fast irregular animation while Based is speaking, so you always know when it's talking.",
          },
          {
            bold: 'Bubble text sync',
            text: 'While Based speaks, the floating bubble displays the text in real time, paced to the audio.',
          },
          {
            bold: 'Idle voice',
            text: "Based checks in after a few minutes of silence — a reminder it's still there.",
          },
          {
            bold: 'Voice cache',
            text: 'Repeated responses are served instantly from cache, no re-generation needed.',
          },
          {
            bold: 'Full-edge bubble drag',
            text: 'The B> bubble can now be dragged to any edge of the screen, not just the bottom corner.',
          },
        ],
      },
      {
        kind: 'fixed',
        items: [
          {
            bold: 'Bubble text timing',
            text: 'Text no longer flashes before audio starts playing.',
          },
          {
            bold: 'Click-through',
            text: 'Clicks now pass through the bubble window to the app behind it when the button is not active.',
          },
        ],
      },
    ],
  },
  {
    date: '2026-05-23',
    label: 'Beta',
    title: 'Windows Floating Companion',
    sections: [
      {
        kind: 'added',
        items: [
          {
            bold: 'Desktop companion overlay',
            text: 'Based runs as a floating Electron overlay on Windows, sitting above every app — always visible, always ready. No more switching windows.',
          },
          {
            bold: 'Draggable B> bubble',
            text: "The companion's entry point is a pulsing B> bubble you can drag anywhere on screen. Position is saved between sessions.",
          },
          {
            bold: 'Screen capture on demand',
            text: 'Ask "what\'s on my screen?" and Based takes a screenshot and analyses it — useful for debugging errors, reading docs, or understanding any UI.',
          },
          {
            bold: 'Persistent session',
            text: 'The companion authenticates via your Based account automatically. Memory and context carry over from the web app.',
          },
        ],
      },
    ],
  },
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
    date: '2026-05-19',
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

function CommunityTag() {
  return (
    <Link href="/vote" className="cl-community-tag" title="This feature was requested by the community">
      ◈ You asked, we built it
    </Link>
  );
}

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
              {entry.requestedByCommunity && <CommunityTag />}
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
        <span className="cl-footer-sep">·</span>
        <Link href="/vote" className="cl-footer-link">
          Vote
        </Link>
        <span className="cl-footer-sep">·</span>
        <Link href="/terms" className="cl-footer-link">
          Terms
        </Link>
        <span className="cl-footer-sep">·</span>
        <Link href="/privacy" className="cl-footer-link">
          Privacy
        </Link>
        <span className="cl-footer-sep">·</span>
        <Link href="/refund" className="cl-footer-link">
          Refund
        </Link>
      </footer>
    </div>
  );
}

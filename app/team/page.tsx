'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const AGENTS = [
  {
    slug: 'orchestrator',
    name: 'Orchestrator',
    role: 'Coordinates all agents, runs multi-agent workflows',
    icon: '◉',
    tier: 'lead',
  },
  {
    slug: 'architect',
    name: 'Architect',
    role: 'System design, scalability, cost modelling',
    icon: '⬡',
    tier: 'senior',
  },
  {
    slug: 'senior-engineer',
    name: 'Senior Engineer',
    role: 'Deep bug diagnosis, generation pipeline, surgical fixes',
    icon: '◈',
    tier: 'senior',
  },
  {
    slug: 'ai-engineer',
    name: 'AI Engineer',
    role: 'Prompt architecture, model selection, pipeline optimisation',
    icon: '⊙',
    tier: 'senior',
  },
  {
    slug: 'product',
    name: 'Product',
    role: 'Roadmap, specs, prioritisation',
    icon: '◈',
    tier: 'core',
  },
  {
    slug: 'designer',
    name: 'Designer',
    role: 'Design system, layouts, brand',
    icon: '◉',
    tier: 'core',
  },
  {
    slug: 'devops',
    name: 'DevOps',
    role: 'Infra, cost per user, monitoring',
    icon: '⬡',
    tier: 'core',
  },
  {
    slug: 'security',
    name: 'Security',
    role: 'Auth audit, API security, OWASP',
    icon: '◈',
    tier: 'core',
  },
  {
    slug: 'qa',
    name: 'QA',
    role: 'Test plans, bug triage, release gate',
    icon: '⊙',
    tier: 'core',
  },
  {
    slug: 'growth',
    name: 'Growth',
    role: 'Copy, SEO, launch, onboarding',
    icon: '◉',
    tier: 'core',
  },
  {
    slug: 'data-analyst',
    name: 'Data Analyst',
    role: 'PostHog, funnels, retention, A/B testing',
    icon: '⬡',
    tier: 'core',
  },
  {
    slug: 'mobile',
    name: 'Mobile',
    role: 'PWA, service workers, iOS/Android',
    icon: '◈',
    tier: 'core',
  },
  {
    slug: 'finance',
    name: 'Finance',
    role: 'MRR, unit economics, Stripe, pricing',
    icon: '◉',
    tier: 'support',
  },
  {
    slug: 'legal',
    name: 'Legal',
    role: 'Privacy, ToS, GDPR/PDPA, compliance',
    icon: '⊙',
    tier: 'support',
  },
  {
    slug: 'community',
    name: 'Community',
    role: 'Feedback, Discord, support triage, changelog',
    icon: '⬡',
    tier: 'support',
  },
  {
    slug: 'chief-of-staff',
    name: 'Chief of Staff',
    role: 'Decisions log, changelog, roadmap status',
    icon: '◈',
    tier: 'support',
  },
  {
    slug: 'technical-writer',
    name: 'Technical Writer',
    role: 'API docs, user guides, error messages',
    icon: '◉',
    tier: 'support',
  },
] as const;

type Agent = (typeof AGENTS)[number];
type Message = { role: 'user' | 'assistant'; content: string };

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_BASED_ADMIN_EMAIL ?? 'husgogogo@gmail.com';

export default function TeamPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<'loading' | 'denied' | 'ok'>('loading');
  const [selected, setSelected] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [search, setSearch] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push('/');
      } else if (user.email !== ADMIN_EMAIL) {
        setAuthState('denied');
      } else {
        setAuthState('ok');
      }
    });
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  const pick = (agent: Agent) => {
    setSelected(agent);
    setMessages([]);
    setInput('');
    setStreamText('');
    setTimeout(() => inputRef.current?.focus(), 120);
  };

  const send = useCallback(async () => {
    if (!input.trim() || !selected || streaming) return;
    const userMsg: Message = { role: 'user', content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setStreaming(true);
    setStreamText('');

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: selected.slug, messages: next }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6);
          if (raw === '[DONE]') break;
          try {
            const d = JSON.parse(raw) as { text?: string; error?: string };
            if (d.text) {
              full += d.text;
              setStreamText(full);
            }
          } catch {
            /* partial chunk */
          }
        }
      }
      setMessages(prev => [...prev, { role: 'assistant', content: full }]);
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong. Try again.' },
      ]);
    } finally {
      setStreaming(false);
      setStreamText('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, selected, messages, streaming]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const filtered = AGENTS.filter(
    a =>
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.role.toLowerCase().includes(search.toLowerCase())
  );

  if (authState === 'loading') {
    return (
      <div style={S.loadWrap}>
        <span style={S.loadDot}>◈</span>
      </div>
    );
  }

  if (authState === 'denied') {
    return (
      <div style={S.loadWrap}>
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 28, color: 'var(--danger)' }}>◈</span>
          <p
            style={{ color: 'var(--text2)', fontFamily: 'Space Mono', fontSize: 13, marginTop: 12 }}
          >
            Access denied.
          </p>
          <Link href="/" style={{ ...S.homeLink, display: 'inline-block', marginTop: 16 }}>
            ← Back to Based
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={S.root}>
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside style={{ ...S.sidebar, ...(selected ? S.sidebarHidden : {}) }}>
        <div style={S.sidebarTop}>
          <Link href="/" style={S.homeLink}>
            ← Based
          </Link>
          <h1 style={S.heading}>Team</h1>
          <p style={S.sub}>Your specialist agents</p>
          <input
            style={S.search}
            placeholder="Search agents..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div style={S.list}>
          {filtered.map(agent => (
            <button
              key={agent.slug}
              style={{
                ...S.card,
                ...(selected?.slug === agent.slug ? S.cardActive : {}),
              }}
              onClick={() => pick(agent)}
            >
              <span style={S.cardIcon}>{agent.icon}</span>
              <div style={S.cardBody}>
                <span style={S.cardName}>{agent.name}</span>
                <span style={S.cardRole}>{agent.role}</span>
              </div>
              <span style={S.cardArrow}>→</span>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Chat panel ──────────────────────────────── */}
      <main style={{ ...S.chat, ...(selected ? {} : S.chatHidden) }}>
        {selected ? (
          <>
            {/* Header */}
            <div style={S.chatHeader}>
              <button style={S.backBtn} onClick={() => setSelected(null)} aria-label="Back">
                ←
              </button>
              <div style={S.chatMeta}>
                <span style={S.chatName}>
                  {selected.icon} {selected.name}
                </span>
                <span style={S.chatRole}>{selected.role}</span>
              </div>
              <button
                style={S.clearBtn}
                onClick={() => {
                  setMessages([]);
                  setStreamText('');
                }}
              >
                Clear
              </button>
            </div>

            {/* Messages */}
            <div style={S.messages}>
              {messages.length === 0 && !streaming && (
                <div style={S.empty}>
                  <span style={S.emptyIcon}>{selected.icon}</span>
                  <p style={S.emptyName}>{selected.name} is ready.</p>
                  <p style={S.emptyHint}>Ask anything in their domain.</p>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} style={m.role === 'user' ? S.userRow : S.agentRow}>
                  <div style={m.role === 'user' ? S.userBubble : S.agentBubble}>
                    <span style={S.bubbleLabel}>{m.role === 'user' ? 'You' : selected.name}</span>
                    <span style={S.bubbleText}>{m.content}</span>
                  </div>
                </div>
              ))}

              {streaming && (
                <div style={S.agentRow}>
                  <div style={S.agentBubble}>
                    <span style={S.bubbleLabel}>{selected.name}</span>
                    <span style={S.bubbleText}>
                      {streamText || <span style={{ color: 'var(--text3)' }}>Thinking...</span>}
                      {streamText && <span style={S.cursor}>▋</span>}
                    </span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div style={S.inputRow}>
              <textarea
                ref={inputRef}
                style={S.textarea}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKey}
                placeholder={`Message ${selected.name}...`}
                rows={1}
                disabled={streaming}
              />
              <button
                style={{
                  ...S.sendBtn,
                  ...(!input.trim() || streaming ? S.sendDisabled : {}),
                }}
                onClick={() => void send()}
                disabled={!input.trim() || streaming}
              >
                →
              </button>
            </div>
          </>
        ) : (
          /* Desktop empty state */
          <div style={S.noAgent}>
            <span style={{ fontSize: 28, color: 'var(--text3)' }}>◈</span>
            <p
              style={{
                color: 'var(--text3)',
                fontFamily: 'Space Mono',
                fontSize: 13,
                marginTop: 12,
              }}
            >
              Select an agent
            </p>
          </div>
        )}
      </main>

      <style>{`
        @media (max-width: 767px) {
          .team-sidebar-hidden { display: none !important; }
          .team-chat-hidden    { display: none !important; }
        }
        @media (min-width: 768px) {
          .team-sidebar-hidden { display: flex !important; }
          .team-chat-hidden    { display: flex !important; }
          .team-back-btn       { display: none !important; }
        }
        .team-card:hover {
          background: rgba(201,168,124,0.08) !important;
          border-color: rgba(201,168,124,0.3) !important;
        }
        .team-textarea:focus { outline: none; border-color: rgba(201,168,124,0.5) !important; }
      `}</style>
    </div>
  );
}

/* ── Styles ──────────────────────────────────────────────────────────── */
const S: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    height: '100dvh',
    background: 'var(--bg)',
    fontFamily: 'Space Mono, monospace',
    overflow: 'hidden',
  },

  /* Loading */
  loadWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100dvh',
    background: 'var(--bg)',
  },
  loadDot: {
    fontSize: 24,
    color: 'var(--accent)',
    animation: 'pulse 1.2s ease-in-out infinite',
  },

  /* Sidebar */
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: 320,
    borderRight: '1px solid var(--border-subtle)',
    background: 'var(--bg)',
    flexShrink: 0,
    overflowY: 'auto',
  },
  sidebarHidden: {
    display: 'none',
  },
  sidebarTop: {
    padding: '20px 16px 12px',
    borderBottom: '1px solid var(--border-subtle)',
    position: 'sticky',
    top: 0,
    background: 'var(--bg)',
    zIndex: 2,
  },
  homeLink: {
    fontSize: 11,
    color: 'var(--text3)',
    textDecoration: 'none',
    letterSpacing: '0.05em',
    display: 'block',
    marginBottom: 12,
  },
  heading: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--accent)',
    letterSpacing: '-0.02em',
    marginBottom: 2,
  },
  sub: {
    fontSize: 11,
    color: 'var(--text3)',
    letterSpacing: '0.05em',
    marginBottom: 12,
  },
  search: {
    width: '100%',
    padding: '8px 10px',
    background: 'var(--bg2)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 6,
    color: 'var(--text)',
    fontSize: 12,
    fontFamily: 'Space Mono, monospace',
    outline: 'none',
  },
  list: {
    padding: '8px 0 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 0,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.15s, border-color 0.15s',
    width: '100%',
  },
  cardActive: {
    background: 'rgba(201,168,124,0.1)',
    borderColor: 'rgba(201,168,124,0.3)',
  },
  cardIcon: {
    fontSize: 16,
    color: 'var(--accent)',
    flexShrink: 0,
    width: 20,
    textAlign: 'center',
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
    letterSpacing: '-0.01em',
  },
  cardRole: {
    fontSize: 10,
    color: 'var(--text3)',
    letterSpacing: '0.02em',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardArrow: {
    fontSize: 14,
    color: 'var(--text3)',
    flexShrink: 0,
  },

  /* Chat */
  chat: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
    background: 'var(--bg)',
  },
  chatHidden: {
    display: 'none',
  },
  chatHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    borderBottom: '1px solid var(--border-subtle)',
    flexShrink: 0,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text2)',
    fontSize: 18,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 4,
    fontFamily: 'Space Mono',
    flexShrink: 0,
  },
  chatMeta: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
  },
  chatName: {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--accent)',
    letterSpacing: '-0.01em',
  },
  chatRole: {
    fontSize: 10,
    color: 'var(--text3)',
    letterSpacing: '0.03em',
    marginTop: 1,
  },
  clearBtn: {
    background: 'none',
    border: '1px solid var(--border-subtle)',
    borderRadius: 5,
    color: 'var(--text3)',
    fontSize: 10,
    letterSpacing: '0.05em',
    cursor: 'pointer',
    padding: '4px 10px',
    fontFamily: 'Space Mono',
    flexShrink: 0,
  },

  /* Messages */
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: 240,
    gap: 6,
  },
  emptyIcon: {
    fontSize: 32,
    color: 'var(--accent)',
    opacity: 0.5,
  },
  emptyName: {
    fontSize: 14,
    color: 'var(--text2)',
    fontWeight: 700,
  },
  emptyHint: {
    fontSize: 11,
    color: 'var(--text3)',
    letterSpacing: '0.04em',
  },

  userRow: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  agentRow: {
    display: 'flex',
    justifyContent: 'flex-start',
  },
  userBubble: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    background: 'rgba(201,168,124,0.12)',
    border: '1px solid rgba(201,168,124,0.2)',
    borderRadius: '10px 10px 2px 10px',
    padding: '10px 14px',
    maxWidth: '80%',
  },
  agentBubble: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    background: 'var(--bg2)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '10px 10px 10px 2px',
    padding: '10px 14px',
    maxWidth: '80%',
  },
  bubbleLabel: {
    fontSize: 10,
    color: 'var(--text3)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontWeight: 700,
  },
  bubbleText: {
    fontSize: 13,
    color: 'var(--text)',
    lineHeight: 1.65,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  cursor: {
    display: 'inline-block',
    color: 'var(--accent)',
    animation: 'blink 0.8s step-end infinite',
    marginLeft: 1,
  },

  /* Input */
  inputRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 8,
    padding: '12px 16px',
    borderTop: '1px solid var(--border-subtle)',
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    background: 'var(--bg2)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 8,
    color: 'var(--text)',
    fontSize: 13,
    fontFamily: 'Space Mono, monospace',
    padding: '10px 12px',
    resize: 'none',
    lineHeight: 1.5,
    maxHeight: 140,
    overflowY: 'auto',
    transition: 'border-color 0.15s',
  },
  sendBtn: {
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 8,
    color: 'var(--bg)',
    fontSize: 18,
    fontWeight: 700,
    cursor: 'pointer',
    padding: '10px 16px',
    flexShrink: 0,
    transition: 'opacity 0.15s',
    fontFamily: 'Space Mono',
  },
  sendDisabled: {
    opacity: 0.3,
    cursor: 'not-allowed',
  },

  /* Desktop empty */
  noAgent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
};

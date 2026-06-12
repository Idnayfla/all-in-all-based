'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '@/app/page';
import { track } from '@/lib/posthog';

interface SpecSection {
  heading: string;
  content: string;
  symbol: string;
}

const SECTION_SYMBOLS: Record<string, string> = {
  'Project Summary': '◈',
  'Target Users & Personas': '⬡',
  'Core User Stories': '◉',
  'Functional Requirements': '→',
  'Non-Functional Requirements': '⊙',
  'Tech Stack Recommendation': '·',
  'Out of Scope': '—',
  'Acceptance Criteria': '◈',
  'Edge Cases & Failure Modes': '⬡',
};

const FREE_MONTHLY_LIMIT = 3;

function parseSections(markdown: string): SpecSection[] {
  const lines = markdown.split('\n');
  const sections: SpecSection[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) {
        sections.push({
          heading: current.heading,
          content: current.lines.join('\n').trim(),
          symbol: SECTION_SYMBOLS[current.heading] ?? '◈',
        });
      }
      current = { heading: line.replace(/^## /, ''), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    sections.push({
      heading: current.heading,
      content: current.lines.join('\n').trim(),
      symbol: SECTION_SYMBOLS[current.heading] ?? '◈',
    });
  }
  return sections;
}

function condenseSRS(sections: SpecSection[], description: string): string {
  const get = (keyword: string) =>
    sections.find(s => s.heading.toLowerCase().includes(keyword.toLowerCase()))?.content ?? '';

  const summary = get('Project Summary');
  const fr = get('Functional');
  const tech = get('Tech Stack');
  const oos = get('Out of Scope');

  const frLines = fr
    .split('\n')
    .filter(l => l.trim())
    .slice(0, 15)
    .map(l => `- ${l.replace(/^\d+\.\s*/, '').replace(/^-\s*/, '')}`)
    .join('\n');

  const techLines = tech
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('|---'))
    .slice(0, 8)
    .map(l => `- ${l.replace(/^\|/, '').replace(/\|$/, '').trim()}`)
    .join('\n');

  const oosLines = oos
    .split('\n')
    .filter(l => l.trim())
    .slice(0, 4)
    .map(l => `- ${l.replace(/^\d+\.\s*/, '').replace(/^-\s*/, '')}`)
    .join('\n');

  return [
    'Build the following app from this specification.',
    '',
    `PROJECT: ${summary.split('\n')[0]?.slice(0, 200) ?? description.slice(0, 200)}`,
    '',
    'MUST-HAVE FEATURES:',
    frLines,
    '',
    'TECH CONSTRAINTS:',
    techLines,
    '',
    'OUT OF SCOPE:',
    oosLines,
  ].join('\n');
}

interface Props {
  authToken: string;
  currentProject: Project | null;
  subscriptionTier: 'free' | 'beta' | 'pro';
  onBuildFromSpec: (prompt: string) => void;
}

export default function SpecPanel({
  authToken,
  currentProject,
  subscriptionTier,
  onBuildFromSpec,
}: Props) {
  const [description, setDescription] = useState('');
  const [platform, setPlatform] = useState('Web');
  const [timeline, setTimeline] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [sections, setSections] = useState<SpecSection[]>([]);
  const [openSections, setOpenSections] = useState<Set<number>>(new Set([0]));
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [copied, setCopied] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const sectionRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevProjectId = useRef<string | null>(null);

  // Fire once on mount — intentionally no deps, we only want this on first render
  useEffect(() => {
    track('spec_panel_opened', { subscription_tier: subscriptionTier });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load spec when project changes
  useEffect(() => {
    if (!currentProject?.id || !authToken) {
      if (prevProjectId.current !== null) {
        setSections([]);
        setStreamText('');
        setGenError(null);
      }
      prevProjectId.current = null;
      return;
    }
    if (prevProjectId.current === currentProject.id) return;
    prevProjectId.current = currentProject.id;

    setSections([]);
    setStreamText('');
    setGenError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/spec?projectId=${currentProject.id}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
          const { spec } = (await res.json()) as { spec: string | null };
          if (spec) {
            setSections(parseSections(spec));
            setOpenSections(new Set([0]));
          }
        }
      } catch {
        // no spec yet — stay on empty state
      }
    })();
  }, [currentProject?.id, authToken]);

  // Set innerHTML for contentEditable sections exactly once after sections mount
  useEffect(() => {
    if (sections.length === 0) return;
    // Give React one frame to mount the divs
    requestAnimationFrame(() => {
      sections.forEach((section, idx) => {
        const el = sectionRefs.current.get(idx);
        if (el && !el.dataset.initialized) {
          el.innerHTML = section.content.replace(/\n/g, '<br>');
          el.dataset.initialized = '1';
        }
      });
    });
  }, [sections]);

  const reconstructMarkdown = useCallback(() => {
    return sections
      .map((section, idx) => {
        const el = sectionRefs.current.get(idx);
        const content = el ? el.innerText.trim() : section.content;
        return `## ${section.heading}\n\n${content}`;
      })
      .join('\n\n---\n\n');
  }, [sections]);

  const triggerAutoSave = useCallback(() => {
    if (!currentProject?.id || !authToken) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      try {
        const markdown = reconstructMarkdown();
        await fetch(`/api/projects/${currentProject.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ spec: markdown }),
        });
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('idle');
      }
    }, 1500);
  }, [currentProject?.id, authToken, reconstructMarkdown]);

  const generate = async () => {
    if (!description.trim() || isGenerating) return;
    track('spec_generation_started', {
      platform,
      has_timeline: !!timeline.trim(),
      subscription_tier: subscriptionTier,
    });
    setIsGenerating(true);
    setStreamText('');
    setSections([]);
    setGenError(null);
    sectionRefs.current.clear();

    try {
      const res = await fetch('/api/spec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          description: description.trim(),
          target_platform: platform.toLowerCase(),
          timeline: timeline.trim() || undefined,
          projectId: currentProject?.id,
        }),
      });

      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          limit?: number;
        };
        if (data.error === 'free_limit_reached') {
          track('spec_limit_hit', { limit: data.limit });
          setGenError(
            `You've used your ${data.limit ?? FREE_MONTHLY_LIMIT} free spec generations this month. Upgrade to Pro for unlimited.`
          );
        } else {
          setGenError('Rate limit reached. Please try again later.');
        }
        return;
      }

      if (res.status === 401) {
        setGenError('Session expired. Please sign in again.');
        return;
      }

      if (!res.ok || !res.body) {
        setGenError('Failed to generate spec. Please try again.');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          try {
            const payload = JSON.parse(raw) as {
              chunk?: string;
              done?: boolean;
              srs?: string;
              error?: string;
              wordCount?: number;
            };
            if (payload.chunk) {
              accumulated += payload.chunk;
              setStreamText(accumulated);
            } else if (payload.done && payload.srs) {
              track('spec_generation_complete', {
                word_count: payload.wordCount,
                subscription_tier: subscriptionTier,
              });
              const parsed = parseSections(payload.srs);
              if (parsed.length > 0) {
                setSections(parsed);
                setOpenSections(new Set([0]));
                setStreamText('');
              }
              // if parsing yields nothing (truncated/malformed), keep accumulated text visible
            } else if (payload.error) {
              setGenError(payload.error);
            }
          } catch {
            // malformed chunk — skip
          }
        }
      }
    } catch {
      setGenError('Connection failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleSection = (idx: number) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const copyMarkdown = async () => {
    const markdown = sections.length > 0 ? reconstructMarkdown() : streamText;
    if (!markdown) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdown);
      } else {
        // Fallback for non-HTTPS contexts (local IP, file://)
        const ta = document.createElement('textarea');
        ta.value = markdown;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent — user can copy manually
    }
  };

  const saveToNotes = async () => {
    if (!authToken || sections.length === 0) return;
    const firstLine =
      sections[0]?.content?.split('\n')[0]?.slice(0, 50) ?? description.slice(0, 50);
    const title = `${firstLine} — Spec ${new Date().toLocaleDateString()}`;
    const markdown = reconstructMarkdown();
    try {
      await fetch('/api/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ title, content: markdown }),
      });
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2500);
    } catch {
      // silent fail
    }
  };

  const buildFromSpec = () => {
    if (sections.length === 0) return;
    track('spec_build_clicked', {
      section_count: sections.length,
      subscription_tier: subscriptionTier,
    });
    const prompt = condenseSRS(sections, description);
    onBuildFromSpec(prompt);
  };

  const hasSpec = sections.length > 0;
  const isStreaming = isGenerating || (streamText.length > 0 && !hasSpec);
  const isEmpty = !isStreaming && !hasSpec && !genError;

  return (
    <div className="spec-root">
      {/* ── Input column ── */}
      <div className="spec-input-col">
        <div className="spec-input-header">
          <span className="spec-input-title">DESCRIBE YOUR IDEA</span>
          {saveStatus !== 'idle' && (
            <span className={`spec-save-dot${saveStatus === 'saved' ? ' saved' : ' saving'}`} />
          )}
        </div>

        <textarea
          className="spec-textarea"
          value={description}
          onChange={e => {
            setDescription(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          placeholder="Tell Based what you want to build — the messier the better. One sentence or ten paragraphs both work."
          disabled={isGenerating}
          rows={6}
        />

        <div className="spec-chips-row">
          {(['Web', 'Mobile', 'Desktop', 'All'] as const).map(p => (
            <button
              key={p}
              className={`spec-chip${platform === p ? ' active' : ''}`}
              onClick={() => setPlatform(p)}
              disabled={isGenerating}
            >
              {p}
            </button>
          ))}
          <input
            className="spec-chip spec-timeline-input"
            placeholder="Timeline..."
            value={timeline}
            onChange={e => setTimeline(e.target.value)}
            disabled={isGenerating}
          />
        </div>

        {subscriptionTier === 'free' && (
          <div className="spec-tier-note">
            Free tier: {FREE_MONTHLY_LIMIT} spec generations / month
          </div>
        )}

        <button
          className="spec-generate-btn"
          onClick={() => void generate()}
          disabled={isGenerating || !description.trim()}
        >
          {isGenerating ? (
            <>
              <span className="spinner" /> Writing spec...
            </>
          ) : (
            '◈ Generate Spec →'
          )}
        </button>

        {genError && <div className="spec-error">{genError}</div>}

        {hasSpec && (
          <>
            <div className="spec-divider" />
            <div className="spec-actions">
              <button className="spec-action-build" onClick={buildFromSpec}>
                ⬡ Build from Spec
              </button>
              <button className="spec-action-notes" onClick={() => void saveToNotes()}>
                {notesSaved ? '✓ Saved to Notes' : '· Save to Notes'}
              </button>
              <button className="spec-action-copy" onClick={() => void copyMarkdown()}>
                {copied ? '✓ Copied!' : '· Copy Markdown'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Output column ── */}
      <div className="spec-output-col">
        {isEmpty && (
          <div className="spec-output-empty">
            <div className="spec-empty-icon">◈</div>
            <div className="spec-empty-title">Your spec will appear here</div>
            <div className="spec-empty-body">
              Describe your app idea on the left — Based will write a full software requirements
              document.
            </div>
          </div>
        )}

        {isStreaming && (
          <>
            <div className="spec-status-line">
              ◈ Writing your spec
              <span className="spec-cursor" />
            </div>
            <pre className="spec-stream-output">{streamText}</pre>
          </>
        )}

        {hasSpec && (
          <div className="spec-output-doc">
            {sections.map((section, idx) => (
              <div key={idx} className={`spec-section${openSections.has(idx) ? ' open' : ''}`}>
                <button className="spec-section-header" onClick={() => toggleSection(idx)}>
                  <span className="spec-section-symbol">{section.symbol}</span>
                  <span className="spec-section-title">{section.heading}</span>
                  <span className="spec-section-toggle">{openSections.has(idx) ? '▾' : '▸'}</span>
                </button>
                {/* Always rendered — CSS hides when collapsed so edits survive toggle */}
                <div
                  ref={el => {
                    if (el) sectionRefs.current.set(idx, el);
                    else sectionRefs.current.delete(idx);
                  }}
                  className="spec-section-body"
                  contentEditable
                  suppressContentEditableWarning
                  style={{ display: openSections.has(idx) ? undefined : 'none' }}
                  onInput={triggerAutoSave}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Mobile fixed bottom bar ── */}
      {hasSpec && (
        <div className="spec-bottom-bar">
          <button className="spec-action-build" onClick={buildFromSpec}>
            ⬡ Build from Spec
          </button>
          <button className="spec-action-copy" onClick={() => void copyMarkdown()}>
            {copied ? '✓ Copied' : '· Copy'}
          </button>
        </div>
      )}
    </div>
  );
}

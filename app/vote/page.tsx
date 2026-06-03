'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

type Status = 'open' | 'planned' | 'in_progress' | 'done';

type FeatureRequest = {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  vote_count: number;
  created_by: string | null;
  created_at: string;
  voted: boolean;
};

const STATUS_LABELS: Record<Status, string> = {
  open: 'Open',
  planned: 'Planned',
  in_progress: 'In Progress',
  done: 'Done',
};

const FILTER_TABS: Array<Status | 'all'> = ['all', 'open', 'planned', 'in_progress', 'done'];

function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`vt-card-status vt-card-status--${status}`}>{STATUS_LABELS[status]}</span>
  );
}

export default function VotePage() {
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [authToken, setAuthToken] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [sort, setSort] = useState<'votes' | 'newest'>('votes');

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const formRef = useRef<HTMLDivElement>(null);
  // Always-current sort ref so async vote callbacks don't close over stale sort state
  const sortRef = useRef(sort);
  useEffect(() => {
    sortRef.current = sort;
  }, [sort]);

  // Derived: filter + sort — source of truth stays in `requests`
  const displayed = useMemo(() => {
    const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);
    if (sort === 'newest') {
      return [...filtered].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }
    return filtered;
  }, [requests, filter, sort]);

  // Count badges always reflect the full unfiltered list
  const counts = useMemo(() => {
    const c = { all: requests.length, open: 0, planned: 0, in_progress: 0, done: 0 } as Record<
      Status | 'all',
      number
    >;
    for (const r of requests) c[r.status]++;
    return c;
  }, [requests]);

  // Auth setup — matches companion page pattern
  useEffect(() => {
    document.title = 'Vote — Based';

    const timeoutRace = new Promise<{ data: { session: null } }>(resolve =>
      setTimeout(() => resolve({ data: { session: null } }), 3000)
    );

    Promise.race([supabase.auth.getSession(), timeoutRace]).then(({ data: { session } }) => {
      const token = session?.access_token ?? '';
      setAuthToken(token);
      setAuthReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthToken(session?.access_token ?? '');
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  // Fetch requests once auth is ready
  useEffect(() => {
    if (!authReady) return;

    const headers: HeadersInit = authToken ? { Authorization: `Bearer ${authToken}` } : {};

    fetch('/api/vote', { headers })
      .then(r => r.json())
      .then((data: FeatureRequest[] | { error: string }) => {
        if (Array.isArray(data)) {
          setRequests(data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [authReady, authToken]);

  // Extracted revert helper — uses sortRef so it never closes over stale sort state
  function revertVote(prev: FeatureRequest[], id: string): FeatureRequest[] {
    const reverted = prev.map(r => {
      if (r.id !== id) return r;
      const wasVoted = !r.voted; // r.voted is already optimistically flipped
      return { ...r, voted: wasVoted, vote_count: r.vote_count + (wasVoted ? 1 : -1) };
    });
    return sortRef.current === 'votes'
      ? reverted.sort((a, b) => b.vote_count - a.vote_count)
      : reverted;
  }

  async function handleVote(id: string) {
    if (!authToken) return;
    if (votingId) return;
    setVotingId(id);

    // Optimistic update — use sortRef for stable sort regardless of when this fires
    setRequests(prev => {
      const updated = prev.map(r => {
        if (r.id !== id) return r;
        const nowVoted = !r.voted;
        return { ...r, voted: nowVoted, vote_count: r.vote_count + (nowVoted ? 1 : -1) };
      });
      return sortRef.current === 'votes'
        ? updated.sort((a, b) => b.vote_count - a.vote_count)
        : updated;
    });

    try {
      const res = await fetch(`/api/vote/${id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const json = (await res.json()) as { voted: boolean; vote_count: number };
        setRequests(prev => {
          const updated = prev.map(r =>
            r.id === id ? { ...r, voted: json.voted, vote_count: json.vote_count } : r
          );
          return sortRef.current === 'votes'
            ? updated.sort((a, b) => b.vote_count - a.vote_count)
            : updated;
        });
      } else {
        setRequests(prev => revertVote(prev, id));
      }
    } catch {
      setRequests(prev => revertVote(prev, id));
    } finally {
      setVotingId(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!authToken) return;
    setFormError('');
    const t = title.trim();
    if (!t) {
      setFormError('Title is required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ title: t, description: description.trim() || undefined }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        setFormError(err.error ?? 'Submission failed. Try again.');
        return;
      }
      const newRequest = (await res.json()) as FeatureRequest;
      setRequests(prev => [newRequest, ...prev]);
      setFilter('all'); // ensure new 'open' card is visible regardless of active filter
      // Auto-vote for the new request — creator always wants their own idea
      handleVote(newRequest.id);
      setTitle('');
      setDescription('');
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3500);
    } catch {
      setFormError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="vt-root">
      <header className="vt-header">
        <Link href="/" className="vt-logo">
          B&gt;
        </Link>
        <nav className="vt-header-nav">
          <Link href="/roadmap" className="vt-nav-link">
            Roadmap
          </Link>
          <Link href="/changelog" className="vt-nav-link">
            Changelog
          </Link>
          <Link href="/" className="vt-nav-link">
            App
          </Link>
        </nav>
      </header>

      <section className="vt-hero">
        <div className="vt-hero-badge">Feature Requests · Vote on what gets built next</div>
        <h1 className="vt-headline">
          You decide what
          <br />
          ships next.
        </h1>
        <p className="vt-subheadline">
          Vote on the features you want most. The highest-voted requests go to the top of the build
          queue. Submit your own if it&apos;s not on the list.
        </p>
      </section>

      <div className="vt-grid">
        {/* Left column — feature list */}
        <div className="vt-list-col">
          <div className="vt-list-top">
            <span className="vt-list-count">
              {loading ? '—' : `${displayed.length} request${displayed.length !== 1 ? 's' : ''}`}
            </span>
            <button className="vt-submit-trigger" onClick={scrollToForm}>
              ◈ Submit a request →
            </button>
          </div>

          {/* Filter tabs + sort toggle */}
          {!loading && (
            <div className="vt-filters">
              {FILTER_TABS.map(f => (
                <button
                  key={f}
                  className={`vt-filter-tab${filter === f ? ' vt-filter-tab--active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All' : STATUS_LABELS[f]}
                  <span className="vt-filter-count">{counts[f]}</span>
                </button>
              ))}
              <div className="vt-sort-toggle">
                <button
                  className={`vt-sort-btn${sort === 'votes' ? ' vt-sort-btn--active' : ''}`}
                  onClick={() => setSort('votes')}
                >
                  ◈ Votes
                </button>
                <button
                  className={`vt-sort-btn${sort === 'newest' ? ' vt-sort-btn--active' : ''}`}
                  onClick={() => setSort('newest')}
                >
                  ◉ Newest
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div className="vt-loading">
              <span className="vt-loading-dot">◉</span> Loading&hellip;
            </div>
          )}

          {!loading && displayed.length === 0 && (
            <div className="vt-empty">
              {filter === 'all'
                ? 'No requests yet. Be the first to submit one.'
                : `No ${STATUS_LABELS[filter as Status].toLowerCase()} requests.`}
            </div>
          )}

          {!loading &&
            displayed.map(req => (
              <div
                key={req.id}
                className={`vt-card${req.voted ? ' vt-card--voted' : ''}${req.status === 'done' ? ' vt-card--done' : ''}`}
              >
                <div className="vt-card-body">
                  <div className="vt-card-top">
                    <StatusBadge status={req.status} />
                    {req.status === 'done' && <span className="vt-shipped-tag">⬡ Shipped</span>}
                  </div>
                  <div className="vt-card-title">{req.title}</div>
                  {req.description && <div className="vt-card-desc">{req.description}</div>}
                </div>
                <div className="vt-card-side">
                  {authToken ? (
                    <button
                      className={`vt-card-vote${req.voted ? ' vt-card-vote--active' : ''}`}
                      onClick={() => handleVote(req.id)}
                      disabled={votingId === req.id}
                      aria-label={req.voted ? 'Remove vote' : 'Vote for this request'}
                      title={req.voted ? 'Remove vote' : 'Vote'}
                    >
                      <span className="vt-vote-symbol">◈</span>
                      <span className="vt-vote-count">{req.vote_count}</span>
                    </button>
                  ) : (
                    <div className="vt-card-vote vt-card-vote--locked" title="Sign in to vote">
                      <span className="vt-vote-symbol">◈</span>
                      <span className="vt-vote-count">{req.vote_count}</span>
                      <span className="vt-vote-hint">Sign in to vote</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>

        {/* Right column — submit form */}
        <div className="vt-form-col" ref={formRef}>
          <div className="vt-submit-form">
            <div className="vt-form-header">
              <span className="vt-form-icon">◈</span>
              <span className="vt-form-title">Submit a request</span>
            </div>

            {!authReady && <div className="vt-form-loading">Loading&hellip;</div>}

            {authReady && !authToken && (
              <div className="vt-form-signin">
                <p className="vt-form-signin-text">
                  Sign in to submit feature requests and vote on what gets built.
                </p>
                <Link href="/" className="vt-form-signin-btn">
                  Sign in to Based →
                </Link>
              </div>
            )}

            {authReady && authToken && (
              <form onSubmit={handleSubmit} className="vt-form-fields">
                {submitted && (
                  <div className="vt-form-success">
                    ◉ Request submitted — it&apos;s on the list.
                  </div>
                )}
                <div className="vt-field">
                  <label className="vt-label" htmlFor="vt-title">
                    Title <span className="vt-label-req">*</span>
                  </label>
                  <input
                    id="vt-title"
                    className="vt-input"
                    type="text"
                    placeholder="What should Based be able to do?"
                    value={title}
                    onChange={e => setTitle(e.target.value.slice(0, 120))}
                    maxLength={120}
                    required
                    disabled={submitting}
                  />
                  <span className="vt-char-count">{title.length}/120</span>
                </div>
                <div className="vt-field">
                  <label className="vt-label" htmlFor="vt-desc">
                    Description <span className="vt-label-opt">(optional)</span>
                  </label>
                  <textarea
                    id="vt-desc"
                    className="vt-textarea"
                    placeholder="More context — why is this valuable? What problem does it solve?"
                    value={description}
                    onChange={e => setDescription(e.target.value.slice(0, 500))}
                    maxLength={500}
                    rows={4}
                    disabled={submitting}
                  />
                  <span className="vt-char-count">{description.length}/500</span>
                </div>
                {formError && <div className="vt-form-error">{formError}</div>}
                <button
                  type="submit"
                  className="vt-submit-btn"
                  disabled={submitting || !title.trim()}
                >
                  {submitting ? 'Submitting…' : 'Submit request →'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <footer className="vt-footer">
        <Link href="/roadmap" className="vt-footer-link">
          Roadmap
        </Link>
        <span className="vt-footer-sep">·</span>
        <Link href="/changelog" className="vt-footer-link">
          Changelog
        </Link>
        <span className="vt-footer-sep">·</span>
        <a
          href="https://ko-fi.com/basedfund"
          target="_blank"
          rel="noopener noreferrer"
          className="vt-footer-link"
        >
          ◈ Ko-fi
        </a>
        <span className="vt-footer-sep">·</span>
        <Link href="/terms" className="vt-footer-link">
          Terms
        </Link>
        <span className="vt-footer-sep">·</span>
        <Link href="/privacy" className="vt-footer-link">
          Privacy
        </Link>
        <span className="vt-footer-sep">·</span>
        <Link href="/refund" className="vt-footer-link">
          Refund
        </Link>
      </footer>
    </div>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface GalleryItem {
  id: string;
  project_name: string;
  author_name: string | null;
  remix_count: number;
  gallery_published_at: string;
}

function GalleryCard({ item, onRemix, remixing }: {
  item: GalleryItem;
  onRemix: (item: GalleryItem) => void;
  remixing: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { rootMargin: '300px' }
    );
    if (wrapRef.current) observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="gal-card">
      <div className="gal-card-preview" ref={wrapRef}>
        {visible ? (
          <iframe
            src={`/api/share/preview/${item.id}`}
            title={item.project_name}
            sandbox="allow-scripts"
            scrolling="no"
          />
        ) : (
          <div className="gal-card-preview-placeholder">
            <span className="gal-placeholder-logo">B&gt;</span>
          </div>
        )}
      </div>
      <div className="gal-card-body">
        <div className="gal-card-name">{item.project_name}</div>
        <div className="gal-card-meta">
          <span className="gal-card-author">by {item.author_name ?? 'Anonymous'}</span>
          <span className="gal-card-remixes">↻ {item.remix_count}</span>
        </div>
        <button
          className="gal-card-remix-btn"
          onClick={() => onRemix(item)}
          disabled={remixing}
        >
          {remixing ? '…' : 'Remix →'}
        </button>
      </div>
    </div>
  );
}

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [remixingId, setRemixingId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/gallery')
      .then(r => r.json())
      .then(d => { setItems(d.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleRemix(item: GalleryItem) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      localStorage.setItem('based_pending_remix', item.id);
      window.location.href = '/';
      return;
    }

    setRemixingId(item.id);
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`/api/gallery/remix/${item.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
    }).catch(() => {});

    localStorage.setItem('based_pending_remix', item.id);
    window.location.href = '/';
  }

  return (
    <div className="gal-root">
      <header className="gal-header">
        <Link href="/" className="gal-logo">B&gt;</Link>
        <div className="gal-header-right">
          <Link href="/" className="gal-back">← Back to Based</Link>
        </div>
      </header>

      <section className="gal-hero">
        <div className="gal-hero-badge">Community Gallery</div>
        <h1 className="gal-headline">Built with Based.</h1>
        <p className="gal-subheadline">Browse what others have made. Remix anything.</p>
      </section>

      {loading ? (
        <div className="gal-loading">
          <div className="gal-loading-dots"><span /><span /><span /></div>
        </div>
      ) : items.length === 0 ? (
        <div className="gal-empty">
          <div className="gal-empty-icon">⬡</div>
          <div className="gal-empty-title">Nothing here yet.</div>
          <div className="gal-empty-sub">Be the first to publish a project to the gallery.</div>
          <Link href="/" className="gal-empty-btn">Start Building →</Link>
        </div>
      ) : (
        <div className="gal-grid">
          {items.map(item => (
            <GalleryCard
              key={item.id}
              item={item}
              onRemix={handleRemix}
              remixing={remixingId === item.id}
            />
          ))}
        </div>
      )}

      <footer className="gal-footer">
        <Link href="/" className="gal-footer-link">Build something →</Link>
        <span className="gal-footer-sep">·</span>
        <Link href="/roadmap" className="gal-footer-link">Roadmap</Link>
      </footer>
    </div>
  );
}

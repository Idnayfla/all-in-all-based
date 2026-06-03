import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabaseAdmin } from '@/app/api/_auth';
import { CHANGELOG_MAP } from '@/lib/changelog-map';
import { CopyButton } from './CopyButton';

type Props = { params: Promise<{ requestId: string }> };

type FeatureRequest = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  vote_count: number;
  created_at: string;
};

async function getRequest(requestId: string): Promise<FeatureRequest | null> {
  const { data, error } = await supabaseAdmin
    .from('feature_requests')
    .select('id, title, description, status, vote_count, created_at')
    .eq('id', requestId)
    .maybeSingle();
  if (error || !data) return null;
  return data as FeatureRequest;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { requestId } = await params;
  const req = await getRequest(requestId);
  if (!req) return { title: 'Based' };
  const ref = CHANGELOG_MAP[requestId];
  const desc = `◈ You asked, we built it. This feature was requested by the Based community and shipped${ref ? ` in ${ref.label}` : ''}.`;
  return {
    title: `${req.title} — Based`,
    description: desc,
    openGraph: {
      title: req.title,
      description: 'You asked, we built it. — Based',
      url: `https://getbased.dev/shipped/${requestId}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: req.title,
      description: 'You asked, we built it. — Based',
    },
  };
}

export default async function ShippedPage({ params }: Props) {
  const { requestId } = await params;
  const req = await getRequest(requestId);
  if (!req) notFound();
  if (req!.status !== 'done') redirect(`/vote#req-${requestId}`);

  const ref = CHANGELOG_MAP[requestId];
  const daysToShip = ref?.date
    ? Math.round(
        (new Date(ref.date).getTime() - new Date(req.created_at).getTime()) / (1000 * 60 * 60 * 24)
      )
    : null;

  return (
    <div className="sp-root">
      <header className="sp-header">
        <Link href="/" className="sp-logo">
          B&gt;
        </Link>
      </header>

      <main className="sp-main">
        <div className="sp-badge">◈ You asked, we built it</div>
        <h1 className="sp-title">{req.title}</h1>

        <div className="sp-meta">
          {ref && (
            <Link href={`/changelog#${ref.anchor}`} className="sp-meta-version">
              {ref.label}
            </Link>
          )}
          <span className="sp-meta-sep">·</span>
          <span className="sp-meta-item">
            ◈ {req.vote_count} vote{req.vote_count !== 1 ? 's' : ''}
          </span>
          {daysToShip !== null && daysToShip >= 0 && (
            <>
              <span className="sp-meta-sep">·</span>
              <span className="sp-meta-item">
                Built in {daysToShip} day{daysToShip !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>

        <div className="sp-actions">
          <CopyButton />
          {ref && (
            <Link href={`/changelog#${ref.anchor}`} className="sp-btn sp-btn--secondary">
              → See in changelog
            </Link>
          )}
          <Link href="/vote" className="sp-btn sp-btn--ghost">
            → Vote on what&apos;s next
          </Link>
        </div>
      </main>

      <footer className="sp-footer">
        <Link href="/" className="sp-footer-link">
          Based
        </Link>
        <span className="sp-footer-sep">·</span>
        <a href="https://getbased.dev" className="sp-footer-link">
          getbased.dev
        </a>
        {ref && (
          <>
            <span className="sp-footer-sep">·</span>
            <Link href={`/changelog#${ref.anchor}`} className="sp-footer-link">
              {ref.label}
            </Link>
          </>
        )}
      </footer>
    </div>
  );
}

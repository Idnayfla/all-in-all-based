import { ImageResponse } from 'next/og';
import { supabaseAdmin } from '@/app/api/_auth';
import { CHANGELOG_MAP } from '@/lib/changelog-map';

export const alt = 'Based — You asked, we built it';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;

  const { data } = await supabaseAdmin
    .from('feature_requests')
    .select('title, vote_count')
    .eq('id', requestId)
    .maybeSingle();

  const ref = CHANGELOG_MAP[requestId];
  const title = (data as { title?: string } | null)?.title ?? 'Community Feature';
  const votes = (data as { vote_count?: number } | null)?.vote_count ?? 0;

  const metaParts = [
    ref?.label,
    `◈ ${votes} vote${votes !== 1 ? 's' : ''}`,
    ref?.date && data
      ? (() => {
          const days = Math.round(
            (new Date(ref.date).getTime() -
              new Date(
                (data as { created_at?: string } | null)?.created_at ?? ref.date
              ).getTime()) /
              (1000 * 60 * 60 * 24)
          );
          return days >= 0 ? `Built in ${days} day${days !== 1 ? 's' : ''}` : null;
        })()
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return new ImageResponse(
    <div
      style={{
        background: '#0a0a0f',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        fontFamily: 'monospace',
        padding: '0 80px',
        position: 'relative',
      }}
    >
      {/* Left accent line */}
      <div
        style={{
          position: 'absolute',
          left: 52,
          top: 140,
          width: 3,
          height: 220,
          background: '#5ef5c0',
          borderRadius: 2,
        }}
      />

      {/* Badge */}
      <div
        style={{
          fontSize: 18,
          color: '#5ef5c0',
          fontFamily: 'monospace',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: 28,
        }}
      >
        ◈ You asked, we built it
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: title.length > 40 ? 52 : title.length > 25 ? 62 : 72,
          color: '#f0f0f8',
          fontFamily: 'monospace',
          fontWeight: 600,
          lineHeight: 1.1,
          maxWidth: 820,
          marginBottom: 40,
        }}
      >
        {title}
      </div>

      {/* Meta row */}
      {metaParts && (
        <div
          style={{
            fontSize: 20,
            color: '#6e6e90',
            fontFamily: 'monospace',
          }}
        >
          {metaParts}
        </div>
      )}

      {/* Logo — bottom right */}
      <div
        style={{
          position: 'absolute',
          bottom: 48,
          right: 80,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 28, color: '#7c6af7', fontFamily: 'monospace', fontWeight: 700 }}>
          B&gt;
        </div>
        <div style={{ fontSize: 16, color: '#3a3a5a', fontFamily: 'monospace' }}>getbased.dev</div>
      </div>
    </div>,
    { ...size }
  );
}

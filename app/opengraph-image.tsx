import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Based — AI Dev Studio';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#0a0a0f',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
          gap: 0,
        }}
      >
        <div style={{ fontSize: 80, color: '#7c6af7', fontWeight: 700, lineHeight: 1 }}>B&gt;</div>
        <div style={{ fontSize: 56, color: '#f0f0f8', fontWeight: 800, marginTop: 24, letterSpacing: '-2px' }}>Based</div>
        <div style={{ fontSize: 20, color: '#a8a8c8', marginTop: 16, textAlign: 'center', maxWidth: 700 }}>
          You describe it. Based builds it.
        </div>
        <div style={{ fontSize: 15, color: '#6e6e90', marginTop: 12 }}>
          AI Dev Studio · Live Preview · Persistent Memory
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            fontSize: 14,
            color: '#3a3a5a',
          }}
        >
          getbased.dev
        </div>
      </div>
    ),
    { ...size },
  );
}

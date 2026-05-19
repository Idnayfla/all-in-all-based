'use client';
import { LogoConfig } from '@/hooks/useLogoConfig';

function BoltIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
      <polygon points="14,3 7,13 11.5,13 9.5,21 17,11 12.5,11" fill={color} />
    </svg>
  );
}

function DiamondIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
      <polygon points="12,3 21,12 12,21 3,12" fill={color} />
    </svg>
  );
}

function HexIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
      <polygon points="12,2 20.5,7 20.5,17 12,22 3.5,17 3.5,7" fill={color} />
    </svg>
  );
}

function CircleIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
      <circle cx="12" cy="12" r="7" fill={color} />
      <circle cx="12" cy="12" r="10.5" fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

const ICONS = { bolt: BoltIcon, diamond: DiamondIcon, hex: HexIcon, circle: CircleIcon };

export default function LogoDisplay({ config }: { config: LogoConfig }) {
  const isTerminal = config.iconShape === 'terminal';
  const IconComp = isTerminal ? null : (ICONS[config.iconShape as keyof typeof ICONS] ?? null);
  const totalDuration = config.speed + 1.2;
  const movePct = Math.round((config.speed / totalDuration) * 100);

  return (
    <div
      className="animated-logo-wrap"
      style={
        {
          '--logo-shimmer-color': config.shimmerColor,
          '--logo-speed': `${totalDuration}s`,
          '--logo-icon-bg': config.iconBg,
          '--logo-shimmer-width': `${config.shimmerWidth}%`,
          '--shimmer-move-pct': `${movePct}%`,
        } as React.CSSProperties
      }
    >
      {isTerminal ? (
        <div
          className="logo-icon-svg"
          style={{
            background: 'linear-gradient(135deg, var(--accent), var(--accent3))',
            border: 'none',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: '13px',
            color: 'var(--bg)',
            letterSpacing: '0px',
          }}
        >
          B&gt;
        </div>
      ) : (
        <div className="logo-icon-svg" style={{ background: config.iconBg }}>
          {IconComp && <IconComp color={config.shimmerColor} />}
        </div>
      )}
      <span
        className="animated-logo-text"
        style={
          isTerminal
            ? {
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: '13px',
                letterSpacing: '2px',
              }
            : undefined
        }
      >
        {config.text}
      </span>
      <div
        className="logo-shimmer"
        style={{
          width: `${config.shimmerWidth}%`,
          background: `linear-gradient(90deg, transparent, ${config.shimmerColor}55, ${config.shimmerColor}99, ${config.shimmerColor}55, transparent)`,
        }}
      />
    </div>
  );
}

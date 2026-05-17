'use client';

export default function BetaBanner() {
  if (process.env.NEXT_PUBLIC_BUILD_ENV !== 'beta') return null;
  return (
    <div className="beta-banner">
      ◈ Beta — things may break. Stable version at <a href="https://getbased.dev" target="_blank" rel="noopener noreferrer">getbased.dev</a>
    </div>
  );
}

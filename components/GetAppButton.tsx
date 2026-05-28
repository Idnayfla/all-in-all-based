'use client';

import { useEffect, useState } from 'react';
import { detectPlatform, getAppTarget, type AppPlatform } from '@/lib/appPlatform';

/** Compact header variant — same class as the existing companion-header-btn */
export function GetAppButton({ className }: { className?: string }) {
  const [platform, setPlatform] = useState<AppPlatform>('unknown');

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const target = getAppTarget(platform);

  if (!target.available) {
    return (
      <span
        className={className}
        title={`${target.note} — check back soon`}
        style={{ opacity: 0.45, cursor: 'default', userSelect: 'none' }}
      >
        {target.label}
      </span>
    );
  }

  return (
    <a
      href={target.href}
      className={className}
      download={target.isDownload || undefined}
      title={target.note}
    >
      {target.label}
    </a>
  );
}

/** Landing page variant — renders the download button + sub-note */
export function GetAppLanding({ btnClass, noteClass }: { btnClass: string; noteClass: string }) {
  const [platform, setPlatform] = useState<AppPlatform>('unknown');

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const target = getAppTarget(platform);

  return (
    <>
      {target.available ? (
        <a href={target.href} className={btnClass} download={target.isDownload || undefined}>
          {target.label}&nbsp;&#8594;
        </a>
      ) : (
        <span
          className={btnClass}
          title={`${target.note} — check back soon`}
          style={{ opacity: 0.45, cursor: 'not-allowed' }}
        >
          {target.label}&nbsp;&#8594;
        </span>
      )}
      <span className={noteClass}>
        {target.available
          ? `Free · ${target.note} · Sign in to Based first`
          : `${target.note} — available soon`}
      </span>
    </>
  );
}

'use client';

import { useState } from 'react';

export function CopyButton() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button type="button" className="sp-btn sp-btn--primary" onClick={handleCopy}>
      {copied ? '✓ Copied' : '◈ Copy link'}
    </button>
  );
}

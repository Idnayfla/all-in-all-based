'use client';
import { useState } from 'react';

export interface LogoConfig {
  text: string;
  shimmerColor: string;
  iconShape: 'bolt' | 'diamond' | 'hex' | 'circle' | 'terminal';
  speed: number;
  shimmerWidth: number;
  iconBg: string;
}

export const LOGO_DEFAULTS: LogoConfig = {
  text: 'BASED',
  shimmerColor: '#a89aff',
  iconShape: 'terminal',
  speed: 2.8,
  shimmerWidth: 0,
  iconBg: '#0a0a0f',
};

const KEY = 'logo_config';

function readStored(): LogoConfig {
  if (typeof window === 'undefined') return LOGO_DEFAULTS;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return { ...LOGO_DEFAULTS, ...JSON.parse(stored) };
  } catch {}
  return LOGO_DEFAULTS;
}

export function useLogoConfig() {
  const [config, setConfigState] = useState<LogoConfig>(readStored);

  const setConfig = (c: LogoConfig) => {
    setConfigState(c);
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
  };

  const reset = () => {
    setConfigState(LOGO_DEFAULTS);
    try { localStorage.removeItem(KEY); } catch {}
  };

  return { config, setConfig, reset };
}

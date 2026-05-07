'use client';
import { useState, useEffect } from 'react';

export interface LogoConfig {
  text: string;
  shimmerColor: string;
  iconShape: 'bolt' | 'diamond' | 'hex' | 'circle';
  speed: number;
  shimmerWidth: number;
  iconBg: string;
}

export const LOGO_DEFAULTS: LogoConfig = {
  text: 'BASED',
  shimmerColor: '#a89aff',
  iconShape: 'bolt',
  speed: 2.8,
  shimmerWidth: 40,
  iconBg: '#0a0a0f',
};

const KEY = 'logo_config';

export function useLogoConfig() {
  const [config, setConfigState] = useState<LogoConfig>(LOGO_DEFAULTS);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored) setConfigState({ ...LOGO_DEFAULTS, ...JSON.parse(stored) });
    } catch {}
  }, []);

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

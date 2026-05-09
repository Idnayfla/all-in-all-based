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

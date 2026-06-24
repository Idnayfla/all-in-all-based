export type AppPlatform = 'ios' | 'android' | 'mac' | 'windows' | 'linux' | 'unknown';

// True when running inside the native Based app shell (Android/iOS WebView).
// The native WebView appends " BasedApp" to its user-agent. Used to hide in-app
// purchase CTAs so the store builds comply with Google Play / App Store billing rules.
export function isBasedApp(): boolean {
  if (typeof navigator === 'undefined') return false;
  return / BasedApp\b/.test(navigator.userAgent);
}

export function detectPlatform(): AppPlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  const pl = (navigator.platform ?? '').toLowerCase();
  if (/ipad|iphone|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/mac/i.test(pl) || (/mac/i.test(ua) && !/mobile/i.test(ua))) return 'mac';
  if (/win/i.test(pl) || /win/i.test(ua)) return 'windows';
  if (/linux/i.test(pl)) return 'linux';
  return 'unknown';
}

const WIN_EXE =
  'https://github.com/Idnayfla/all-in-all-based/releases/download/v0.1.6/Based.Setup.0.1.6.exe';

export interface AppTarget {
  label: string;
  note: string;
  href: string;
  isDownload: boolean;
  available: boolean;
}

export function getAppTarget(platform: AppPlatform): AppTarget {
  switch (platform) {
    case 'ios':
      return {
        label: '↓ App Store',
        note: 'iOS · coming soon',
        href: '#',
        isDownload: false,
        available: false,
      };
    case 'android':
      return {
        label: '↓ Google Play',
        note: 'Android · coming soon',
        href: '#',
        isDownload: false,
        available: false,
      };
    case 'mac':
      return {
        label: '↓ Get App',
        note: 'macOS · coming soon',
        href: '#',
        isDownload: false,
        available: false,
      };
    case 'linux':
      return {
        label: '↓ Get App',
        note: 'Linux · coming soon',
        href: '#',
        isDownload: false,
        available: false,
      };
    case 'windows':
    case 'unknown':
    default:
      return {
        label: '↓ Get App',
        note: 'Windows 10/11',
        href: WIN_EXE,
        isDownload: true,
        available: true,
      };
  }
}

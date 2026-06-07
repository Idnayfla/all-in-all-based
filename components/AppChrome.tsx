'use client';

import { usePathname } from 'next/navigation';
import { Analytics } from '@vercel/analytics/react';
import Script from 'next/script';
import ErrorBoundary from './ErrorBoundary';
import BetaBanner from './BetaBanner';
import InstallPrompt from './InstallPrompt';
import ServiceWorkerInit from './ServiceWorkerInit';
import PostHogProvider from './PostHogProvider';
import { LanguageProvider } from '@/lib/i18n';
export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isCompanion =
    pathname === '/companion' ||
    pathname === '/companion-bubble' ||
    pathname === '/landing' ||
    pathname === '/team';

  if (isCompanion) {
    return (
      <LanguageProvider>
        <ErrorBoundary>{children}</ErrorBoundary>
      </LanguageProvider>
    );
  }

  return (
    <LanguageProvider>
      <BetaBanner />
      <InstallPrompt />
      <ServiceWorkerInit />
      <PostHogProvider>
        <ErrorBoundary>{children}</ErrorBoundary>
      </PostHogProvider>
      <Analytics />
      {/* Meta Pixel */}
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '27291121733834066');
            fbq('track', 'PageView');
          `,
        }}
      />
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src="https://www.facebook.com/tr?id=27291121733834066&ev=PageView&noscript=1"
          alt=""
        />
      </noscript>
    </LanguageProvider>
  );
}

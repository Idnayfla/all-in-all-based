import type { Metadata } from 'next';
import './globals.css';
import ErrorBoundary from '@/components/ErrorBoundary';
import ClientOnly from '@/components/ClientOnly';
import ServiceWorkerInit from '@/components/ServiceWorkerInit';
import LaunchSplash from '@/components/LaunchSplash';
import InstallPrompt from '@/components/InstallPrompt';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/react';
import BetaBanner from '@/components/BetaBanner';
import PostHogProvider from '@/components/PostHogProvider';
import GlobalCompanionBubble from '@/components/GlobalCompanionBubble';

export const metadata: Metadata = {
  title: 'Based — AI Dev Studio',
  description:
    'Describe what you want to build. Based generates HTML, CSS, and JS apps with a live preview. Free to start.',
  openGraph: {
    title: 'Based — AI Dev Studio',
    description: 'Describe what you want to build. Based generates it.',
    url: 'https://getbased.dev',
    siteName: 'Based',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Based — AI Dev Studio',
    description: 'Describe what you want to build. Based generates it.',
  },
  metadataBase: new URL('https://getbased.dev'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script src="/no-docwrite.js" strategy="beforeInteractive" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#7c6af7" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Based" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        {/* iOS splash screens */}
        <link
          rel="apple-touch-startup-image"
          media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)"
          href="/splash/splash-750x1334.png"
        />
        <link
          rel="apple-touch-startup-image"
          media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)"
          href="/splash/splash-1179x2556.png"
        />
        <link
          rel="apple-touch-startup-image"
          media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)"
          href="/splash/splash-1284x2778.png"
        />
        <link
          rel="apple-touch-startup-image"
          media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)"
          href="/splash/splash-1290x2796.png"
        />
        <link
          rel="apple-touch-startup-image"
          media="(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2)"
          href="/splash/splash-1640x2360.png"
        />
        <link
          rel="apple-touch-startup-image"
          media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)"
          href="/splash/splash-1668x2388.png"
        />
        <link
          rel="apple-touch-startup-image"
          media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)"
          href="/splash/splash-2048x2732.png"
        />
      </head>
      <body suppressHydrationWarning>
        <BetaBanner />
        <LaunchSplash />
        <InstallPrompt />
        <ServiceWorkerInit />
        <ClientOnly>
          <PostHogProvider>
            <ErrorBoundary>{children}</ErrorBoundary>
          </PostHogProvider>
          <GlobalCompanionBubble />
        </ClientOnly>
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
      </body>
    </html>
  );
}

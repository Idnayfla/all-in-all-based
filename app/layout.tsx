import type { Metadata } from 'next';
import './globals.css';
import ClientOnly from '@/components/ClientOnly';
import AppChrome from '@/components/AppChrome';
import Script from 'next/script';

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
        {/* Preconnect — font CDNs */}
        <link rel="preconnect" href="https://fonts.cdnfonts.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Humane display font — loaded here (not via @import) for faster render */}
        <link rel="preload" href="https://fonts.cdnfonts.com/css/humane" as="style" />
        <link rel="stylesheet" href="https://fonts.cdnfonts.com/css/humane" />
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
        <ClientOnly>
          <AppChrome>{children}</AppChrome>
        </ClientOnly>
      </body>
    </html>
  );
}

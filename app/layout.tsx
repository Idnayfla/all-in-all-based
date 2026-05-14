import type { Metadata } from 'next';
import './globals.css';
import ErrorBoundary from '@/components/ErrorBoundary';
import ClientOnly from '@/components/ClientOnly';
import ServiceWorkerInit from '@/components/ServiceWorkerInit';
import LaunchSplash from '@/components/LaunchSplash';
import InstallPrompt from '@/components/InstallPrompt';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'All in All Based',
  description: 'Your personal AI dev studio',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script src="/no-docwrite.js" strategy="beforeInteractive" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;700&family=Fira+Code:wght@400;700&family=IBM+Plex+Mono:wght@400;700&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#7c6af7" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Based" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body suppressHydrationWarning><LaunchSplash /><InstallPrompt /><ServiceWorkerInit /><ClientOnly><ErrorBoundary>{children}</ErrorBoundary></ClientOnly></body>
    </html>
  );
}

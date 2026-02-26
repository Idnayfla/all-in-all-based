import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'All in All Based',
  description: 'Now your life will be easier.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'TwoDots AI Core', template: '%s · AI Core' },
  description: 'The AI work operating system for the TwoDots ecosystem.',
};

export const viewport: Viewport = {
  themeColor: '#0f1116',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh bg-surface-0 text-ink-1 antialiased">{children}</body>
    </html>
  );
}

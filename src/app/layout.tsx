import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'TwoDots AI Core', template: '%s · AI Core' },
  description: 'The AI work operating system for the TwoDots ecosystem.',
};

export const viewport: Viewport = {
  themeColor: '#12141a',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Root shell.
 *
 * The theme is read from a cookie so the very first paint is already the right
 * one — no flash, no client-side repaint of the whole tree.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const theme = store.get('ai_core_theme')?.value === 'light' ? 'light' : 'dark';

  return (
    <html
      lang="fr"
      className={`${GeistSans.variable} ${GeistMono.variable} ${theme === 'light' ? 'theme-light' : 'dark'}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-surface-0 text-ink-1 antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-xs focus:text-accent-ink"
        >
          Aller au contenu
        </a>
        {children}
      </body>
    </html>
  );
}

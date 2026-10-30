/**
 * File: apps/web/app/layout.tsx
 * Purpose: Root HTML frame for every page (signed-in or not): <html>, <body>, font, global CSS
 *          and the page title "Kite".
 * Used by: Next.js App Router (wraps every route)
 * Depends on: next/font/google (Montserrat, IBM Plex Mono), app/globals.css
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1; docs/design/kite-ui-theme.md §4
 */
import type { Metadata } from 'next';
import { IBM_Plex_Mono, Montserrat } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * Montserrat, the brand font (UI theme §4): body and headings. Self-hosted by Next.js at build
 * time, so users' browsers never request Google. Exposed as --font-montserrat (src/ui/theme.css).
 */
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-montserrat',
});

/**
 * IBM Plex Mono for eyebrows, labels, timestamps, shortcuts and numbers (UI theme §4).
 * Exposed as --font-plex-mono.
 */
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});

/** Page title and description shown in the browser tab and the desktop window title. */
export const metadata: Metadata = {
  title: 'Kite',
  description: 'Kite call assistant: live transcript and fast answers during calls.',
};

/**
 * Root layout.
 *
 * @param props.children The page or nested layout being rendered.
 * @returns The <html> document.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${montserrat.variable} ${plexMono.variable}`}>
      <body className="bg-ui-band font-sans text-ui-text antialiased">{children}</body>
    </html>
  );
}

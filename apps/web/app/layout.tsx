/**
 * File: apps/web/app/layout.tsx
 * Purpose: Root HTML frame for every page (signed-in or not): <html>, <body>, font, global CSS
 *          and the page title "Kite".
 * Used by: Next.js App Router (wraps every route)
 * Depends on: next/font/google (Inter), app/globals.css
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1
 */
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * The Inter font, self-hosted by Next.js at build time (no request to Google from the user's
 * browser). Exposed as the CSS variable --font-inter, used by globals.css.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

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
    <html lang="en" className={inter.variable}>
      <body className="bg-slate-50 font-sans text-slate-900 antialiased">{children}</body>
    </html>
  );
}

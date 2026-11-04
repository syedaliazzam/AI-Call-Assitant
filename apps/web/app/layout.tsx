/**
 * File: apps/web/app/layout.tsx
 * Purpose: Root HTML frame for every page (signed-in or not): <html>, <body>, font, global CSS, the
 *          theme (set before the first paint) and the page title "Paramount AI".
 * Used by: Next.js App Router (wraps every route)
 * Depends on: next/font/google (Inter), app/globals.css, src/core/storage/appearancePrefs.ts,
 *             src/features/appearance/ThemeSync.tsx, src/ui/brand.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §2; docs/architecture/kite-architecture-v3.1.md §9.1
 */
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { THEME_BOOT_SCRIPT } from '@/core/storage/appearancePrefs';
import { ThemeSync } from '@/features/appearance/ThemeSync';
import { BRAND_NAME } from '@/ui/brand';
import './globals.css';

/**
 * Inter, the only font (spec §1), in three weights. Self-hosted by Next.js at build time, so users'
 * browsers never request Google. Exposed as --font-inter (src/ui/tokens/theme.css).
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
});

/** Page title and description shown in the browser tab and the desktop window title. */
export const metadata: Metadata = {
  title: BRAND_NAME,
  description: `${BRAND_NAME} call assistant: live transcript and fast answers during calls.`,
  // Brand icons (UI U4, scripts/make-brand.ts): the .ico for every browser, the SVG where
  // supported, and the Apple touch icon (on white).
  icons: {
    icon: [
      { url: '/brand/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/brand/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: { url: '/brand/apple-touch-icon.png', sizes: '180x180' },
  },
};

/**
 * Root layout.
 *
 * @param props.children The page or nested layout being rendered.
 * @returns The <html> document.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the boot script sets data-theme on this element before React loads.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Blocking on purpose: it must run before the first paint. It is our own constant text. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="bg-ui-bg font-sans text-[15px] text-ui-text antialiased">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}

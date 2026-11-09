/**
 * File: apps/web/src/features/shell/DesktopAway.tsx
 * Purpose: What a desktop window shows when it reaches a page the desktop app does not keep (ADR-0055):
 *          after a moment (a page only passed through is left alone), the page opens in the system
 *          browser once, and this window closes (with no call running the shell then brings the sessions
 *          card back). A note with "Open it again" stays in case the
 *          window cannot close (an older shell).
 * Used by: src/features/shell/AppShell.tsx
 * Depends on: src/features/sync/dashboardLink.ts, src/platform, src/ui/Button.tsx, ./desktopPages.ts
 * Architecture: ADR-0051, ADR-0055
 */
'use client';

import { useEffect, useRef } from 'react';
import { openDashboard } from '@/features/sync/dashboardLink';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { browserPathFor } from './desktopPages';

/**
 * How long the page waits before acting, in ms. The home panel passes through "/" for a moment (a
 * server redirect after changing a password); the shell sends it back to /home at once, and this page
 * is gone before it would close the panel.
 */
export const DESKTOP_AWAY_DELAY_MS = 600;

/** Props for DesktopAway. */
export interface DesktopAwayProps {
  /** The page that was asked for. */
  pathname: string;
}

/**
 * Opens the page in the browser and closes this window.
 *
 * @param props See DesktopAwayProps.
 * @returns A short note.
 * Rendered by: AppShell.tsx (desktop app with account sync, any page but the call)
 */
export function DesktopAway({ pathname }: DesktopAwayProps) {
  // Once per page: React runs effects twice in development, which would open two browser tabs.
  const done = useRef<string | null>(null);
  const target = () =>
    browserPathFor(pathname, globalThis.location?.search ?? '', globalThis.location?.hash ?? '');

  useEffect(() => {
    if (done.current === pathname) return;
    const timer = setTimeout(() => {
      done.current = pathname;
      openDashboard(browserPathFor(pathname, globalThis.location.search, globalThis.location.hash));
      // The shell closes the window (the main window steps aside instead during a call).
      getPlatform().windowControl('close');
    }, DESKTOP_AWAY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pathname]);

  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-3 bg-ui-bg p-6 text-center text-ui-text">
      <p className="text-[15px] font-medium text-ui-heading">
        The dashboard opens in your browser.
      </p>
      <p className="max-w-sm text-[14px] text-ui-muted">
        The desktop app is for calls. Sessions, notes and settings are in the dashboard.
      </p>
      <Button variant="secondary" onClick={() => openDashboard(target())}>
        Open it again
      </Button>
    </main>
  );
}

/**
 * File: apps/web/src/features/shell/desktopPages.ts
 * Purpose: Which signed-in pages a desktop app with account sync shows in its own windows (ADR-0055: one
 *          dashboard, in the browser). Only the call itself: every other page (the dashboard, a session's
 *          review, Settings, Ask AI, the libraries, Help) opens in the system browser instead.
 * Used by: src/features/shell/AppShell.tsx; tests/unit/features/shell/desktopPages.test.ts
 * Depends on: ./pageTitles.ts (isCallPage)
 * Architecture: ADR-0051, ADR-0055
 */
import { isCallPage } from './pageTitles';

/**
 * Whether a desktop app with account sync keeps a page in its own window.
 *
 * @param pathname The page's path.
 * @returns True for the live call page (/live/<id>), which runs the call, and for /dev/latency (admins
 *          only: it measures answers through the desktop app's own client path, e2e-prod latency.spec.ts;
 *          sent to the browser it could not measure the desktop); false for everything else.
 * Called from: AppShell.tsx; tests
 */
export function desktopKeepsPage(pathname: string): boolean {
  return isCallPage(pathname) || pathname === '/dev/latency';
}

/**
 * The address to open in the browser for a page the desktop app does not keep: the same page, with its
 * query and fragment.
 *
 * @param pathname The page's path.
 * @param search   The query, with its "?" ('' for none).
 * @param hash     The fragment, with its "#" ('' for none).
 * @returns The path for openDashboard().
 * Called from: DesktopAway.tsx; tests
 */
export function browserPathFor(pathname: string, search: string, hash: string): string {
  return `${pathname}${search}${hash}`;
}

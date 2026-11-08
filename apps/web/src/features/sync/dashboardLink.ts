/**
 * File: apps/web/src/features/sync/dashboardLink.ts
 * Purpose: Opens the one dashboard in the system browser (ADR-0051): with account sync, the desktop app
 *          has no dashboard of its own, so Open dashboard, Dashboard ↗, Get help, Edit session and View
 *          notes open the web app instead. Installed desktop apps load the vercel.app address
 *          (ADR-0047); people use the custom domain, so links from there go to it. Anywhere else (a
 *          local or preview run) the link stays on the same address.
 * Used by: src/features/home/HomePanel.tsx, HomeMenu.tsx, src/features/live/CompactLive.tsx,
 *          LiveAnswers.tsx
 * Depends on: the window (window.open: the desktop shell sends it to the system browser)
 * Architecture: ADR-0051, ADR-0047
 */

/** The address people use (ADR-0046). */
export const DASHBOARD_ORIGIN = 'https://call.paramountintelligence.co';

/** The address installed desktop apps load (ADR-0047). */
export const DESKTOP_APP_ORIGIN = 'https://kite-call-assistant.vercel.app';

/**
 * The dashboard address for a page.
 *
 * @param path   The page, for example '/sessions/<id>'.
 * @param origin This page's origin (tests pass one).
 * @returns The full address.
 * Called from: openDashboard(); tests
 */
export function dashboardUrl(path: string, origin: string = globalThis.location.origin): string {
  const base = origin === DESKTOP_APP_ORIGIN ? DASHBOARD_ORIGIN : origin;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Opens a dashboard page in the system browser (a new tab in a browser).
 *
 * @param path The page (default the dashboard itself).
 * Called from: the launcher, its menu, the overlay's menu and the call window
 */
export function openDashboard(path = '/'): void {
  window.open(dashboardUrl(path), '_blank', 'noopener,noreferrer');
}

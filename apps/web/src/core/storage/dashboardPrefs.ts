/**
 * File: apps/web/src/core/storage/dashboardPrefs.ts
 * Purpose: How this person likes the dashboard laid out (grid or list) and sorted, and whether they
 *          dismissed the desktop-app banner, kept in this browser. A convenience only: without storage the defaults apply.
 * Used by: src/features/dashboard/Dashboard.tsx
 * Depends on: src/core/storage/sessions.ts (SessionSort)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Dashboard); ADR-0029
 */
import type { SessionSort } from './sessions';

/** How the dashboard shows its sessions. */
export type DashboardLayout = 'list' | 'grid';

/** Where the layout is kept. */
export const DASHBOARD_LAYOUT_KEY = 'kite.dashboardLayout';

/** Where the sort order is kept. */
export const DASHBOARD_SORT_KEY = 'kite.dashboardSort';

/** Where dismissing the desktop-app banner is kept. */
export const DESKTOP_BANNER_KEY = 'kite.desktopBannerDismissed';

/**
 * Reads a setting, guarding against storage being unavailable (a private window).
 *
 * @param key The key.
 * @returns The value, or null.
 * Called from: getDashboardLayout(), getDashboardSort()
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes a setting, guarding against storage being unavailable.
 *
 * @param key   The key.
 * @param value The value.
 * Called from: setDashboardLayout(), setDashboardSort()
 */
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept: the choice lasts until the page closes.
  }
}

/**
 * The saved layout.
 *
 * @returns 'grid' or 'list' (the default).
 * Called from: Dashboard.tsx; tests
 */
export function getDashboardLayout(): DashboardLayout {
  return read(DASHBOARD_LAYOUT_KEY) === 'grid' ? 'grid' : 'list';
}

/**
 * Saves the layout.
 *
 * @param layout The layout.
 * Called from: Dashboard.tsx; tests
 */
export function setDashboardLayout(layout: DashboardLayout): void {
  write(DASHBOARD_LAYOUT_KEY, layout);
}

/**
 * The saved sort order.
 *
 * @returns 'oldest', 'company' or 'newest' (the default).
 * Called from: Dashboard.tsx; tests
 */
export function getDashboardSort(): SessionSort {
  const saved = read(DASHBOARD_SORT_KEY);
  return saved === 'oldest' || saved === 'company' ? saved : 'newest';
}

/**
 * Saves the sort order.
 *
 * @param sort The order.
 * Called from: Dashboard.tsx; tests
 */
export function setDashboardSort(sort: SessionSort): void {
  write(DASHBOARD_SORT_KEY, sort);
}

/**
 * Whether the desktop-app banner was dismissed in this browser.
 *
 * @returns True once dismissed.
 * Called from: Dashboard.tsx; tests
 */
export function getDesktopBannerDismissed(): boolean {
  return read(DESKTOP_BANNER_KEY) === 'true';
}

/**
 * Remembers that the desktop-app banner was dismissed.
 *
 * Called from: Dashboard.tsx; tests
 */
export function dismissDesktopBanner(): void {
  write(DESKTOP_BANNER_KEY, 'true');
}

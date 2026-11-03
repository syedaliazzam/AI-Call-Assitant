/**
 * File: apps/web/src/core/storage/sidebarPrefs.ts
 * Purpose: Whether this person keeps the sidebar collapsed, kept in this browser. A convenience
 *          only: without storage the sidebar stays open.
 * Used by: src/ui/Sidebar.tsx
 * Depends on: nothing (localStorage)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; docs/design/kite-ui-theme.md §6
 */

/** Where the choice is kept. */
export const SIDEBAR_COLLAPSED_KEY = 'kite.sidebarCollapsed';

/**
 * Whether the sidebar is saved as collapsed.
 *
 * @returns True when collapsed; false by default, and when storage is blocked.
 * Called from: Sidebar.tsx; tests
 */
export function getSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    // Storage blocked (private window, policy): the default applies.
    return false;
  }
}

/**
 * Saves whether the sidebar is collapsed.
 *
 * @param collapsed True when collapsed.
 * Called from: Sidebar.tsx; tests
 */
export function setSidebarCollapsedPref(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Not kept: the choice lasts until the page closes.
  }
}

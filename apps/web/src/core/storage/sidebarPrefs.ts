/**
 * File: apps/web/src/core/storage/sidebarPrefs.ts
 * Purpose: Whether this person keeps the sidebar collapsed, and whether they hid its desktop app card,
 *          kept in this browser. Conveniences only: without storage the sidebar stays open and the
 *          card stays visible.
 * Used by: src/features/shell/AppShell.tsx, src/features/shell/DesktopAppCard.tsx
 * Depends on: nothing (localStorage)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; docs/design/kite-ui-theme.md §6
 */

/** Where the choice is kept. */
export const SIDEBAR_COLLAPSED_KEY = 'kite.sidebarCollapsed';

/** Where "Hide card" is kept. */
export const DESKTOP_CARD_HIDDEN_KEY = 'kite.desktopCardHidden';

/**
 * Whether the sidebar is saved as collapsed.
 *
 * @returns True when collapsed; false by default, and when storage is blocked.
 * Called from: AppShell.tsx; tests
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
 * Called from: AppShell.tsx; tests
 */
export function setSidebarCollapsedPref(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Not kept: the choice lasts until the page closes.
  }
}

/**
 * Whether the desktop app card was hidden.
 *
 * @returns True when hidden; false by default, and when storage is blocked.
 * Called from: DesktopAppCard.tsx; tests
 */
export function getDesktopCardHidden(): boolean {
  try {
    return localStorage.getItem(DESKTOP_CARD_HIDDEN_KEY) === 'true';
  } catch {
    // Storage blocked (private window, policy): the card stays.
    return false;
  }
}

/**
 * Remembers that the desktop app card was hidden.
 *
 * Called from: DesktopAppCard.tsx; tests
 */
export function setDesktopCardHidden(): void {
  try {
    localStorage.setItem(DESKTOP_CARD_HIDDEN_KEY, 'true');
  } catch {
    // Not kept: the card comes back with the next page load.
  }
}

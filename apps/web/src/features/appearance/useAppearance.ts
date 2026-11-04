/**
 * File: apps/web/src/features/appearance/useAppearance.ts
 * Purpose: The theme, UI scale and text size for a desktop panel (v1.1.0, ADR-0041): the saved choices
 *          (shared by every Kite window on this device), the theme actually painted, and the UI scale
 *          applied to the window's page.
 * Used by: src/features/home/HomePanel.tsx, src/features/live/CompactLive.tsx
 * Depends on: src/core/storage/appearancePrefs.ts
 * Architecture: docs/design/kite-ui-theme.md; ADR-0041
 */
'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  getFontScale,
  getTheme,
  getZoom,
  resolveTheme,
  subscribeAppearance,
  type ResolvedTheme,
  type ThemeChoice,
} from '@/core/storage/appearancePrefs';

/** The media query for a system set to dark. */
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Listens for the system's light or dark setting changing.
 *
 * @param listener Called after a change.
 * @returns A function that stops listening.
 * Called from: useAppearance()
 */
function subscribeSystem(listener: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/**
 * Whether the system prefers dark.
 *
 * @returns True when it does.
 * Called from: useAppearance()
 */
const systemPrefersDark = () => window.matchMedia(DARK_QUERY).matches;

/** What useAppearance() returns. */
export interface Appearance {
  /** The theme the user chose. */
  theme: ThemeChoice;
  /** The theme to paint. */
  resolved: ResolvedTheme;
  /** The UI scale. */
  zoom: number;
  /** The overlay's text size. */
  fontScale: number;
}

/**
 * The saved appearance, kept up to date, with the UI scale applied to this page. CSS zoom on the root
 * rather than a shell call, so it also works in a desktop app before 1.1.0. Server render: the
 * defaults, painted dark, the look the overlay has always had.
 *
 * @param apply False to leave the page's scale alone (the browser's picture-in-picture window shares
 *              its document with the call's tab). Default true.
 * @returns The appearance.
 * Called from: HomePanel.tsx, CompactLive.tsx
 */
export function useAppearance(apply = true): Appearance {
  const theme = useSyncExternalStore<ThemeChoice>(subscribeAppearance, getTheme, () => 'system');
  const zoom = useSyncExternalStore(subscribeAppearance, getZoom, () => 1);
  const fontScale = useSyncExternalStore(subscribeAppearance, getFontScale, () => 1);
  const prefersDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => true);
  useEffect(() => {
    if (!apply) return;
    document.documentElement.style.zoom = zoom === 1 ? '' : String(zoom);
  }, [apply, zoom]);
  return { theme, resolved: resolveTheme(theme, prefersDark), zoom, fontScale };
}

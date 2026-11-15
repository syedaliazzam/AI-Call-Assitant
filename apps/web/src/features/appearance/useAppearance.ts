/**
 * File: apps/web/src/features/appearance/useAppearance.ts
 * Purpose: The theme, UI scale and text size for a desktop panel (v1.1.0, ADR-0041): the saved choices
 *          (shared by every Kite window on this device), the theme actually painted, and the UI scale
 *          applied to the window's page (CSS zoom, and --k-zoom for full-height boxes, ADR-0085).
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
  THEME_DEFAULTS,
  type ResolvedTheme,
  type ThemeChoice,
  type ThemeSurface,
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
 * surface's default theme.
 *
 * @param surface Whose theme: 'dashboard' (home panel) or 'call' (compact view, call windows; v1.3.0).
 * @param apply   False to leave the page's scale alone (the browser's picture-in-picture window shares
 *                its document with the call's tab). Default true.
 * @returns The appearance.
 * Called from: HomePanel.tsx, CompactLive.tsx, LiveAnswers.tsx, LiveCallLayout.tsx,
 *              BrowserCallLayout.tsx, TranscriptStrip.tsx
 */
export function useAppearance(surface: ThemeSurface, apply = true): Appearance {
  const theme = useSyncExternalStore<ThemeChoice>(
    subscribeAppearance,
    () => getTheme(surface),
    () => THEME_DEFAULTS[surface],
  );
  const zoom = useSyncExternalStore(subscribeAppearance, getZoom, () => 1);
  const fontScale = useSyncExternalStore(subscribeAppearance, getFontScale, () => 1);
  const prefersDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => true);
  useEffect(() => {
    if (!apply) return;
    const html = document.documentElement;
    html.style.zoom = zoom === 1 ? '' : String(zoom);
    // ADR-0085: the zoom for CSS too. Under CSS zoom, 100vh inside the page is scaled with it (measured:
    // at 130 % a 100vh overlay was 1.3 times the window's height, so the page scrolled), so a full-height
    // box is calc(100vh / var(--k-zoom)) (theme.css .k-zoom-screen).
    if (zoom === 1) html.style.removeProperty('--k-zoom');
    else html.style.setProperty('--k-zoom', String(zoom));
  }, [apply, zoom]);
  return { theme, resolved: resolveTheme(theme, prefersDark), zoom, fontScale };
}

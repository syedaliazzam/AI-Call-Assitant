/**
 * File: apps/web/src/features/appearance/ThemeSync.tsx
 * Purpose: Keeps the whole document in the theme the user chose (light, dark or system, spec §1), when
 *          the choice changes in any window and when the system's setting changes. The first paint is
 *          already right: THEME_BOOT_SCRIPT runs before it.
 * Used by: app/layout.tsx
 * Depends on: src/core/storage/appearancePrefs.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §1
 */
'use client';

import { useEffect } from 'react';
import {
  applyResolvedTheme,
  getTheme,
  resolveTheme,
  subscribeAppearance,
} from '@/core/storage/appearancePrefs';

/**
 * Renders nothing; applies the theme to <html> and follows changes.
 *
 * @returns Nothing.
 * Rendered by: app/layout.tsx
 */
export function ThemeSync() {
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    /** Paints the current choice. */
    const apply = () => {
      applyResolvedTheme(resolveTheme(getTheme(), query.matches));
    };
    apply();
    const stop = subscribeAppearance(apply);
    query.addEventListener('change', apply);
    return () => {
      stop();
      query.removeEventListener('change', apply);
    };
  }, []);
  return null;
}

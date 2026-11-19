/**
 * File: apps/web/src/ui/useIsMac.ts
 * Purpose: A React hook that tells a component whether it runs on a Mac (ADR-0109), for what to show:
 *          the Mac download, the Mac keys, Mac-only notes. The server cannot know, so it renders the
 *          non-Mac version and the browser corrects it after hydration (as KeyCap does).
 * Used by: src/features/shell/MacInstall.tsx and the download places, src/features/privacy, the key labels
 * Depends on: src/platform (isMacComputer)
 * Architecture: docs/decisions/ADR-0109-macos-internal-release.md
 */
'use client';

import { useSyncExternalStore } from 'react';
import { isMacComputer } from '@/platform';

/**
 * Nothing to subscribe to: the computer does not change while a page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/**
 * Whether this is a Mac.
 *
 * @returns True on a Mac (false during server render).
 * Called from: components that show Mac-specific words or downloads
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribeNever, isMacComputer, () => false);
}

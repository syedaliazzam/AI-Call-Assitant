/**
 * File: apps/web/src/features/privacy/usePrivate.ts
 * Purpose: "Private" (v1.1.0, ADR-0042): one toggle and one state for screen-share protection, read
 *          the same way in both ⋮ menus and in Settings, and kept in step between windows. The words
 *          say plainly what it does and does not do.
 * Used by: src/features/home/HomeMenu.tsx, src/features/live/overlay/LiveMenu.tsx,
 *          src/features/settings/Settings.tsx
 * Depends on: src/platform (share protection), @kite/shared (ShareProtectionState)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §4; ADR-0042; CLAUDE.md (protection)
 */
'use client';

import type { ShareProtectionState } from '@kite/shared';
import { useCallback, useEffect, useState } from 'react';
import { getPlatform } from '@/platform';

/** The setting's name everywhere it appears. */
export const PRIVATE_LABEL = 'Private';

/** The channel that tells the other Kite windows the setting changed. Holds no call content. */
const PRIVATE_CHANNEL = 'kite.private';

/**
 * What Private does, for its info button and for Settings.
 *
 * @param state The current state, or null while it is being read.
 * @returns The words.
 * Called from: HomeMenu.tsx, LiveMenu.tsx, Settings.tsx; tests
 */
export function privateHint(state: ShareProtectionState | null): string {
  if (state && !state.supported) {
    return getPlatform().kind === 'desktop'
      ? 'This computer cannot hide a window from screen sharing. Share a single window instead of the whole screen, or keep Kite on another monitor.'
      : 'A browser cannot hide its windows from screen sharing. In the meeting, share a single tab or window instead of the whole screen, or keep Kite on another monitor. The Kite desktop app can hide its windows.';
  }
  // A shell before 1.1.0 reports no scope, and covers only the overlay.
  const what = state && state.scope !== 'all' ? "Kite's overlay is" : "All of Kite's windows are";
  return `${what} left out of screen shares (Windows 10 version 2004 or later; on macOS, some capture apps may still show them). Kite stays in your taskbar. It does nothing against monitoring or proctoring tools.`;
}

/** What usePrivate() returns. */
export interface PrivateSetting {
  /** The state, or null while it is being read. */
  state: ShareProtectionState | null;
  /**
   * Turns it on or off for every window.
   *
   * @param on The new setting.
   */
  change: (on: boolean) => void;
}

/**
 * The Private setting, kept in step with the other Kite windows on this device.
 *
 * @returns The state and how to change it.
 * Called from: HomeMenu.tsx, LiveMenu.tsx, Settings.tsx
 */
export function usePrivate(): PrivateSetting {
  const [state, setState] = useState<ShareProtectionState | null>(null);

  useEffect(() => {
    let active = true;
    /** Reads the shell's setting. */
    const read = () => {
      getPlatform()
        .getShareProtection()
        .then((next) => {
          if (active) setState(next);
        })
        .catch(() => undefined);
    };
    read();
    const channel = new BroadcastChannel(PRIVATE_CHANNEL);
    channel.onmessage = read;
    return () => {
      active = false;
      channel.close();
    };
  }, []);

  const change = useCallback((on: boolean) => {
    getPlatform()
      .setShareProtection(on)
      .then((next) => {
        setState(next);
        const channel = new BroadcastChannel(PRIVATE_CHANNEL);
        channel.postMessage('changed');
        channel.close();
      })
      .catch(() => undefined);
  }, []);

  return { state, change };
}

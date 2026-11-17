/**
 * File: apps/web/src/features/live/useLiveElsewhere.ts
 * Purpose: The sessions live on another device of the account now (ADR-0098), for the session cards and
 *          Meetings. Reads the page's store (core/live/liveSessions.ts), which asks the server while a card
 *          is shown.
 * Used by: src/features/dashboard/Dashboard.tsx, src/features/home/Launcher.tsx,
 *          src/features/meetings/MeetingsPage.tsx
 * Depends on: react, src/core/live/liveSessions.ts
 * Architecture: docs/decisions/ADR-0098-live-call-lock.md
 */
'use client';

import { useSyncExternalStore } from 'react';
import { NO_LIVE_SESSIONS, liveSessions } from '@/core/live/liveSessions';

/**
 * The session ids live on another device.
 *
 * @returns The set (empty on the server's render and until the first answer).
 * Called from: Dashboard.tsx, Launcher.tsx, MeetingsPage.tsx
 */
export function useLiveElsewhere(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => liveSessions().subscribe(listener),
    () => liveSessions().snapshot(),
    () => NO_LIVE_SESSIONS,
  );
}

/** The words on a session live elsewhere, and the tooltip of its disabled Start. */
export const LIVE_ELSEWHERE_LABEL = 'Live on another device';

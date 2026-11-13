/**
 * File: apps/web/src/features/live/AfterCallRunner.tsx
 * Purpose: Runs the after-call work (ADR-0077; core/live/afterCall.ts) in the background of every
 *          signed-in Kite window, the desktop panel and the call window included: shortly after the page
 *          opens, when a call ends in any window, when the computer comes back online, and every 30
 *          seconds (which also picks up a call window that closed). One window of the profile works at a
 *          time. Renders nothing.
 * Used by: app/(app)/layout.tsx, app/home/page.tsx
 * Depends on: src/core/live/afterCall.ts
 * Architecture: ADR-0077
 */
'use client';

import { useEffect } from 'react';
import { onAfterCallMessage, runAfterCallOnce } from '@/core/live/afterCall';

/** How long after the page opens the first run starts, ms (the page's own loading goes first). */
const FIRST_RUN_MS = 2_000;

/** How often the calls are looked at, ms. */
const EVERY_MS = 30_000;

/**
 * The background runner.
 *
 * @returns Nothing visible.
 * Rendered by: app/(app)/layout.tsx, app/home/page.tsx
 */
export function AfterCallRunner() {
  useEffect(() => {
    let running = false;
    let again = false;
    let stopped = false;
    /** Runs once; a request during a run makes one more run afterwards. */
    const run = async () => {
      if (stopped) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          await runAfterCallOnce().catch(() => undefined);
        } while (again && !stopped);
      } finally {
        running = false;
      }
    };
    const first = window.setTimeout(() => void run(), FIRST_RUN_MS);
    const timer = window.setInterval(() => void run(), EVERY_MS);
    const stop = onAfterCallMessage(() => void run());
    const online = () => void run();
    window.addEventListener('online', online);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      stop();
      window.removeEventListener('online', online);
    };
  }, []);

  return null;
}

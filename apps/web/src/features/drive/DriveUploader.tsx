/**
 * File: apps/web/src/features/drive/DriveUploader.tsx
 * Purpose: Runs the Google Drive uploader in the background of every signed-in Kite window (ADR-0072):
 *          shortly after the page opens, when a call is queued or Drive settings change in any window,
 *          when the computer comes back online, and every minute (which also picks up the end of a call
 *          in another window). One window of the profile uploads at a time (core/drive/runner.ts); while a
 *          call is live nothing is uploaded. Renders nothing.
 * Used by: app/(app)/layout.tsx, app/home/page.tsx
 * Depends on: src/core/drive/{runner,queue}.ts, src/platform, src/features/shell/AccountName.tsx
 * Architecture: ADR-0072
 */
'use client';

import { useEffect, useRef } from 'react';
import { onDriveMessage } from '@/core/drive/queue';
import { createUploaderDeps, runUploaderOnce } from '@/core/drive/runner';
import { useAccountName } from '@/features/shell/AccountName';
import { getPlatform } from '@/platform';

/** How long after the page opens the first run starts, ms (the page's own loading goes first). */
const FIRST_RUN_MS = 4_000;

/** How often the queue is looked at, ms. */
const EVERY_MS = 60_000;

/**
 * The background uploader.
 *
 * @returns Nothing visible.
 * Rendered by: app/(app)/layout.tsx, app/home/page.tsx
 */
export function DriveUploader() {
  const accountName = useAccountName();
  const nameRef = useRef(accountName);
  useEffect(() => {
    nameRef.current = accountName;
  }, [accountName]);

  useEffect(() => {
    let running = false;
    let again = false;
    let stopped = false;
    /** Runs the queue; a request during a run makes one more run afterwards. */
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
          await runUploaderOnce(createUploaderDeps(getPlatform(), nameRef.current)).catch(
            () => undefined,
          );
        } while (again && !stopped);
      } finally {
        running = false;
      }
    };
    const first = window.setTimeout(() => void run(), FIRST_RUN_MS);
    const timer = window.setInterval(() => void run(), EVERY_MS);
    const stop = onDriveMessage(() => void run());
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

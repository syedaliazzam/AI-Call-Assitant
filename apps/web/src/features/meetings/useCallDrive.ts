/**
 * File: apps/web/src/features/meetings/useCallDrive.ts
 * Purpose: The shown call's Google Drive side in the Meetings library (ADR-0096): asks the server once per
 *          call and page (POST /api/drive/call-access) for the person's own session folder, Viewer access
 *          to it (so "Watch in Drive" opens for them) and the call's saved file links. Kept in memory for
 *          the page's life, so moving between calls does not ask again.
 * Used by: CallPane.tsx (WatchTab, FilesTab)
 * Depends on: @kite/shared (DriveCallAccessResponse), src/core/drive/api.ts
 * Architecture: docs/decisions/ADR-0096-meetings-library.md
 *
 * Holds folder and file links only; nothing is logged.
 */
'use client';

import type { DriveCallAccessResponse } from '@kite/shared';
import { useEffect, useState } from 'react';
import { driveApi } from '@/core/drive/api';

/** Where the call's Drive side stands. */
export type CallDriveState =
  | {
      /** Asking the server. */
      kind: 'loading';
    }
  | {
      /** The answer (folderUrl null: the session has no folder yet). */
      kind: 'ready';
      /** The folder, access and files. */
      drive: DriveCallAccessResponse;
    }
  | {
      /**
       * Google Drive is not set up for the company, needs an admin, or did not answer; the page shows the
       * call's own status instead.
       */
      kind: 'unavailable';
    };

/** Answers already had on this page, by "<session>:<call start>". */
const answers = new Map<string, DriveCallAccessResponse>();

/**
 * The call's Drive folder, access and file links.
 *
 * @param sessionId     The session.
 * @param callStartedAt The call's start (Unix ms).
 * @param refresh       Changes when the call's Drive upload moved on (its state), so a finished upload
 *                      is asked about again.
 * @returns Where it stands.
 * Called from: CallPane.tsx
 */
export function useCallDrive(
  sessionId: string,
  callStartedAt: number,
  refresh: string,
): CallDriveState {
  const key = `${sessionId}:${callStartedAt}:${refresh}`;
  const [state, setState] = useState<{ key: string; value: CallDriveState }>({
    key: '',
    value: { kind: 'loading' },
  });

  useEffect(() => {
    // Already asked on this page: read below, nothing to fetch.
    if (answers.has(key)) return;
    let live = true;
    driveApi()
      .callAccess({ sessionId, callStartedAt })
      .then((drive) => {
        answers.set(key, drive);
        if (live) setState({ key, value: { kind: 'ready', drive } });
      })
      .catch(() => {
        // Not connected, no company folder, an admin must reconnect, offline: the call's status says it.
        if (live) setState({ key, value: { kind: 'unavailable' } });
      });
    return () => {
      live = false;
    };
  }, [key, sessionId, callStartedAt]);

  const known = answers.get(key);
  if (known) return { kind: 'ready', drive: known };
  // Until this call's answer arrives, it is loading (never the previous call's answer).
  return state.key === key ? state.value : { kind: 'loading' };
}

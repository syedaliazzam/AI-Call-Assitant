/**
 * File: apps/web/src/core/meetings/load.ts
 * Purpose: Reads the Meetings library (ADR-0096) from this device's copy of the account's synced call data:
 *          every session and each session's calls with their lines, answers, notes and recording records
 *          (core/review/calls.ts buildCallViews, the same rules as the session page). The recordings list is
 *          read once for all sessions.
 * Used by: src/features/meetings/MeetingsPage.tsx
 * Depends on: src/core/storage (sessions, calls, utterances, answers, callNotes, notes, recordings),
 *             src/core/review/calls.ts, ./library.ts
 * Architecture: docs/decisions/ADR-0096-meetings-library.md
 *
 * Runs on this device only; nothing here is logged or sent. The local database belongs to the signed-in
 * account only (ADR-0082), and the server syncs only that account's records, so the library never holds
 * another person's calls.
 */
import { buildCallViews, type CallView } from '../review/calls';
import { listAnswers } from '../storage/answers';
import { listCallNotes } from '../storage/callNotes';
import { listCalls } from '../storage/calls';
import { getNotes } from '../storage/notes';
import { listRecordings } from '../storage/recordings';
import { listSessions } from '../storage/sessions';
import { listUtterances } from '../storage/utterances';
import { buildLibrary, type LibraryFolder } from './library';

/**
 * Reads the library.
 *
 * @param now The clock (a running call's length).
 * @returns The session folders, newest call first.
 * @throws When the local database cannot be read (the page says so).
 * Called from: MeetingsPage.tsx
 */
export async function loadLibrary(now: number = Date.now()): Promise<LibraryFolder[]> {
  const [sessions, recordings] = await Promise.all([listSessions(), listRecordings()]);
  const calls = new Map<string, CallView[]>();
  await Promise.all(
    sessions.map(async (session) => {
      const [records, lines, answers, callNotes, legacyNotes] = await Promise.all([
        listCalls(session.id),
        listUtterances(session.id),
        listAnswers(session.id),
        listCallNotes(session.id),
        getNotes(session.id),
      ]);
      calls.set(
        session.id,
        buildCallViews({
          sessionId: session.id,
          calls: records,
          lines,
          answers,
          callNotes,
          legacyNotes,
          recordings,
          now,
        }),
      );
    }),
  );
  return buildLibrary(sessions, calls);
}

/**
 * File: apps/web/src/core/session/handoff.ts
 * Purpose: Moves one session from a browser to the desktop app with a file (spec S9, option B chosen by
 *          the developer at Phase 0): browsers and the desktop app keep separate data (ADR-0024), and
 *          call data stays off the server. The browser saves the session and its documents in the export
 *          format; the desktop app reads that file. Importing a newer copy of a session replaces the
 *          older one, but keeps what the desktop app has done with it (its status and call length).
 * Used by: src/features/session-setup/ChoosePlatformDialog.tsx, src/features/handoff/DesktopHandoffPage.tsx,
 *          src/features/home/StartSessionCard.tsx
 * Depends on: @kite/shared (handoffFileName), src/core/review/downloadTranscript.ts (downloadFile),
 *             src/core/storage (db.ts, exportData.ts, types.ts)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S9); ADR-0024; ADR-0045
 *
 * The file holds the user's own session text; it is never logged or sent anywhere.
 */
import { handoffFileName } from '@kite/shared';
import { downloadFile } from '../review/downloadTranscript';
import { getDb } from '../storage/db';
import { EXPORT_FORMAT, EXPORT_VERSION, parseExport, type ExportFile } from '../storage/exportData';
import type { Session, StoredDocument } from '../storage/types';

/**
 * Writes one session as a hand-off file: its details and documents, nothing from any earlier call.
 *
 * @param sessionId The session.
 * @param now       The time it is written (Unix ms), which also says which copy is newer.
 * @returns The file's contents, or null when this device has no such session.
 * Called from: saveHandoffFile(); tests
 */
export async function buildHandoffFile(
  sessionId: string,
  now = Date.now(),
): Promise<ExportFile | null> {
  const db = getDb();
  const session = await db.sessions.get(sessionId);
  if (!session) return null;
  const documents = await db.documents.where('sessionId').equals(sessionId).toArray();
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now,
    sessions: [session],
    documents: documents.map(
      ({ id, sessionId: owner, name, chars, addedAt, text, kind, sourceId }) => ({
        id,
        sessionId: owner,
        name,
        chars,
        addedAt,
        text,
        ...(kind ? { kind } : {}),
        ...(sourceId ? { sourceId } : {}),
      }),
    ),
    utterances: [],
    answers: [],
    notes: [],
    lessons: [],
  };
}

/**
 * Saves a session's hand-off file to the browser's downloads.
 *
 * @param sessionId The session.
 * @returns True when the download started; false when this device has no such session.
 * Called from: Dashboard.tsx (Choose platform's Desktop app), DesktopHandoffPage.tsx
 */
export async function saveHandoffFile(sessionId: string): Promise<boolean> {
  const file = await buildHandoffFile(sessionId);
  if (!file) return false;
  downloadFile(handoffFileName(sessionId), 'application/json', JSON.stringify(file));
  return true;
}

/** What reading a hand-off file did. */
export type HandoffResult =
  | {
      /** It worked. */
      ok: true;
      /** The session this device now holds. */
      sessionId: string;
      /** 'added' (new here), 'replaced' (an older copy was here) or 'kept' (this device's is newer). */
      outcome: 'added' | 'replaced' | 'kept';
    }
  | {
      /** It did not. */
      ok: false;
      /** Why, in words for the user (never the file's content). */
      message: string;
    };

/**
 * The session as this device stores it after a hand-off. A copy already here keeps what happened to it
 * here; a new one has not started, whatever state it was in where it came from.
 *
 * @param incoming The file's session.
 * @param existing The copy already here, if any.
 * @param handoffAt When the file was written (Unix ms).
 * @returns The session to store.
 * Called from: importHandoff(); tests
 */
export function mergedHandoffSession(
  incoming: Session,
  existing: Session | undefined,
  handoffAt: number,
): Session {
  if (existing) {
    const { lastCallMs } = existing;
    return {
      ...incoming,
      createdAt: existing.createdAt,
      status: existing.status,
      lastActiveAt: existing.lastActiveAt,
      handoffAt,
      ...(lastCallMs === undefined ? {} : { lastCallMs }),
    };
  }
  const { lastCallMs: _lastCallMs, ...details } = incoming;
  return { ...details, status: 'not-started', lastActiveAt: null, handoffAt };
}

/**
 * Reads a hand-off file into this device's storage, all in one transaction. The file goes through the
 * same checks as any import.
 *
 * @param text     The file's text.
 * @param expected The session the link named, if any: a file for another session is refused.
 * @returns What happened, or a message for the user.
 * Called from: StartSessionCard.tsx; tests
 */
export async function importHandoff(text: string, expected?: string): Promise<HandoffResult> {
  const parsed = parseExport(text);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const { file } = parsed;
  const incoming = file.sessions[0];
  if (!incoming || file.sessions.length !== 1) {
    return {
      ok: false,
      message: 'This file is not a session hand-off. Choose the file for this session.',
    };
  }
  if (expected && incoming.id !== expected) {
    return {
      ok: false,
      message: `This file is for another session. Choose ${handoffFileName(expected)}.`,
    };
  }
  const db = getDb();
  return db.transaction('rw', db.sessions, db.documents, async () => {
    const existing = await db.sessions.get(incoming.id);
    // Picking an older file again must not undo a newer copy.
    if (existing && (existing.handoffAt ?? 0) >= file.exportedAt) {
      return { ok: true, sessionId: incoming.id, outcome: 'kept' as const };
    }
    await db.sessions.put(mergedHandoffSession(incoming, existing, file.exportedAt));
    await db.documents.where('sessionId').equals(incoming.id).delete();
    await db.documents.bulkAdd(
      file.documents
        .filter((document) => document.sessionId === incoming.id && document.text !== undefined)
        .map(
          ({ id, sessionId, name, chars, addedAt, text: documentText, kind, sourceId, part }) =>
            ({
              id,
              sessionId,
              name,
              chars,
              addedAt,
              text: documentText ?? '',
              ...(kind ? { kind } : {}),
              ...(sourceId ? { sourceId } : {}),
              // 1.5.1 (ADR-0069): a long document's part keeps its place.
              ...(part ? { part } : {}),
            }) satisfies StoredDocument,
        ),
    );
    return {
      ok: true,
      sessionId: incoming.id,
      outcome: existing ? ('replaced' as const) : ('added' as const),
    };
  });
}

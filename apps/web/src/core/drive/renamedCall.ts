/**
 * File: apps/web/src/core/drive/renamedCall.ts
 * Purpose: After the other person of a call is renamed on the session page (ADR-0093), makes the call's
 *          transcript PDF and notes PDF again with the new name and replaces the copies already saved in
 *          Google Drive (POST /api/drive/files with replace). The notes are not written again: their text
 *          shows the new name in place of the old one (relabelNotes()), so no Claude request is made. A
 *          call whose Drive upload has not finished needs nothing here: its files are made when they are
 *          uploaded, so they already carry the new name.
 * Used by: src/features/review/SessionReview.tsx (after a rename)
 * Depends on: src/core/drive (api.ts, callFiles.ts, names.ts), src/core/review/calls.ts,
 *             src/core/storage/sessions.ts
 * Architecture: ADR-0072, ADR-0077, ADR-0093
 *
 * Logs counts and outcomes only; never names, titles or file contents.
 */
import { loadSessionCalls, type CallView } from '../review/calls';
import { getSession } from '../storage/sessions';
import type { Session } from '../storage/types';
import { driveApi, type DriveApi } from './api';
import { buildCallViewFiles, type CallFile } from './callFiles';
import { callFileDriveName, sessionTitle } from './names';

/** How refreshing a renamed call's Drive files went. */
export type RenamedCallOutcome =
  /** Its PDFs were made again and replaced in Drive. */
  | 'replaced'
  /** Nothing to replace: the call is not saved to Drive (yet), or saves nothing. */
  | 'not-saved'
  /** At least one file could not be replaced (the old copy stays in Drive). */
  | 'failed';

/** What refreshRenamedCall() needs (tests replace them). */
export interface RenamedCallDeps {
  /** The session. */
  session(sessionId: string): Promise<Session | null | undefined>;
  /** The session's calls. */
  calls(sessionId: string): Promise<CallView[]>;
  /** The call's files, made from this device's data. */
  files(session: Session, call: CallView, title: string): Promise<CallFile[]>;
  /** The Drive API. */
  api: Pick<DriveApi, 'uploadFile'>;
}

/**
 * The real dependencies.
 *
 * @param accountName The account's display name, on the user's turns in the transcript PDF.
 * @returns The dependencies.
 * Called from: refreshRenamedCall()
 */
function realDeps(accountName: string | null): RenamedCallDeps {
  return {
    session: getSession,
    calls: (sessionId) => loadSessionCalls(sessionId),
    files: (session, call, title) => buildCallViewFiles(session, call, title, accountName),
    api: driveApi(),
  };
}

/**
 * Makes a renamed call's PDFs again and replaces them in Drive, when the call's upload is done.
 *
 * @param sessionId   The session.
 * @param callId      The renamed call.
 * @param accountName The account's display name (the user's turns in the transcript PDF).
 * @param deps        The dependencies (tests pass fakes).
 * @returns How it went. Never throws.
 * Called from: SessionReview.tsx (after Rename); tests
 */
export async function refreshRenamedCall(
  sessionId: string,
  callId: string,
  accountName: string | null,
  deps: RenamedCallDeps = realDeps(accountName),
): Promise<RenamedCallOutcome> {
  try {
    const [session, calls] = await Promise.all([deps.session(sessionId), deps.calls(sessionId)]);
    const call = calls.find((one) => one.id === callId);
    // Only a call whose upload finished has copies in Drive to replace; an unfinished one makes its
    // files when they are uploaded, with the name it has then.
    if (!session || !call || call.record?.drive.state !== 'done') return 'not-saved';
    const files = await deps.files(session, call, sessionTitle(session));
    if (files.length === 0) return 'not-saved';
    let failed = 0;
    for (const file of files) {
      try {
        await deps.api.uploadFile({
          sessionId,
          key: `call:${call.startedAt}:${file.kind}`,
          name: callFileDriveName(call.startedAt, file.kind),
          blob: file.blob,
          replace: true,
        });
      } catch {
        failed += 1;
      }
    }
    console.info('drive: renamed call files', { files: files.length, failed });
    return failed > 0 ? 'failed' : 'replaced';
  } catch {
    console.warn('drive: renamed call files failed');
    return 'failed';
  }
}

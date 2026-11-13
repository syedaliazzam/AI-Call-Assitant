/**
 * File: apps/web/src/core/drive/earlierCalls.ts
 * Purpose: "Upload N earlier calls" (ADR-0077): the calls of this device that never reached Google Drive
 *          (made before Drive was set up, or whose upload was never queued), each queued as its own job.
 *          Built from the calls (core/review/calls.ts: call records, and calls made before records worked
 *          out from their lines, answers and recordings), never guessed again per device, and never a call
 *          already in Drive: a call already in one of this device's uploads (an older per-session job, or a
 *          call job) is left out, and the files keep their keys, so the server finds any file already there
 *          by its tag. Earlier calls are emailed only by hand ("Send email" in Settings).
 * Used by: src/features/drive/GoogleDriveSetting.tsx ("Upload N earlier calls"),
 *          src/features/drive/DriveSessionStatus.tsx ("Upload to Drive" on a session card)
 * Depends on: src/core/review/calls.ts, src/core/storage (sessions, driveUploads, driveCallJobs, calls),
 *             src/core/live/deviceId.ts, src/core/drive/queue.ts
 * Architecture: ADR-0077
 */
import type { LocalRecording } from '@kite/shared';
import { thisDeviceId } from '../live/deviceId';
import { loadSessionCalls, type CallView } from '../review/calls';
import { updateCall } from '../storage/calls';
import { listCallJobs, queueCallJob } from '../storage/driveCallJobs';
import { listDriveJobs } from '../storage/driveUploads';
import { listSessions } from '../storage/sessions';
import type { DriveCallJob, DriveSessionJob, Session } from '../storage/types';
import { announceDrive } from './queue';

/** One earlier call to upload. */
export interface EarlierCall {
  /** The call's id (its record's, or a legacy call's worked-out id). */
  callId: string;
  /** Its session. */
  sessionId: string;
  /** When it started (Unix ms): its Drive files' keys and names. */
  startedAt: number;
  /** When it ended (Unix ms). */
  endedAt: number;
  /** True for a call made before call records. */
  legacy: boolean;
}

/** What findEarlierCalls() looks at. */
export interface EarlierCallsInput {
  /** The sessions and their calls. */
  sessions: readonly { session: Session; calls: readonly CallView[] }[];
  /** This device's older per-session uploads. */
  legacyJobs: readonly DriveSessionJob[];
  /** This device's call uploads. */
  callJobs: readonly DriveCallJob[];
  /** This device's id. */
  deviceId: string;
  /** This computer's recordings (none in a browser). */
  localRecordings: readonly LocalRecording[];
  /**
   * True to offer legacy calls of sessions this device never uploaded (a session card's own "Upload to
   * Drive"); false for Settings, which offers them only for sessions this device uploaded or recorded.
   */
  anySession: boolean;
}

/**
 * Whether two calls overlap in time (strictly: a call that ended before the next started does not).
 *
 * @param a One call.
 * @param b The other.
 * @returns True when they share a moment, or start at the same time.
 * Called from: findEarlierCalls(); tests
 */
export function sameTime(
  a: { startedAt: number; endedAt: number },
  b: { startedAt: number; endedAt: number },
): boolean {
  if (a.startedAt === b.startedAt) return true;
  return a.startedAt < b.endedAt && b.startedAt < a.endedAt;
}

/**
 * Whether a call has anything Drive would get from this device: a transcript or answers (when the session
 * saves its transcript), notes, or a recording on this computer.
 *
 * @param session The session.
 * @param call    The call.
 * @param local   This computer's recordings.
 * @returns True when there is something to upload.
 */
function hasFiles(session: Session, call: CallView, local: readonly LocalRecording[]): boolean {
  if (session.saveTranscript && (call.lines.length > 0 || call.answers.length > 0)) return true;
  if (call.notes) return true;
  const ids = new Set(call.recordings.map((recording) => recording.id));
  return local.some((recording) => ids.has(recording.id));
}

/**
 * The earlier calls to upload (pure).
 *
 * @param input See EarlierCallsInput.
 * @returns The calls, oldest first.
 * Called from: loadEarlierCalls(); tests
 */
export function findEarlierCalls(input: EarlierCallsInput): EarlierCall[] {
  const jobIds = new Set(input.callJobs.map((job) => job.callId));
  const out: EarlierCall[] = [];
  for (const { session, calls } of input.sessions) {
    const legacyJob = input.legacyJobs.find((job) => job.sessionId === session.id);
    const known = [
      ...(legacyJob?.calls ?? []),
      ...input.callJobs.filter((job) => job.sessionId === session.id),
    ];
    const recordedHere = input.localRecordings.some(
      (recording) => recording.sessionId === session.id,
    );
    for (const call of calls) {
      if (jobIds.has(call.id)) continue;
      if (call.record) {
        // A call with a record: this device's, ended, and never queued (Drive was off when it ended).
        if (call.record.deviceId !== input.deviceId || call.record.phase !== 'ended') continue;
        if (call.record.drive.state !== 'off') continue;
      } else if (!input.anySession && !legacyJob && !recordedHere) {
        // A legacy call of a session this device never uploaded nor recorded: another device's to upload.
        continue;
      }
      // Already in one of this device's uploads (an older per-session job's call, or a call job).
      if (known.some((other) => sameTime(call, other))) continue;
      if (!hasFiles(session, call, input.localRecordings)) continue;
      out.push({
        callId: call.id,
        sessionId: session.id,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        legacy: call.legacy,
      });
    }
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Reads this device's data and finds the earlier calls to upload.
 *
 * @param options.sessionId  Only this session (a session card); omit for all (Settings).
 * @param options.recordings This computer's recordings (the platform's; none in a browser).
 * @returns The calls, oldest first.
 * Called from: GoogleDriveSetting.tsx, DriveSessionStatus.tsx (through uploadEarlierCalls()); tests
 */
export async function loadEarlierCalls(
  options: { sessionId?: string; recordings?: () => Promise<LocalRecording[]> } = {},
): Promise<EarlierCall[]> {
  const sessions = (await listSessions()).filter(
    (session) => !options.sessionId || session.id === options.sessionId,
  );
  const [legacyJobs, callJobs, localRecordings] = await Promise.all([
    listDriveJobs(),
    listCallJobs(),
    options.recordings ? options.recordings().catch(() => []) : Promise.resolve([]),
  ]);
  const withCalls = [];
  for (const session of sessions) {
    withCalls.push({ session, calls: await loadSessionCalls(session.id) });
  }
  return findEarlierCalls({
    sessions: withCalls,
    legacyJobs,
    callJobs,
    deviceId: thisDeviceId(),
    localRecordings,
    anySession: options.sessionId !== undefined,
  });
}

/**
 * Queues the given earlier calls, each as its own upload (emailed only by hand), and wakes the uploader.
 *
 * @param calls The calls (from loadEarlierCalls()).
 * @returns How many were queued.
 * Called from: GoogleDriveSetting.tsx, DriveSessionStatus.tsx
 */
export async function uploadEarlierCalls(calls: readonly EarlierCall[]): Promise<number> {
  for (const call of calls) {
    await queueCallJob({
      callId: call.callId,
      sessionId: call.sessionId,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      recordingMatch: call.legacy ? 'window' : 'meeting',
      origin: 'earlier',
    });
    // A call with a record shows it is queued (nothing changes for a legacy call: it has no record).
    if (!call.legacy)
      await updateCall(call.callId, { drive: { state: 'queued' } }).catch(() => false);
  }
  if (calls.length > 0) announceDrive('queued');
  return calls.length;
}

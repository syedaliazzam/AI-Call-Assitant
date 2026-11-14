/**
 * File: apps/web/src/server/google/report.ts
 * Purpose: One complete "saved" email per call (ADR-0072, 1.6.0; per call from ADR-0073, as a session can
 *          be started again after it ended): names each call's record (notificationKey), merges the
 *          reports that devices send for a call (the browser's transcript and notes, the desktop app's
 *          recording parts, retries, a later backfill) into one record, says whether everything expected is in Drive (every recording
 *          part the account knows of: its main file only, ADR-0080), and when the email may go: as soon as it is
 *          complete, or 24 hours after the first report with "Recording upload pending". ADR-0077 (calls ended
 *          from 13 Nov 2026, the 'two-step' rule): email 1 "Call saved" as soon as the call's transcript
 *          and notes are in Drive ("Recording: uploading…" when one is expected), and its own record for
 *          email 2 "Recording saved" once every recording file is in ("Recording not uploaded" after 24
 *          hours); a recording already in email 1 gets no second email. Pure functions.
 * Used by: src/server/google/api.ts; tests
 * Depends on: @kite/shared (report types), src/server/google/store.ts (NotificationContent type)
 * Architecture: ADR-0072, ADR-0073, ADR-0080 (only the main video is waited for)
 */
import 'server-only';
import type { DriveExpectedRecording, DriveFileKind, DriveSavedFile } from '@kite/shared';
import type { NotificationContent } from './store';

/** How long after a call's first report the email goes even without the recording, ms. */
export const REPORT_WAIT_MS = 24 * 60 * 60_000;

/** Joins a later call's start to its session id in a record key (never part of a UUID). */
const CALL_KEY_SEPARATOR = '~';

/** ADR-0077: ends the key of a call's "Recording saved" record. */
const RECORDING_KEY_SUFFIX = '~recording';

/**
 * The key of one call's record in drive_notification.session_id (ADR-0073). The session's first record
 * (its first reported call, or a whole session saved before ADR-0073) keeps the plain session id, so
 * records from before the change stay valid with no migration; each later call is
 * "<session id>~<call start>".
 *
 * @param sessionId The session.
 * @param call      null for the session's first record, else the later call's start (Unix ms).
 * @returns The key.
 * Called from: api.ts (notify, retry); tests
 */
export function notificationKey(sessionId: string, call: number | null): string {
  return call === null ? sessionId : `${sessionId}${CALL_KEY_SEPARATOR}${call}`;
}

/**
 * Splits a record key back into its session and call (notificationKey's reverse).
 *
 * @param key The key.
 * @returns The session id, and the later call's start or null for the session's first record.
 * Called from: api.ts (notifications list); tests
 */
export function splitNotificationKey(key: string): {
  sessionId: string;
  call: number | null;
  kind: 'call' | 'recording';
} {
  // ADR-0077: a call's "Recording saved" record ends with its own suffix.
  const recording = key.endsWith(RECORDING_KEY_SUFFIX);
  const base = recording ? key.slice(0, -RECORDING_KEY_SUFFIX.length) : key;
  const kind = recording ? ('recording' as const) : ('call' as const);
  const at = base.indexOf(CALL_KEY_SEPARATOR);
  if (at < 0) return { sessionId: base, call: null, kind };
  const call = Number(base.slice(at + 1));
  return { sessionId: base.slice(0, at), call: Number.isSafeInteger(call) ? call : null, kind };
}

/**
 * ADR-0077: the key of a call's "Recording saved" record (email 2): always by the call's start, also when
 * its "Call saved" record is the session's first (plain) one.
 *
 * @param sessionId     The session.
 * @param callStartedAt The call's start (Unix ms).
 * @returns "<session id>~<call start>~recording".
 * Called from: api.ts (notify, sending email 1, retry); tests
 */
export function recordingKey(sessionId: string, callStartedAt: number): string {
  return `${notificationKey(sessionId, callStartedAt)}${RECORDING_KEY_SUFFIX}`;
}

/**
 * Which record a call's report goes to (ADR-0073): the session's first record when there is none yet or
 * it is about the same call (the same start), else the call's own.
 *
 * @param sessionId The session.
 * @param callStartedAt The reported call's start.
 * @param first     The session's first record's content, or null when it has none.
 * @param twoStep   ADR-0077: true for a call reported with the two-step rule: it never makes a new plain
 *                  record (the plain key stays for older records); it uses the session's first record only
 *                  when that one is about the same call.
 * @returns The record key.
 * Called from: api.ts (handleNotify); tests
 */
export function reportKey(
  sessionId: string,
  callStartedAt: number,
  first: Pick<NotificationContent, 'callStartedAt'> | null,
  twoStep = false,
): string {
  if (twoStep) {
    return first && first.callStartedAt === callStartedAt
      ? notificationKey(sessionId, null)
      : notificationKey(sessionId, callStartedAt);
  }
  return !first || first.callStartedAt === callStartedAt
    ? notificationKey(sessionId, null)
    : notificationKey(sessionId, callStartedAt);
}

/** One device's report, as the route checked it. */
export interface SessionReport {
  /** The session's title. */
  title: string;
  /** When the call started. */
  callStartedAt: number;
  /** The call's length, ms. */
  durationMs: number;
  /** The files this device saved. */
  files: DriveSavedFile[];
  /** The session folder. */
  folderUrl: string;
  /** The person's time zone. */
  timeZone: string;
  /** The session's own Also notify list, or null. */
  alsoNotify: string[] | null;
  /** The recordings the account knows this call has. */
  expectedRecordings: DriveExpectedRecording[];
  /** Recordings whose files were deleted (never coming). */
  goneRecordings: string[];
  /** ADR-0077: the email rule ('two-step'), or absent for the single email. */
  emailRule?: 'two-step';
  /** ADR-0077: true once the call's Transcripts files are all in Drive (or none to save). */
  callFilesSaved?: boolean;
  /** ADR-0077: the session's Recordings subfolder in Drive. */
  recordingsFolderUrl?: string;
}

/**
 * A file's key for merging: its own key, or (older records) its folder and name.
 * @param file The file.
 * @returns The key.
 */
function fileKey(file: DriveSavedFile): string {
  return file.key ?? `${file.folder}/${file.name}`;
}

/**
 * Merges a report into a session's record. Files and recordings are merged by key and id (a report
 * repeated after a retry or a restart changes nothing); the title, folder, zone and Also notify list are
 * the latest report's; the start is the earliest and the length the longest reported.
 *
 * @param current The record so far, or null for the first report.
 * @param report  The new report.
 * @returns The merged record (recipients are left as they were; they are worked out when sending).
 * Called from: api.ts (handleNotify); tests
 */
export function mergeReport(
  current: NotificationContent | null,
  report: SessionReport,
): NotificationContent {
  const files = new Map<string, DriveSavedFile>();
  for (const file of [...(current?.files ?? []), ...report.files]) files.set(fileKey(file), file);
  const expected = new Map<string, DriveExpectedRecording>();
  for (const recording of [...(current?.expected ?? []), ...report.expectedRecordings]) {
    expected.set(recording.id, recording);
  }
  return {
    title: report.title,
    callStartedAt: current
      ? Math.min(current.callStartedAt, report.callStartedAt)
      : report.callStartedAt,
    durationMs: Math.max(current?.durationMs ?? 0, report.durationMs),
    files: [...files.values()],
    folderUrl: report.folderUrl,
    timeZone: report.timeZone,
    recipients: current?.recipients ?? [],
    alsoNotify: report.alsoNotify,
    expected: [...expected.values()],
    gone: [...new Set([...(current?.gone ?? []), ...report.goneRecordings])],
    ...(current?.recordingPending ? { recordingPending: true } : {}),
    // ADR-0077: the rule, once set, stays; the Transcripts flag only ever turns on.
    ...(current?.rule === 'two-step' || report.emailRule === 'two-step'
      ? { rule: 'two-step' as const }
      : {}),
    ...(current?.callFilesSaved || report.callFilesSaved ? { callFilesSaved: true } : {}),
    ...(report.recordingsFolderUrl || current?.recordingsFolderUrl
      ? { recordingsFolderUrl: report.recordingsFolderUrl ?? current?.recordingsFolderUrl }
      : {}),
    ...(current?.kind ? { kind: current.kind } : {}),
    ...(current?.lastTriedAt ? { lastTriedAt: current.lastTriedAt } : {}),
  };
}

/**
 * ADR-0077: a call's "Recording saved" record, made from its "Call saved" one when email 1 goes without the
 * recording: the same call, folder and expected recordings, only the Recordings files.
 *
 * @param content The call's record.
 * @returns The recording record's content.
 * Called from: api.ts (sending email 1); tests
 */
export function recordingContent(content: NotificationContent): NotificationContent {
  return {
    title: content.title,
    callStartedAt: content.callStartedAt,
    durationMs: content.durationMs,
    files: content.files.filter((file) => file.folder === 'Recordings'),
    folderUrl: content.folderUrl,
    timeZone: content.timeZone,
    recipients: [],
    alsoNotify: content.alsoNotify ?? null,
    expected: content.expected ?? [],
    gone: content.gone ?? [],
    rule: 'two-step',
    kind: 'recording',
    ...(content.recordingsFolderUrl ? { recordingsFolderUrl: content.recordingsFolderUrl } : {}),
  };
}

/**
 * ADR-0077: merges a report into a call's "Recording saved" record: only its recording files, and what the
 * account knows of its recordings.
 *
 * @param current The record so far (null: made from the report alone).
 * @param report  The report.
 * @returns The merged record.
 * Called from: api.ts (notify); tests
 */
export function mergeRecordingReport(
  current: NotificationContent | null,
  report: SessionReport,
): NotificationContent {
  const merged = mergeReport(current, {
    ...report,
    files: report.files.filter((file) => file.folder === 'Recordings'),
  });
  return { ...merged, kind: 'recording', rule: 'two-step' };
}

/**
 * ADR-0077: whether email 1 goes without the call's recording, so email 2 must follow: a recording is
 * expected (one not deleted) and not all of it is in Drive yet.
 *
 * @param content The call's record.
 * @returns True when a "Recording saved" record is needed.
 * Called from: api.ts (sending email 1); tests
 */
export function needsRecordingEmail(content: NotificationContent): boolean {
  if (content.rule !== 'two-step' || content.kind === 'recording') return false;
  const gone = new Set(content.gone ?? []);
  const expected = (content.expected ?? []).filter((recording) => !gone.has(recording.id));
  return expected.length > 0 && !isComplete(content);
}

/**
 * The recording files still missing from Drive: each expected part (not deleted) needs its main file.
 * ADR-0080: the stereo sound file is no longer uploaded, so it is never waited for, even when an older
 * open page still reports the part with `stereo: true` (that page could otherwise hold the email back
 * for a file that will never come).
 *
 * @param content The session's record.
 * @returns The missing files' keys (empty when nothing is missing).
 * Called from: isComplete(); api.ts; tests
 */
export function missingRecordingFiles(content: NotificationContent): string[] {
  const saved = new Set(
    content.files.filter((file) => file.key && file.fileId).map((file) => file.key!),
  );
  const gone = new Set(content.gone ?? []);
  const missing: string[] = [];
  for (const recording of content.expected ?? []) {
    if (gone.has(recording.id)) continue;
    const key = `rec:${recording.id}:main`;
    if (!saved.has(key)) missing.push(key);
  }
  return missing;
}

/**
 * Whether everything expected for the session is in Drive.
 *
 * @param content The session's record.
 * @returns True when no recording file is missing.
 * Called from: emailDue(); api.ts; tests
 */
export function isComplete(content: NotificationContent): boolean {
  return missingRecordingFiles(content).length === 0;
}

/**
 * Whether the session's email may go now.
 *
 * @param content   The session's record.
 * @param firstSeen When its first report came (Unix ms).
 * @param now       The clock.
 * @returns 'complete', 'overdue' (24 hours passed: send without the recording), or null (wait).
 * Called from: api.ts (after a report, and the overdue check); tests
 */
export function emailDue(
  content: NotificationContent,
  firstSeen: number,
  now: number,
): 'complete' | 'overdue' | null {
  const overdue = now - firstSeen >= REPORT_WAIT_MS ? ('overdue' as const) : null;
  // ADR-0077, email 1: as soon as the transcript and notes are in (the recording does not wait).
  if (content.rule === 'two-step' && content.kind !== 'recording') {
    return content.callFilesSaved ? 'complete' : overdue;
  }
  // Email 2 (and the single email of older calls): when every recording file is in.
  if (isComplete(content)) return 'complete';
  return overdue;
}

/**
 * Who gets the email: the person first, then the session's own list or, without one, the Settings list.
 *
 * @param userEmail The person's address.
 * @param content   The session's record (its own Also notify list).
 * @param settings  The Settings list.
 * @returns Lower-case addresses, no repeats.
 * Called from: api.ts (sending); tests
 */
export function recipientsFor(
  userEmail: string,
  content: Pick<NotificationContent, 'alsoNotify'>,
  settings: readonly string[],
): string[] {
  const team = content.alsoNotify?.length ? content.alsoNotify : settings;
  return [...new Set([userEmail, ...team].map((address) => address.trim().toLowerCase()))];
}

/**
 * What a file is, from its kind or (older records) its name.
 *
 * @param file The file.
 * @returns The kind and part, or null when the name says nothing.
 * Called from: email.ts (labels and order); tests
 */
export function fileKindOf(file: DriveSavedFile): { kind: DriveFileKind; part: number } | null {
  if (file.kind) return { kind: file.kind, part: file.part ?? 1 };
  const part = Number(/Part (\d+)/.exec(file.name)?.[1] ?? 1);
  if (/ stereo\.webm$/.test(file.name)) return { kind: 'stereo', part };
  if (file.folder === 'Recordings') return { kind: 'recording', part };
  if (/Transcript\.txt$/.test(file.name)) return { kind: 'transcript-txt', part: 1 };
  if (/Transcript\.pdf$/.test(file.name)) return { kind: 'transcript-pdf', part: 1 };
  if (/Notes\.pdf$/.test(file.name)) return { kind: 'notes-pdf', part: 1 };
  return null;
}

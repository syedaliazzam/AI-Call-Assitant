/**
 * File: apps/web/src/core/drive/uploader.ts
 * Purpose: Saves finished calls to Google Drive (ADR-0072), one session at a time, after the call and
 *          never during one: finds or makes the session folder "<date> <company> – <title>" and its
 *          Recordings and Transcripts subfolders (tagged, and their ids kept, so they are never made
 *          twice), lists the call's files (this computer's recording parts and stereo files, the
 *          transcript TXT and PDF, the notes PDF), and uploads each one resumably: the upload session's
 *          address and progress are kept, so a restart or a lost connection resumes, and a file already
 *          in Drive (by its id, or by its tag) is never uploaded again. Recordings are uploaded by the
 *          desktop shell straight from disk; the page uploads the files it makes. When every file is
 *          saved, the server is told once (one "saved" email per session) and a notice is shown.
 * Used by: src/features/drive/DriveUploader.tsx (runs it), tests
 * Depends on: @kite/shared (contract types, savedHeadline), src/core/drive/{names,google,callFiles,api}.ts,
 *             src/core/storage/types.ts
 * Architecture: ADR-0072, ADR-0073 (each call reported on its own, for its own email); architecture §7.1
 *
 * Never logs: ids, names, titles and file contents stay out of the console.
 */
import {
  MAX_SAVED_FILES,
  savedHeadline,
  type DriveExpectedRecording,
  type DriveFileKind,
  type DesktopNotice,
  type DriveSavedFile,
  type DriveStatusResponse,
  type DriveUploadProgress,
  type DriveUploadRequest,
  type DriveUploadResult,
  type LocalRecording,
} from '@kite/shared';
import { withCallFlags } from '../storage/driveUploads';
import type { DriveCall, DriveFileJob, DriveSessionJob, Session } from '../storage/types';
import { DriveApiError, type DriveApi } from './api';
import type { CallFile } from './callFiles';
import { DriveRequestError, tagValue, type DriveClient, type DriveTag } from './google';
import { callFileDriveName, recordingDriveName, sessionFolderName, sessionTitle } from './names';
import type { DriveReason } from './reasons';

/** A recording counts as the call's when it started this long before the call's recorded start, ms. */
const RECORDING_SLACK_MS = 60_000;

/** How many times one file may get a new token or a new upload session before it stops. */
const MAX_RESTARTS = 3;

/** The desktop shell's part, through the platform. */
export interface DriveRecordingHost {
  /** This computer's recordings (the shell's index). */
  recordings(): Promise<LocalRecording[]>;
  /**
   * Uploads one recording file to an upload session.
   * @param request    The recording, file, address and token.
   * @param onProgress Called after each chunk.
   */
  upload(
    request: DriveUploadRequest,
    onProgress: (progress: DriveUploadProgress) => void,
  ): Promise<DriveUploadResult>;
}

/** A recording part the account knows of, with its start (to match it to a call). */
export interface KnownRecording extends DriveExpectedRecording {
  /** When it started (Unix ms). */
  startedAt: number;
}

/**
 * Whether a recording was made during one call (the window planFiles() uses).
 * @param call      The call.
 * @param startedAt When the recording started.
 * @returns True when it belongs to that call.
 */
function inCall(call: DriveCall, startedAt: number): boolean {
  return startedAt >= call.startedAt - RECORDING_SLACK_MS && startedAt <= call.endedAt;
}

/**
 * The call a file belongs to (ADR-0073). A recording file listed before recording files knew their call
 * counts as the first call's.
 * @param job  The job.
 * @param file The file.
 * @returns The call's start (Unix ms), or undefined for a job with no calls.
 * Called from: savedFiles(); tests
 */
export function fileCall(
  job: Pick<DriveSessionJob, 'calls'>,
  file: Pick<DriveFileJob, 'callStartedAt'>,
): number | undefined {
  return file.callStartedAt ?? job.calls[0]?.startedAt;
}

/** The job store (core/storage/driveUploads.ts; tests use a Map). */
export interface DriveJobStore {
  /** The next job to work on. */
  next(): Promise<DriveSessionJob | null>;
  /** Every job. */
  list(): Promise<DriveSessionJob[]>;
  /**
   * Saves a job whole.
   * @param job The job.
   */
  put(job: DriveSessionJob): Promise<void>;
  /**
   * Forgets a job.
   * @param sessionId Its session.
   */
  remove(sessionId: string): Promise<void>;
}

/** What the uploader needs. */
export interface UploaderDeps {
  /** Kite's routes: status, tokens, the notification. */
  api: Pick<DriveApi, 'status' | 'token' | 'notify'>;
  /** Drive. */
  drive: DriveClient;
  /** The desktop shell's recording uploads, or null (a browser). */
  host: DriveRecordingHost | null;
  /** The jobs. */
  jobs: DriveJobStore;
  /**
   * A session from this device's storage.
   * @param id The session.
   */
  session(id: string): Promise<Session | null>;
  /**
   * A call's Transcripts files.
   * @param session The session.
   * @param call    The call.
   * @param title   The session's title.
   */
  callFiles(session: Session, call: DriveCall, title: string): Promise<CallFile[]>;
  /** True while a call is live on this computer (uploads wait). */
  callActive(): Promise<boolean>;
  /**
   * Shows the native "saved" notification (desktop); the in-app notice comes from the job itself.
   * @param notice The lines and the Drive link.
   */
  notice(notice: DesktopNotice): void;
  /** The clock (Unix ms). */
  now(): number;
  /** The person's time zone (for the email's date). */
  timeZone(): string;
  /**
   * Every recording part the account knows a session has (this computer's index and the synced records
   * of other computers), finished ones only, with when each started.
   * @param sessionId The session.
   */
  expectedRecordings(sessionId: string): Promise<KnownRecording[]>;
}

/** How one job's turn ended. */
export type JobOutcome = 'done' | 'paused' | 'waiting' | 'error' | 'gone';

/**
 * The status reason that makes uploads wait, if any.
 * @param status The connection's status.
 * @returns The reason, or null when uploads can go ahead.
 * Called from: runDriveQueue(), processDriveJob(); tests
 */
export function waitingReason(status: DriveStatusResponse): DriveReason | null {
  if (!status.configured || status.status === 'not-connected') return 'not-connected';
  if (status.status === 'reconnect') return 'reconnect';
  if (!status.folder) return 'no-folder';
  if (!status.saveEnabled) return 'save-off';
  return null;
}

/**
 * A file's MIME type from its name.
 * @param name The Drive name.
 * @returns The type.
 */
function mimeOf(name: string): string {
  if (name.endsWith('.mkv')) return 'video/x-matroska';
  if (name.endsWith(' stereo.webm')) return 'audio/webm';
  if (name.endsWith('.webm')) return 'video/webm';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return 'text/plain';
}

/**
 * The extension of a recording's main file.
 * @param fileName The shell's file name.
 * @returns 'mkv' or 'webm'.
 */
function extensionOf(fileName: string): string {
  return /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? 'webm';
}

/**
 * The files a job should hold now: what it had, plus any new recording part or call file found. Keys
 * are stable, so a file is never listed twice.
 *
 * @param job        The job.
 * @param recordings This computer's recordings (none in a browser).
 * @param callFiles  Each call's Transcripts files, by call start.
 * @returns The files, recordings first then Transcripts, each in call order.
 * Called from: processDriveJob(); tests
 */
export function planFiles(
  job: DriveSessionJob,
  recordings: readonly LocalRecording[],
  callFiles: ReadonlyMap<number, readonly CallFile[]>,
): DriveFileJob[] {
  const files = [...job.files];
  const have = new Set(files.map((file) => file.key));
  const add = (file: DriveFileJob) => {
    if (have.has(file.key)) {
      // ADR-0073: a recording file listed before files knew their call learns it now.
      const at = files.findIndex((known) => known.key === file.key);
      const known = files[at];
      if (known && known.callStartedAt === undefined && file.callStartedAt !== undefined) {
        files[at] = { ...known, callStartedAt: file.callStartedAt };
      }
      return;
    }
    have.add(file.key);
    files.push(file);
  };
  for (const call of job.calls) {
    const parts = recordings
      .filter(
        (recording) =>
          recording.sessionId === job.sessionId &&
          (recording.status === 'complete' || recording.status === 'recovered') &&
          recording.startedAt >= call.startedAt - RECORDING_SLACK_MS &&
          recording.startedAt <= call.endedAt,
      )
      .sort((a, b) => a.part - b.part || a.startedAt - b.startedAt);
    for (const recording of parts) {
      add({
        key: `rec:${recording.id}:main`,
        folder: 'Recordings',
        name: recordingDriveName(
          call.startedAt,
          recording.part,
          extensionOf(recording.fileName),
          false,
        ),
        recordingId: recording.id,
        track: 'main',
        part: recording.part,
        callStartedAt: call.startedAt,
        bytes: recording.bytes,
        sent: 0,
        done: false,
      });
      if (recording.hasStereo) {
        add({
          key: `rec:${recording.id}:stereo`,
          folder: 'Recordings',
          name: recordingDriveName(call.startedAt, recording.part, 'webm', true),
          recordingId: recording.id,
          track: 'stereo',
          part: recording.part,
          callStartedAt: call.startedAt,
          bytes: 0,
          sent: 0,
          done: false,
        });
      }
    }
    for (const file of callFiles.get(call.startedAt) ?? []) {
      add({
        key: `call:${call.startedAt}:${file.kind}`,
        folder: 'Transcripts',
        name: callFileDriveName(call.startedAt, file.kind),
        callStartedAt: call.startedAt,
        bytes: file.blob.size,
        sent: 0,
        done: false,
      });
    }
  }
  return files;
}

/**
 * The share of a job's bytes in Drive, for "Uploading to Drive 42%".
 *
 * @param job The job.
 * @returns 0–100 (whole numbers); 100 when done.
 * Called from: features/drive/*; tests
 */
export function jobPercent(job: Pick<DriveSessionJob, 'state' | 'files'>): number {
  if (job.state === 'done') return 100;
  const total = job.files.reduce((sum, file) => sum + Math.max(file.bytes, file.sent), 0);
  if (total === 0) return 0;
  const sent = job.files.reduce(
    (sum, file) => sum + (file.done ? Math.max(file.bytes, file.sent) : file.sent),
    0,
  );
  return Math.min(99, Math.floor((sent / total) * 100));
}

/**
 * Runs one job's turn: folders, files, uploads, and the "saved" notification when everything is in.
 *
 * @param deps   The dependencies.
 * @param start  The job as read.
 * @param status The connection's status (read once per run).
 * @returns How the turn ended.
 * Called from: runDriveQueue(); tests
 */
export async function processDriveJob(
  deps: UploaderDeps,
  start: DriveSessionJob,
  status: DriveStatusResponse,
): Promise<JobOutcome> {
  let job: DriveSessionJob = { ...start, files: start.files.map((file) => ({ ...file })) };
  const save = async (changes: Partial<DriveSessionJob> = {}) => {
    job = { ...job, ...changes, updatedAt: deps.now() };
    await deps.jobs.put(job);
  };
  const stopWith = async (
    state: 'waiting' | 'error' | 'paused',
    reason?: DriveReason,
    autoRetry = false,
  ): Promise<JobOutcome> => {
    await save({ state, reason, autoRetry: autoRetry || undefined });
    return state;
  };

  const waiting = waitingReason(status);
  if (waiting) return stopWith('waiting', waiting);
  const folder = status.folder!;
  if (await deps.callActive()) return stopWith('paused');

  const session = await deps.session(job.sessionId);
  if (!session) {
    // The session was deleted: nothing more to save; what is in Drive stays.
    await deps.jobs.remove(job.sessionId);
    return 'gone';
  }
  const title = sessionTitle(session);

  // A different folder chosen in Settings: this session starts again in the new one.
  if (job.parentId && job.parentId !== folder.id) {
    job.files = job.files.map((file) => ({
      ...file,
      done: false,
      missing: undefined,
      sent: 0,
      uploadUrl: undefined,
      driveFileId: undefined,
    }));
    job.folderId = undefined;
    job.recordingsId = undefined;
    job.transcriptsId = undefined;
    // ADR-0073: each call tells the server its new files once more (an email already sent is not sent
    // again; its record gains the new links). A closed call stays closed.
    job.calls = withCallFlags(job).calls.map((call) =>
      call.closed ? call : { ...call, reportedFiles: 0, notified: false },
    );
  }
  await save({ state: 'uploading', reason: undefined, autoRetry: undefined, parentId: folder.id });

  try {
    const sessionTag = await tagValue(job.sessionId);
    // The session folder: kept id, else Kite's tagged folder in the chosen folder, else a new one.
    if (!job.folderId) {
      const tags: DriveTag[] = [
        { key: 'kiteSession', value: sessionTag },
        { key: 'kiteFolder', value: 'session' },
      ];
      job.folderId =
        (await deps.drive.find(folder.id, tags, folder.driveId)) ??
        (await deps.drive.createFolder(
          sessionFolderName(session, job.calls[0]?.startedAt ?? job.queuedAt),
          folder.id,
          tags,
        ));
      await save();
    }

    // What to save: this computer's recording parts, and each call's Transcripts files.
    const recordings = deps.host ? await deps.host.recordings() : [];
    const made = new Map<number, CallFile[]>();
    for (const call of job.calls)
      made.set(call.startedAt, await deps.callFiles(session, call, title));
    job.files = planFiles(job, recordings, made);
    await save();

    for (const sub of ['Recordings', 'Transcripts'] as const) {
      const idField = sub === 'Recordings' ? 'recordingsId' : 'transcriptsId';
      if (job[idField] || !job.files.some((file) => file.folder === sub && !file.done)) continue;
      const tags: DriveTag[] = [
        { key: 'kiteSession', value: sessionTag },
        { key: 'kiteFolder', value: sub },
      ];
      job[idField] =
        (await deps.drive.find(job.folderId, tags, folder.driveId)) ??
        (await deps.drive.createFolder(sub, job.folderId, tags));
      await save();
    }

    for (const file of job.files) {
      if (file.done) continue;
      if (await deps.callActive()) return stopWith('paused');
      const parentId = file.folder === 'Recordings' ? job.recordingsId! : job.transcriptsId!;
      const fileTag: DriveTag = {
        key: 'kiteFile',
        value: await tagValue(`${job.sessionId}\n${file.key}`),
      };
      // Already in Drive (saved before this device lost track of it): never uploaded twice.
      if (!file.uploadUrl) {
        const existing = await deps.drive.find(parentId, [fileTag], folder.driveId);
        if (existing) {
          Object.assign(file, {
            done: true,
            driveFileId: existing,
            sent: Math.max(file.bytes, file.sent),
          });
          await save();
          continue;
        }
      }
      // A file the page makes (transcript, notes): no recording id. Recording files also know their
      // call since ADR-0073, so the call alone does not say which kind a file is.
      const pageMade = !file.recordingId && file.callStartedAt !== undefined;
      const blob = pageMade
        ? made
            .get(file.callStartedAt!)
            ?.find((made) => `call:${file.callStartedAt}:${made.kind}` === file.key)?.blob
        : undefined;
      if (file.recordingId && !deps.host) {
        // A recording on another computer: that computer's app saves it.
        continue;
      }
      if (pageMade && !blob) {
        // The call's data is no longer here (cleared): nothing to save for this file.
        Object.assign(file, { done: true, missing: true });
        await save();
        continue;
      }
      const outcome = await uploadOne(deps, file, parentId, fileTag, blob ?? null, save);
      if (outcome !== 'done') return outcome;
    }
  } catch (error) {
    if (error instanceof DriveApiError) {
      if (error.code === 'reconnect') return stopWith('waiting', 'reconnect');
      if (error.code === 'not_connected' || error.code === 'not_configured') {
        return stopWith('waiting', 'not-connected');
      }
      return stopWith(
        'error',
        error.status === 0 ? 'network' : 'failed',
        error.status === 0 || error.status >= 500,
      );
    }
    if (error instanceof DriveRequestError) {
      if (error.status === 0 || error.status >= 500 || error.status === 429) {
        return stopWith('error', 'network', true);
      }
      // The chosen folder is gone or no longer shared with Kite.
      if (error.status === 404) return stopWith('error', 'folder-gone');
      return stopWith('error', 'refused');
    }
    return stopWith('error', 'failed');
  }

  // A recording kept on another computer is left to that computer; the rest is done here.
  const pendingElsewhere = job.files.some((file) => !file.done);
  await save({
    state: 'done',
    reason: undefined,
    autoRetry: undefined,
    noticeShown: false,
    notified: false,
  });
  const saved = savedFiles(job);
  if (saved.length > 0 && !pendingElsewhere) {
    deps.notice({
      title: `${savedHeadline(saved)} — ${title}`,
      body: 'Open in Drive',
      url: `https://drive.google.com/drive/folders/${encodeURIComponent(job.folderId!)}`,
    });
  }
  await reportToServer(deps, job, session, title, save);
  return 'done';
}

/**
 * The files a job has in Drive, as the server's report lists them: name, subfolder, stable key, Drive
 * id, what it is and its part. Never content.
 *
 * @param job  The job.
 * @param call Only this call's files (ADR-0073), by its start; omit for all.
 * @returns The saved files.
 * Called from: processDriveJob(), reportToServer(), callReportDue(); tests
 */
export function savedFiles(
  job: Pick<DriveSessionJob, 'files' | 'calls'>,
  call?: number,
): DriveSavedFile[] {
  return job.files
    .filter((file) => file.done && !file.missing)
    .filter((file) => call === undefined || fileCall(job, file) === call)
    .map((file) => {
      const kind = /:(transcript-txt|transcript-pdf|notes-pdf)$/.exec(file.key)?.[1] as
        DriveFileKind | undefined;
      const part = file.part ?? Number(/Part (\d+)/.exec(file.name)?.[1] ?? 1);
      return {
        name: file.name,
        folder: file.folder,
        key: file.key,
        ...(file.driveFileId ? { fileId: file.driveFileId } : {}),
        ...(file.track
          ? { kind: (file.track === 'main' ? 'recording' : 'stereo') as DriveFileKind, part }
          : kind
            ? { kind }
            : {}),
      };
    });
}

/**
 * Whether the server should be told about one call now (ADR-0073: each call has its own email): it has
 * saved files the server has not heard of, or the job finished since the call's last report. A call
 * closed under its session's single email (before ADR-0073) never is.
 *
 * @param job  The job (its calls' flags settled, withCallFlags).
 * @param call The call.
 * @returns True when a report is due.
 * Called from: reportDue(), reportToServer(); tests
 */
export function callReportDue(job: DriveSessionJob, call: DriveCall): boolean {
  if (!job.folderId || (job.state !== 'done' && job.state !== 'error') || call.closed) return false;
  const saved = savedFiles(job, call.startedAt).length;
  return (
    saved > 0 && (saved > (call.reportedFiles ?? 0) || (job.state === 'done' && !call.notified))
  );
}

/**
 * Whether the server should be told about any of this job's calls now.
 *
 * @param job The job.
 * @returns True when a report is due.
 * Called from: runDriveQueue(); tests
 */
export function reportDue(job: DriveSessionJob): boolean {
  const settled = withCallFlags(job);
  return settled.calls.some((call) => callReportDue(settled, call));
}

/**
 * Reports what this device saved to the server, one report per call that is due (ADR-0073: each call of
 * a session, also one started again after the session ended, has its own email). The server merges
 * every device's reports for that call and sends its one email when everything expected is in (or after
 * 24 hours). Each report holds only that call's files and the recordings the account knows the call has,
 * so its email waits for a recording another computer is still uploading. A refusal is not retried (the
 * record is there, or the request is wrong); a lost connection is, at the next run.
 *
 * @param deps    The dependencies.
 * @param job     The job.
 * @param session The session.
 * @param title   Its title.
 * @param save    Saves the job.
 * @returns When done.
 * Called from: processDriveJob(), runDriveQueue()
 */
async function reportToServer(
  deps: UploaderDeps,
  job: DriveSessionJob,
  session: Session,
  title: string,
  save: (changes: Partial<DriveSessionJob>) => Promise<void>,
): Promise<void> {
  const folderId = job.folderId;
  if (!folderId) return;
  const settled = withCallFlags(job);
  const calls = settled.calls.map((call) => ({ ...call }));
  const due = calls.filter((call) => callReportDue(settled, call));
  if (due.length === 0) {
    // Only the flags changed (calls settled): keep them, so they are never worked out again.
    if (settled !== job) await save({ calls });
    return;
  }
  const known = await deps.expectedRecordings(job.sessionId);
  // In call order: the session's first record is its earliest reported call (the server keys it so).
  for (const call of due) {
    const files = savedFiles(settled, call.startedAt);
    const mark = async () => {
      call.reportedFiles = files.length;
      call.notified = job.state === 'done';
      // The job's own totals stay up to date for anything that still reads them.
      await save({
        calls,
        reportedFiles: savedFiles(settled).length,
        notified: calls.every((one) => one.closed || one.notified),
      });
    };
    try {
      await deps.api.notify({
        sessionId: job.sessionId,
        title: title.slice(0, 200),
        callStartedAt: call.startedAt,
        durationMs: Math.max(0, call.endedAt - call.startedAt),
        files: files.slice(0, MAX_SAVED_FILES),
        folderUrl: `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`,
        timeZone: deps.timeZone(),
        alsoNotify: session.driveAlsoNotify?.length ? session.driveAlsoNotify : null,
        // Only this call's recordings: another call's, or one never part of an upload, is not waited for.
        expectedRecordings: known
          .filter((recording) => inCall(call, recording.startedAt))
          .map(({ id, part, stereo }) => ({ id, part, stereo }))
          .slice(0, MAX_SAVED_FILES),
        goneRecordings: [
          ...new Set(
            job.files
              .filter(
                (file) =>
                  file.missing && file.recordingId && fileCall(job, file) === call.startedAt,
              )
              .map((file) => file.recordingId!),
          ),
        ],
        manualOnly: job.manualEmail === true,
      });
      await mark();
    } catch (error) {
      if (
        error instanceof DriveApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429
      ) {
        await mark();
        continue;
      }
      // A lost connection: the rest are tried at the next run.
      return;
    }
  }
}

/**
 * Uploads one file: opens an upload session when there is none (kept on the file, so a restart resumes),
 * then sends the bytes (the shell for a recording, the page for a file it made). A refused token is
 * fetched again, and a gone session is opened again, a few times at most.
 *
 * @param deps     The dependencies.
 * @param file     The file (changed in place; it is one of the job's files).
 * @param parentId Its subfolder.
 * @param tag      Its tag.
 * @param blob     The bytes for a page-made file; null for a recording.
 * @param save     Saves the job.
 * @returns 'done' to carry on with the next file, or how the job's turn ends.
 */
async function uploadOne(
  deps: UploaderDeps,
  file: DriveFileJob,
  parentId: string,
  tag: DriveTag,
  blob: Blob | null,
  save: (changes?: Partial<DriveSessionJob>) => Promise<void>,
): Promise<JobOutcome> {
  let fresh = false;
  for (let attempt = 0; attempt <= MAX_RESTARTS; attempt += 1) {
    if (!file.uploadUrl) {
      file.uploadUrl = await deps.drive.startUpload({
        name: file.name,
        parentId,
        mimeType: mimeOf(file.name),
        bytes: blob ? blob.size : file.bytes,
        tags: [tag],
      });
      file.sent = 0;
      await save();
    }
    const onProgress = (sent: number, total?: number) => {
      file.sent = sent;
      if (total) file.bytes = total;
      void save();
    };
    let result: DriveUploadResult;
    if (blob) {
      result = await deps.drive.uploadBlob(
        file.uploadUrl,
        blob,
        (sent) => onProgress(sent),
        deps.callActive,
      );
    } else {
      const token = await deps.api.token(fresh);
      result = await deps.host!.upload(
        {
          recordingId: file.recordingId!,
          track: file.track!,
          uploadUrl: file.uploadUrl,
          accessToken: token.accessToken,
        },
        (progress) => onProgress(progress.sent, progress.total),
      );
    }
    fresh = false;
    switch (result.status) {
      case 'done':
        Object.assign(file, {
          done: true,
          driveFileId: result.fileId,
          sent: result.bytes,
          bytes: result.bytes,
        });
        file.uploadUrl = undefined;
        await save();
        return 'done';
      case 'paused':
        file.sent = result.offset;
        await save({ state: 'paused' });
        return 'paused';
      case 'auth':
        file.sent = result.offset;
        fresh = true;
        continue;
      case 'expired':
        // The session is gone; nothing of it became a file, so a new one cannot make a copy.
        file.uploadUrl = undefined;
        continue;
      case 'missing':
        Object.assign(file, { done: true, missing: true, uploadUrl: undefined });
        await save();
        return 'done';
      case 'failed':
        await save({
          state: 'error',
          reason: result.retryable ? 'network' : 'refused',
          autoRetry: result.retryable || undefined,
        });
        return 'error';
    }
  }
  await save({ state: 'error', reason: 'failed' });
  return 'error';
}

/** How a run ended. */
export type RunOutcome = 'idle' | 'call' | 'waiting' | 'busy';

/** How long an error that may clear by itself waits before it is tried again, ms. */
export const AUTO_RETRY_MS = 2 * 60_000;

/**
 * Works through the queue: every queued job in turn, until none is left, a call starts, or Drive needs
 * the person. Errors that may clear by itself (a lost connection) are queued again after AUTO_RETRY_MS;
 * finished jobs whose server notification did not get through are sent again.
 *
 * @param deps The dependencies.
 * @returns Why it stopped.
 * Called from: features/drive/DriveUploader.tsx (after a call, at start, on a timer, when back online); tests
 */
export async function runDriveQueue(deps: UploaderDeps): Promise<RunOutcome> {
  if (await deps.callActive()) return 'call';
  const local = deps.host ? await deps.host.recordings().catch(() => []) : [];
  for (const listed of await deps.jobs.list()) {
    let job = listed;
    // A job from before the combined email (1.6.0): told once more, with Drive ids, but never emailed
    // automatically ("Send email" in Settings).
    if (job.reportedFiles === undefined) {
      await deps.jobs.put(
        withCallFlags({ ...job, reportedFiles: 0, manualEmail: job.notified || undefined }),
      );
      continue;
    }
    // ADR-0073: calls queued before each call had its own email get their flags now, before any new
    // file of theirs is saved, so a call already emailed is never emailed again.
    const settled = withCallFlags(job);
    if (settled !== job) {
      await deps.jobs.put(settled);
      job = settled;
    }
    // A finished session with a recording on this computer it has not saved (recorded before this
    // app could upload, or finalised after the job finished): queued again for it. Nothing saved is
    // uploaded twice.
    if (job.state === 'done' && local.length > 0) {
      if (planFiles(job, local, new Map()).length > job.files.length) {
        await deps.jobs.put({ ...job, state: 'queued', updatedAt: deps.now() });
        continue;
      }
    }
    if (job.state === 'error' && job.autoRetry && deps.now() - job.updatedAt >= AUTO_RETRY_MS) {
      await deps.jobs.put({
        ...job,
        state: 'queued',
        reason: undefined,
        autoRetry: undefined,
        updatedAt: deps.now(),
      });
    }
  }
  // Read again: the errors just queued again count as moving.
  const all = await deps.jobs.list();
  // Only jobs that can move need the server: queued or cut off, waiting for the person (they may
  // have fixed it), or finished without the server's notification.
  const moving = all.filter(
    (job) =>
      job.state === 'queued' ||
      job.state === 'uploading' ||
      job.state === 'paused' ||
      job.state === 'waiting' ||
      reportDue(job),
  );
  if (moving.length === 0) return 'idle';
  let status: DriveStatusResponse;
  try {
    status = await deps.api.status();
  } catch {
    return 'busy';
  }
  // Drive works again (reconnected, folder picked, switched on): the waiting jobs carry on.
  if (!waitingReason(status)) {
    for (const job of moving.filter((j) => j.state === 'waiting')) {
      await deps.jobs.put({ ...job, state: 'queued', reason: undefined, updatedAt: deps.now() });
    }
  }
  // Reports still due: a finish the server did not hear of (offline at the time), or files saved before
  // an error (so a session that waits 24 hours for its recording has a record to send from).
  for (const job of all.filter(reportDue)) {
    const session = await deps.session(job.sessionId);
    if (!session) continue;
    let current = job;
    await reportToServer(deps, job, session, sessionTitle(session), async (changes) => {
      current = { ...current, ...changes };
      await deps.jobs.put(current);
    });
  }
  for (;;) {
    if (await deps.callActive()) return 'call';
    const job = await deps.jobs.next();
    if (!job) return 'idle';
    const outcome = await processDriveJob(deps, job, status);
    if (outcome === 'paused') return 'call';
    if (outcome === 'waiting') {
      // Every other queued job waits for the same reason; mark them so the cards say so. A job that
      // pauses (a call started) stays active, so the marking stops there.
      for (let next = await deps.jobs.next(); next; next = await deps.jobs.next()) {
        if ((await processDriveJob(deps, next, status)) === 'paused') return 'call';
      }
      return 'waiting';
    }
  }
}

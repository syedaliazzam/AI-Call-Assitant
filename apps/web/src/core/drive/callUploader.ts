/**
 * File: apps/web/src/core/drive/callUploader.ts
 * Purpose: Saves one call to Google Drive (ADR-0077: one job per call). Its files go in this order:
 *          transcript TXT, transcript PDF, notes PDF, then the recording parts (main file, then stereo
 *          file, by part). Each file is tried on its own: one failing never stops the others or another
 *          call, and is tried again later. The files keep the keys the older per-session job used
 *          ('call:<start>:…', 'rec:<id>:…'), and the server finds a file already in Drive by its tag, so
 *          nothing is ever uploaded twice. The server is told (for the call's emails, ADR-0077 rule): once
 *          the Transcripts files are in (email 1, "Call saved"), and again when more files are saved or the
 *          job finishes (email 2, "Recording saved"). The call record shows the job's state to every device.
 * Used by: src/core/drive/uploader.ts (runDriveQueue), tests
 * Depends on: @kite/shared, src/core/drive/{uploader,names,callFiles,api,reasons}.ts,
 *             src/core/review/calls.ts (CallView), src/core/storage/types.ts
 * Architecture: ADR-0077 (builds on ADR-0072, ADR-0073, ADR-0074)
 *
 * Never logs: names, titles and file contents stay out of the console; ids and counts only.
 */
import {
  MAX_SAVED_FILES,
  savedHeadline,
  type DesktopNotice,
  type DriveFileKind,
  type DriveSavedFile,
  type DriveStatusResponse,
  type LocalRecording,
} from '@kite/shared';
import type { CallView } from '../review/calls';
import type { CallDriveState, DriveCallJob, DriveFileJob, Session } from '../storage/types';
import { DriveApiError } from './api';
import type { CallFile } from './callFiles';
import { callFileDriveName, recordingDriveName, sessionFolderName, sessionTitle } from './names';
import type { DriveReason } from './reasons';
import { uploadRecordingFile, waitingReason, type JobOutcome, type UploaderDeps } from './uploader';

/** A recording counts as a legacy call's when it started this long before the call's start, ms. */
const RECORDING_SLACK_MS = 60_000;

/** How many times one file may fail before it waits for Retry (it is skipped until then). */
export const MAX_FILE_FAILURES = 5;

/** The order of a call's Transcripts files. */
const CALL_FILE_ORDER: readonly string[] = ['transcript-txt', 'transcript-pdf', 'notes-pdf'];

/** What the per-call uploader needs, on top of the routes and the shell. */
export interface CallJobDeps {
  /** The jobs. */
  jobs: {
    /** The next job to work on. */
    next(): Promise<DriveCallJob | null>;
    /** Every job. */
    list(): Promise<DriveCallJob[]>;
    /**
     * Saves a job whole.
     * @param job The job.
     */
    put(job: DriveCallJob): Promise<void>;
    /**
     * Forgets a job.
     * @param callId Its call.
     */
    remove(callId: string): Promise<void>;
  };
  /**
   * The call's lines, answers, notes and recording records.
   * @param job The job.
   */
  call(job: DriveCallJob): Promise<CallView | null>;
  /**
   * The call's Transcripts files.
   * @param session The session.
   * @param call    The call.
   * @param title   The session's title.
   */
  files(session: Session, call: CallView, title: string): Promise<CallFile[]>;
  /**
   * Shows the job's state to every device (the call record; nothing for a legacy call).
   * @param job   The job.
   * @param state Its state.
   */
  callState(
    job: DriveCallJob,
    state: { state: CallDriveState; reason?: string; folderId?: string },
  ): Promise<void>;
}

/** The uploader's dependencies with the per-call part. */
export type CallUploaderDeps = UploaderDeps & {
  /** The per-call part. */
  calls: CallJobDeps;
};

/**
 * Whether a recording belongs to a call's job.
 *
 * @param job       The job.
 * @param recording The recording (this computer's index, or the account's record).
 * @returns True when it does.
 * Called from: planCallFiles(), reportCall(), runCallJobs(); tests
 */
export function recordingOfCall(
  job: Pick<DriveCallJob, 'callId' | 'sessionId' | 'startedAt' | 'endedAt' | 'recordingMatch'>,
  recording: { sessionId?: string; meetingId?: string; startedAt: number },
): boolean {
  if (recording.sessionId !== undefined && recording.sessionId !== job.sessionId) return false;
  if (job.recordingMatch === 'meeting') return recording.meetingId === job.callId;
  return (
    recording.startedAt >= job.startedAt - RECORDING_SLACK_MS && recording.startedAt <= job.endedAt
  );
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
 * A file's place in the upload order: Transcripts files first (TXT, PDF, notes), then recordings by part,
 * each main file before its stereo file.
 *
 * @param file The file.
 * @returns A sort key.
 */
function orderOf(file: DriveFileJob): number {
  if (!file.recordingId) {
    const kind = /:([a-z-]+)$/.exec(file.key)?.[1] ?? '';
    const at = CALL_FILE_ORDER.indexOf(kind);
    return at < 0 ? 9 : at;
  }
  return 10 + (file.part ?? 1) * 2 + (file.track === 'stereo' ? 1 : 0);
}

/**
 * The files a call's job should hold now: what it had (with its progress), plus any Transcripts file or
 * recording part found since, in upload order. Keys are stable, so a file is never listed twice.
 *
 * @param job        The job.
 * @param recordings This computer's recordings (none in a browser).
 * @param callFiles  The call's Transcripts files.
 * @returns The files, in upload order.
 * Called from: processCallJob(), runCallJobs(); tests
 */
export function planCallFiles(
  job: DriveCallJob,
  recordings: readonly LocalRecording[],
  callFiles: readonly Pick<CallFile, 'kind' | 'blob'>[],
): DriveFileJob[] {
  const files = [...job.files];
  const have = new Set(files.map((file) => file.key));
  const add = (file: DriveFileJob) => {
    if (have.has(file.key)) return;
    have.add(file.key);
    files.push(file);
  };
  for (const file of callFiles) {
    add({
      key: `call:${job.startedAt}:${file.kind}`,
      folder: 'Transcripts',
      name: callFileDriveName(job.startedAt, file.kind),
      callStartedAt: job.startedAt,
      bytes: file.blob.size,
      sent: 0,
      done: false,
    });
  }
  const parts = recordings
    .filter(
      (recording) =>
        (recording.status === 'complete' || recording.status === 'recovered') &&
        recordingOfCall(job, recording),
    )
    .sort((a, b) => a.part - b.part || a.startedAt - b.startedAt);
  for (const recording of parts) {
    add({
      key: `rec:${recording.id}:main`,
      folder: 'Recordings',
      name: recordingDriveName(
        job.startedAt,
        recording.part,
        extensionOf(recording.fileName),
        false,
      ),
      recordingId: recording.id,
      track: 'main',
      part: recording.part,
      callStartedAt: job.startedAt,
      bytes: recording.bytes,
      sent: 0,
      done: false,
    });
    if (recording.hasStereo) {
      add({
        key: `rec:${recording.id}:stereo`,
        folder: 'Recordings',
        name: recordingDriveName(job.startedAt, recording.part, 'webm', true),
        recordingId: recording.id,
        track: 'stereo',
        part: recording.part,
        callStartedAt: job.startedAt,
        bytes: 0,
        sent: 0,
        done: false,
      });
    }
  }
  return files.sort((a, b) => orderOf(a) - orderOf(b));
}

/**
 * The files a call's job has in Drive, as the server's report lists them. Never content.
 *
 * @param job The job.
 * @returns The saved files.
 * Called from: reportCall(), processCallJob(); tests
 */
export function callSavedFiles(job: Pick<DriveCallJob, 'files'>): DriveSavedFile[] {
  return job.files
    .filter((file) => file.done && !file.missing)
    .map((file) => {
      const kind = /:(transcript-txt|transcript-pdf|notes-pdf)$/.exec(file.key)?.[1] as
        DriveFileKind | undefined;
      return {
        name: file.name,
        folder: file.folder,
        key: file.key,
        ...(file.driveFileId ? { fileId: file.driveFileId } : {}),
        ...(file.track
          ? {
              kind: (file.track === 'main' ? 'recording' : 'stereo') as DriveFileKind,
              part: file.part ?? 1,
            }
          : kind
            ? { kind }
            : {}),
      };
    });
}

/**
 * Whether every Transcripts file of the call is settled (in Drive, or with nothing to save): email 1 may go.
 *
 * @param job The job.
 * @returns True when settled.
 * Called from: processCallJob(), callReportDueFor(); tests
 */
export function callFilesSettled(job: Pick<DriveCallJob, 'files'>): boolean {
  return job.files.filter((file) => !file.recordingId).every((file) => file.done);
}

/**
 * Whether the server should be told about the call now: email 1's report (Transcripts settled, not told
 * yet), more saved files than it has heard of, or a finish it has not heard of.
 *
 * @param job The job.
 * @returns True when a report is due.
 * Called from: processCallJob(), runCallJobs(); tests
 */
export function callReportDueFor(job: DriveCallJob): boolean {
  if (!job.folderId) return false;
  const saved = callSavedFiles(job).length;
  if (!job.callFilesReported && callFilesSettled(job) && job.files.length > 0) return true;
  if (job.state !== 'done' && job.state !== 'error') return false;
  return saved > job.reportedFiles || (job.state === 'done' && !job.notified);
}

/** Why a file failed, for the job (the first failure wins). */
interface FileFailure {
  /** Its reason code (core/drive/reasons.ts). */
  reason: DriveReason;
  /** True when trying again later may work. */
  retryable: boolean;
}

/**
 * Tells the server what this call has in Drive (POST /api/drive/notify). A call queued when it ended uses
 * the two-step email rule (ADR-0077); one from "Upload N earlier calls" waits for "Send email" by hand
 * (never emailed by itself). A refusal is not retried (the record is there, or the request is wrong); a
 * lost connection is, at the next run.
 *
 * @param deps    The dependencies.
 * @param job     The job (changed in place: its report flags).
 * @param session The session.
 * @param title   Its title.
 * @param save    Saves the job.
 * @returns When done.
 * Called from: processCallJob(), runCallJobs()
 */
async function reportCall(
  deps: CallUploaderDeps,
  job: DriveCallJob,
  session: Session,
  title: string,
  save: () => Promise<void>,
): Promise<void> {
  if (!job.folderId) return;
  const files = callSavedFiles(job);
  const transcriptsIn = callFilesSettled(job);
  const known = (await deps.expectedRecordings(job.sessionId)).filter((recording) =>
    recordingOfCall(job, { meetingId: recording.meetingId, startedAt: recording.startedAt }),
  );
  const folderUrl = `https://drive.google.com/drive/folders/${encodeURIComponent(job.folderId)}`;
  try {
    await deps.api.notify({
      sessionId: job.sessionId,
      title: title.slice(0, 200),
      callStartedAt: job.startedAt,
      durationMs: Math.max(0, job.endedAt - job.startedAt),
      files: files.slice(0, MAX_SAVED_FILES),
      folderUrl,
      timeZone: deps.timeZone(),
      alsoNotify: session.driveAlsoNotify?.length ? session.driveAlsoNotify : null,
      expectedRecordings: known
        .map(({ id, part, stereo, deviceName }) => ({
          id,
          part,
          stereo,
          ...(deviceName ? { deviceName: deviceName.slice(0, 80) } : {}),
        }))
        .slice(0, MAX_SAVED_FILES),
      goneRecordings: [
        ...new Set(
          job.files.filter((file) => file.missing && file.recordingId).map((f) => f.recordingId!),
        ),
      ],
      // ADR-0077: a call that ended is emailed by the two-step rule; an earlier call only by hand.
      manualOnly: job.origin === 'earlier',
      ...(job.origin === 'call'
        ? {
            emailRule: 'two-step' as const,
            callFilesSaved: transcriptsIn,
            ...(job.recordingsId
              ? {
                  recordingsFolderUrl: `https://drive.google.com/drive/folders/${encodeURIComponent(job.recordingsId)}`,
                }
              : {}),
          }
        : {}),
    });
  } catch (error) {
    const refused =
      error instanceof DriveApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429;
    if (!refused) return;
  }
  job.callFilesReported = job.callFilesReported || transcriptsIn;
  job.reportedFiles = files.length;
  job.notified = job.state === 'done';
  await save();
}

/**
 * Runs one call job's turn: the session folder, the files (Transcripts first, then recordings), each on its
 * own, the reports, and the "saved" notice when everything is in.
 *
 * @param deps   The dependencies.
 * @param start  The job as read.
 * @param status The connection's status (read once per run).
 * @returns How the turn ended.
 * Called from: runCallJobs(); tests
 */
export async function processCallJob(
  deps: CallUploaderDeps,
  start: DriveCallJob,
  status: DriveStatusResponse,
): Promise<JobOutcome> {
  let job: DriveCallJob = { ...start, files: start.files.map((file) => ({ ...file })) };
  const save = async (changes: Partial<DriveCallJob> = {}) => {
    job = { ...job, ...changes, updatedAt: deps.now() };
    await deps.calls.jobs.put(job);
  };
  const show = (state: CallDriveState, reason?: string) =>
    deps.calls
      .callState(job, {
        state,
        ...(reason ? { reason } : {}),
        ...(job.folderId ? { folderId: job.folderId } : {}),
      })
      .catch(() => undefined);
  const stopWith = async (
    state: 'waiting' | 'error' | 'paused',
    reason?: DriveReason,
    autoRetry = false,
  ): Promise<JobOutcome> => {
    await save({ state, reason, autoRetry: autoRetry || undefined });
    await show(state, reason);
    return state;
  };

  const waiting = waitingReason(status);
  if (waiting) return stopWith('waiting', waiting);
  const folder = status.folder!;
  if (await deps.callActive()) return stopWith('paused');

  const session = await deps.session(job.sessionId);
  const call = session ? await deps.calls.call(job) : null;
  if (!session || !call) {
    // The session (or the call's data) was deleted: nothing more to save; what is in Drive stays.
    await deps.calls.jobs.remove(job.callId);
    return 'gone';
  }
  const title = sessionTitle(session);

  // A different folder chosen in Settings: this call starts again in the new one.
  if (job.parentId && job.parentId !== folder.id) {
    job.files = job.files.map((file) => ({
      ...file,
      done: false,
      missing: undefined,
      sent: 0,
      uploadUrl: undefined,
      ticket: undefined,
      driveFileId: undefined,
      error: undefined,
      failures: undefined,
    }));
    job.folderId = undefined;
    job.recordingsId = undefined;
    job.transcriptsId = undefined;
    job.callFilesReported = false;
    job.reportedFiles = 0;
    job.notified = false;
  }
  await save({ state: 'uploading', reason: undefined, autoRetry: undefined, parentId: folder.id });
  await show('uploading');

  let failure: FileFailure | null = null;
  try {
    if (!job.folderId || !job.recordingsId || !job.transcriptsId) {
      const folders = await deps.api.sessionFolder({
        sessionId: job.sessionId,
        name: sessionFolderName(session, call.startedAt),
      });
      job.folderId = folders.folderId;
      job.recordingsId = folders.recordingsId;
      job.transcriptsId = folders.transcriptsId;
      await save();
    }
    const recordings = deps.host ? await deps.host.recordings() : [];
    const made = await deps.calls.files(session, call, title);
    job.files = planCallFiles(job, recordings, made);
    await save();

    let needsUpdate = false;
    let reportedTranscripts = job.callFilesReported;
    for (const file of job.files) {
      if (file.done) continue;
      // A file that failed too often waits for Retry; the rest carry on.
      if ((file.failures ?? 0) >= MAX_FILE_FAILURES) {
        failure ??= {
          reason: (file.error as DriveReason | undefined) ?? 'failed',
          retryable: false,
        };
        continue;
      }
      if (await deps.callActive()) return stopWith('paused');
      // Email 1 may go as soon as the Transcripts files are in, before any recording starts uploading.
      if (file.recordingId && !reportedTranscripts && callFilesSettled(job)) {
        reportedTranscripts = true;
        await reportCall(deps, job, session, title, () => save());
      }
      if (file.recordingId) {
        // A recording on another computer: that computer's app saves it.
        if (!deps.host) continue;
        if (!deps.host.fileSize) {
          needsUpdate = true;
          continue;
        }
        try {
          const outcome = await uploadRecordingFile(deps, job.sessionId, file, () => save());
          if (outcome.status === 'paused') return stopWith('paused');
          if (outcome.status === 'failed') {
            failure ??= { reason: outcome.reason, retryable: outcome.retryable };
            Object.assign(file, { error: outcome.reason, failures: (file.failures ?? 0) + 1 });
            await save();
          } else {
            Object.assign(file, { error: undefined });
          }
        } catch (error) {
          if (isJobWide(error)) throw error;
          failure ??= fileFailureOf(error);
          Object.assign(file, { error: failure.reason, failures: (file.failures ?? 0) + 1 });
          await save();
        }
        continue;
      }
      // A file the page makes (transcript, notes): sent to the server, which uploads it.
      const blob = made.find((one) => `call:${job.startedAt}:${one.kind}` === file.key)?.blob;
      if (!blob) {
        // The call's data is no longer here (cleared): nothing to save for this file.
        Object.assign(file, { done: true, missing: true });
        await save();
        continue;
      }
      try {
        const saved = await deps.api.uploadFile({
          sessionId: job.sessionId,
          key: file.key,
          name: file.name,
          blob,
        });
        Object.assign(file, {
          done: true,
          driveFileId: saved.fileId,
          bytes: blob.size,
          sent: blob.size,
          error: undefined,
        });
      } catch (error) {
        if (isJobWide(error)) throw error;
        if (error instanceof DriveApiError && error.code === 'too_large') {
          // Too large to go through the server: skipped, so the rest of the call still saves.
          Object.assign(file, { done: true, missing: true });
        } else {
          const one = fileFailureOf(error);
          failure ??= one;
          Object.assign(file, { error: one.reason, failures: (file.failures ?? 0) + 1 });
        }
      }
      await save();
    }
    if (!reportedTranscripts && callFilesSettled(job)) {
      await reportCall(deps, job, session, title, () => save());
    }
    if (needsUpdate) return stopWith('waiting', 'update-desktop');
  } catch (error) {
    if (error instanceof DriveApiError) {
      if (error.code === 'reconnect') return stopWith('waiting', 'reconnect');
      if (error.code === 'not_connected' || error.code === 'not_configured') {
        return stopWith('waiting', 'not-connected');
      }
      if (error.code === 'no_folder') return stopWith('waiting', 'no-folder');
      if (error.code === 'folder_gone') return stopWith('error', 'folder-gone');
      if (error.code === 'no_session_folder') {
        job.folderId = undefined;
        job.recordingsId = undefined;
        job.transcriptsId = undefined;
        return stopWith('error', 'network', true);
      }
      return stopWith(
        'error',
        error.status === 0 ? 'network' : 'failed',
        error.status === 0 || error.status >= 500 || error.status === 429,
      );
    }
    return stopWith('error', 'failed');
  }

  if (failure) {
    // Some files failed: the others are saved; the failed ones are tried again (automatically when it may
    // clear by itself, else with Retry). The server hears of what is in.
    await save({
      state: 'error',
      reason: failure.reason,
      autoRetry: failure.retryable || undefined,
    });
    await show('error', failure.reason);
    if (callReportDueFor(job)) await reportCall(deps, job, session, title, () => save());
    return 'error';
  }
  // A recording kept on another computer is left to that computer; the rest is done here.
  const pendingElsewhere = job.files.some((file) => !file.done);
  await save({ state: 'done', reason: undefined, autoRetry: undefined, noticeShown: false });
  await show('done');
  const saved = callSavedFiles(job);
  if (saved.length > 0 && !pendingElsewhere) {
    deps.notice({
      title: `${savedHeadline(saved)} — ${title}`,
      body: 'Open in Drive',
      url: `https://drive.google.com/drive/folders/${encodeURIComponent(job.folderId!)}`,
    } satisfies DesktopNotice);
  }
  if (callReportDueFor(job)) await reportCall(deps, job, session, title, () => save());
  return 'done';
}

/**
 * Whether an error from Kite's routes stops the whole job (the connection, the folder), rather than one file.
 *
 * @param error The error.
 * @returns True for a job-wide error.
 */
function isJobWide(error: unknown): boolean {
  if (!(error instanceof DriveApiError)) return false;
  return (
    error.code === 'reconnect' ||
    error.code === 'not_connected' ||
    error.code === 'not_configured' ||
    error.code === 'no_folder' ||
    error.code === 'folder_gone' ||
    error.code === 'no_session_folder'
  );
}

/**
 * One file's failure, from what was thrown.
 *
 * @param error The error.
 * @returns Its reason code, and whether it may clear by itself.
 */
function fileFailureOf(error: unknown): FileFailure {
  if (error instanceof DriveApiError) {
    const retryable = error.status === 0 || error.status >= 500 || error.status === 429;
    return { reason: error.status === 0 ? 'network' : 'failed', retryable };
  }
  return { reason: 'failed', retryable: false };
}

/** How long an error that may clear by itself waits before it is tried again, ms. */
export const CALL_RETRY_MS = 2 * 60_000;

/**
 * The call jobs' part of a queue run: errors that may clear by themselves are queued again after a while,
 * a finished call with a recording finalised since is queued again for it, reports still due are sent,
 * then every queued call job is worked on in turn, oldest first.
 *
 * @param deps   The dependencies.
 * @param status The connection's status.
 * @returns 'call' when a call started, 'waiting' when Drive needs the person, else 'idle'.
 * Called from: runDriveQueue() in uploader.ts; tests
 */
export async function runCallJobs(
  deps: CallUploaderDeps,
  status: DriveStatusResponse,
): Promise<'idle' | 'call' | 'waiting'> {
  const local = deps.host ? await deps.host.recordings().catch(() => []) : [];
  for (const job of await deps.calls.jobs.list()) {
    if (job.state === 'done' && local.length > 0) {
      // A recording finalised after the job finished (or one this app could not upload before).
      if (planCallFiles(job, local, []).length > job.files.length) {
        await deps.calls.jobs.put({ ...job, state: 'queued', updatedAt: deps.now() });
        continue;
      }
    }
    if (job.state === 'error' && job.autoRetry && deps.now() - job.updatedAt >= CALL_RETRY_MS) {
      await deps.calls.jobs.put({
        ...job,
        state: 'queued',
        reason: undefined,
        autoRetry: undefined,
        updatedAt: deps.now(),
      });
    } else if (job.state === 'waiting' && !waitingReason(status)) {
      // Drive works again (reconnected, folder picked, switched on); a job waiting for desktop 1.6.2 stays.
      if (job.reason !== 'update-desktop' || deps.host?.fileSize) {
        await deps.calls.jobs.put({
          ...job,
          state: 'queued',
          reason: undefined,
          updatedAt: deps.now(),
        });
      }
    }
  }
  // Reports still due (a finish the server did not hear of, offline at the time).
  for (const job of (await deps.calls.jobs.list()).filter(callReportDueFor)) {
    const session = await deps.session(job.sessionId);
    if (!session) continue;
    let current = job;
    await reportCall(deps, current, session, sessionTitle(session), async () => {
      current = { ...current, updatedAt: deps.now() };
      await deps.calls.jobs.put(current);
    });
  }
  for (;;) {
    if (await deps.callActive()) return 'call';
    const job = await deps.calls.jobs.next();
    if (!job) return 'idle';
    const outcome = await processCallJob(deps, job, status);
    if (outcome === 'paused') return 'call';
    if (outcome === 'waiting') {
      // Every other queued call job waits for the same reason; mark them so the cards say so.
      for (let next = await deps.calls.jobs.next(); next; next = await deps.calls.jobs.next()) {
        if ((await processCallJob(deps, next, status)) === 'paused') return 'call';
      }
      return 'waiting';
    }
  }
}

/**
 * Whether any call job can move (so the queue run asks the server for the status).
 *
 * @param jobs The jobs.
 * @returns True when one is queued, cut off, waiting, failed with an automatic retry, or has a report due.
 * Called from: runDriveQueue() in uploader.ts; tests
 */
export function callJobsMoving(jobs: readonly DriveCallJob[]): boolean {
  return jobs.some(
    (job) =>
      job.state === 'queued' ||
      job.state === 'uploading' ||
      job.state === 'paused' ||
      job.state === 'waiting' ||
      (job.state === 'error' && job.autoRetry === true) ||
      callReportDueFor(job),
  );
}

/**
 * Tests for apps/web/src/core/drive/callUploader.ts (ADR-0077: one Google Drive job per call), through
 * runDriveQueue() in uploader.ts, over a fake of Kite's server-side Drive routes (never a Google token), a
 * fake desktop shell and in-memory job stores:
 * - order: transcript TXT, transcript PDF, notes PDF, then the recording (main, then stereo);
 * - email 1's report goes once the Transcripts files are in, before any recording uploads; a later report
 *   when the recording is in; a call from "Upload earlier calls" is reported "manual only", no rule;
 * - each file on its own: a failing transcript PDF or recording file never stops the others; the next run
 *   uploads only what failed; nothing is uploaded twice (existing keys, the server's tags);
 * - recordings match their call by meeting id (a call record) or by time (a call made before records);
 * - the call record shows the job's state.
 * All values are invented; no real Google, shell or server is used.
 */
import type {
  DriveNotifyRequest,
  DriveStatusResponse,
  DriveUploadRequest,
  DriveUploadResult,
  LocalRecording,
} from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { DriveApiError } from '@/core/drive/api';
import type { CallFile } from '@/core/drive/callFiles';
import { planCallFiles, recordingOfCall, type CallJobDeps } from '@/core/drive/callUploader';
import { runDriveQueue, type UploaderDeps } from '@/core/drive/uploader';
import type { CallView } from '@/core/review/calls';
import type { CallDriveState, DriveCallJob, Session } from '@/core/storage/types';

/** The session. */
const SID = '11111111-1111-4111-8111-111111111111';

/** The call record's id. */
const CALL_ID = '44444444-4444-4444-8444-444444444444';

/** The call: 13 Nov 2026 00:49–01:06 local time. */
const START = new Date(2026, 10, 13, 0, 49, 38).getTime();
const END = new Date(2026, 10, 13, 1, 6, 8).getTime();

/** A connected status with a folder. */
const CONNECTED: DriveStatusResponse = {
  configured: true,
  status: 'connected',
  folder: {
    id: 'ROOT',
    name: 'Team calls',
    driveId: null,
    url: 'https://drive.google.com/drive/folders/ROOT',
  },
  admin: false,
  account: null,
  saveEnabled: true,
  email: { configured: true, enabled: true, alsoNotify: [] },
};

/** The session. */
const SESSION = {
  id: SID,
  type: 'interview',
  company: 'Acme',
  role: 'Backend Engineer',
  saveTranscript: true,
} as Session;

/** The call's recording part on this computer (its meeting is the call). */
const RECORDING: LocalRecording = {
  id: '22222222-2222-4222-8222-222222222222',
  sessionId: SID,
  meetingId: CALL_ID,
  part: 1,
  kind: 'screen',
  startedAt: START + 40_000,
  durationMs: 557_000,
  bytes: 1_000,
  fileName: 'Paramount AI 2026-11-13 00-50-21.mkv',
  hasStereo: true,
  status: 'complete',
};

/** A job as queued. */
const JOB: DriveCallJob = {
  callId: CALL_ID,
  sessionId: SID,
  startedAt: START,
  endedAt: END,
  recordingMatch: 'meeting',
  origin: 'call',
  files: [],
  state: 'queued',
  callFilesReported: false,
  reportedFiles: 0,
  notified: false,
  noticeShown: false,
  queuedAt: END,
  updatedAt: END,
};

/** The call's Transcripts files. */
const CALL_FILES: CallFile[] = [
  { kind: 'transcript-txt', blob: new Blob(['lines']) },
  { kind: 'transcript-pdf', blob: new Blob(['%PDF']) },
  { kind: 'notes-pdf', blob: new Blob(['%PDF notes']) },
];

/** Options for one test's world. */
interface WorldOptions {
  /** Keys whose small upload fails, with how (once each, or always). */
  failSmall?: Map<string, { status: number; always?: boolean }>;
  /** Results the shell gives, in order, before it uploads normally. */
  hostScript?: ((request: DriveUploadRequest) => DriveUploadResult)[];
  /** The job (default: a call that ended). */
  job?: DriveCallJob;
  /** Recordings on this computer. */
  recordings?: LocalRecording[];
  /** Keys already in Drive (uploaded before). */
  existing?: string[];
}

/**
 * A world: a fake of Kite's Drive routes over a fake company Drive, a shell, the job stores.
 * @param options What differs.
 * @returns The deps and what to inspect.
 */
function world(options: WorldOptions = {}) {
  const order: string[] = [];
  const reports: DriveNotifyRequest[] = [];
  const states: CallDriveState[] = [];
  const inDrive = new Map<string, string>(
    (options.existing ?? []).map((key, i) => [key, `old-${i}`]),
  );
  const counts = { small: 0, started: 0 };
  const uploads = new Map<string, string>();
  let n = 0;
  const jobs = new Map<string, DriveCallJob>([[CALL_ID, { ...(options.job ?? JOB) }]]);
  const script = [...(options.hostScript ?? [])];
  const failSmall = options.failSmall ?? new Map();
  const view = {
    id: CALL_ID,
    startedAt: START,
    endedAt: END,
    lines: [],
    answers: [],
    notes: null,
    recordings: [],
  } as unknown as CallView;
  const calls: CallJobDeps = {
    jobs: {
      next: async () =>
        [...jobs.values()]
          .filter((job) => ['queued', 'uploading', 'paused'].includes(job.state))
          .sort((a, b) => a.queuedAt - b.queuedAt)[0] ?? null,
      list: async () => [...jobs.values()],
      put: async (job) => {
        jobs.set(job.callId, { ...job, files: job.files.map((file) => ({ ...file })) });
      },
      remove: async (id) => {
        jobs.delete(id);
      },
    },
    call: async () => view,
    files: async () => CALL_FILES,
    callState: async (_job, drive) => {
      if (states.at(-1) !== drive.state) states.push(drive.state);
    },
  };
  const deps: UploaderDeps = {
    api: {
      status: async () => CONNECTED,
      notify: async (request) => {
        reports.push(request);
        return { status: 'collecting' };
      },
      sessionFolder: async () => ({
        folderId: 'SESSIONF',
        recordingsId: 'RECF',
        transcriptsId: 'TRANSF',
      }),
      async startUpload({ key }) {
        const known = inDrive.get(key);
        if (known) return { status: 'exists', fileId: known };
        counts.started += 1;
        const url = `https://upload.example/${++n}`;
        uploads.set(url, key);
        return { status: 'started', uploadUrl: url, ticket: `ticket-${n}` };
      },
      uploadOffset: async () => ({ state: 'expired' }),
      completeUpload: async ({ fileId }) => ({ fileId }),
      async uploadFile({ key }) {
        const fail = failSmall.get(key);
        if (fail) {
          if (!fail.always) failSmall.delete(key);
          throw new DriveApiError(fail.status, 'failed', 'Failed');
        }
        const known = inDrive.get(key);
        if (known) return { fileId: known };
        counts.small += 1;
        order.push(key);
        const id = `file-${++n}`;
        inDrive.set(key, id);
        return { fileId: id };
      },
    },
    host: {
      recordings: async () => options.recordings ?? [RECORDING],
      fileSize: async () => 500,
      async upload(request) {
        const key = uploads.get(request.uploadUrl)!;
        const next = script.shift();
        if (next) return next(request);
        order.push(key);
        const id = `file-${++n}`;
        inDrive.set(key, id);
        return { status: 'done', fileId: id, bytes: 500 };
      },
    },
    jobs: {
      next: async () => null,
      list: async () => [],
      put: async () => undefined,
      remove: async () => undefined,
    },
    session: async () => SESSION,
    callFiles: async () => [],
    callActive: async () => false,
    notice: () => undefined,
    now: () => END + 60_000,
    timeZone: () => 'UTC',
    expectedRecordings: async () => [
      {
        id: RECORDING.id,
        part: 1,
        stereo: true,
        startedAt: RECORDING.startedAt,
        meetingId: CALL_ID,
        deviceName: 'Office laptop',
      },
    ],
    calls,
  };
  return { deps, order, reports, states, jobs, counts, inDrive };
}

describe('per-call Drive upload (ADR-0077)', () => {
  it('uploads transcript TXT, PDF, notes PDF, then the recording; email 1 is reported first', async () => {
    const w = world();
    expect(await runDriveQueue(w.deps)).toBe('idle');
    expect(w.order).toEqual([
      `call:${START}:transcript-txt`,
      `call:${START}:transcript-pdf`,
      `call:${START}:notes-pdf`,
      `rec:${RECORDING.id}:main`,
      `rec:${RECORDING.id}:stereo`,
    ]);
    // Email 1's report: the three Transcripts files, before any recording file existed.
    expect(w.reports[0]).toMatchObject({
      emailRule: 'two-step',
      callFilesSaved: true,
      manualOnly: false,
      recordingsFolderUrl: 'https://drive.google.com/drive/folders/RECF',
      expectedRecordings: [
        { id: RECORDING.id, part: 1, stereo: true, deviceName: 'Office laptop' },
      ],
    });
    expect(w.reports[0]!.files.map((file) => file.kind)).toEqual([
      'transcript-txt',
      'transcript-pdf',
      'notes-pdf',
    ]);
    // The finish: everything, once more.
    expect(w.reports.at(-1)!.files).toHaveLength(5);
    expect(w.jobs.get(CALL_ID)).toMatchObject({
      state: 'done',
      notified: true,
      callFilesReported: true,
    });
    expect(w.states).toEqual(['uploading', 'done']);
    // Run again: nothing is uploaded or reported twice.
    const reports = w.reports.length;
    await runDriveQueue(w.deps);
    expect(w.counts).toEqual({ small: 3, started: 2 });
    expect(w.reports).toHaveLength(reports);
  });

  it('carries on past a failed transcript PDF and a failed recording file; the next run does only those', async () => {
    const w = world({
      failSmall: new Map([[`call:${START}:transcript-pdf`, { status: 503 }]]),
      hostScript: [() => ({ status: 'failed', retryable: true, reason: 'network' })],
    });
    await runDriveQueue(w.deps);
    // Everything else went in, in order.
    expect(w.order).toEqual([
      `call:${START}:transcript-txt`,
      `call:${START}:notes-pdf`,
      `rec:${RECORDING.id}:stereo`,
    ]);
    const job = w.jobs.get(CALL_ID)!;
    expect(job).toMatchObject({ state: 'error', autoRetry: true });
    expect(job.files.filter((file) => !file.done).map((file) => file.key)).toEqual([
      `call:${START}:transcript-pdf`,
      `rec:${RECORDING.id}:main`,
    ]);
    // Email 1 waits: the transcript PDF is not in yet.
    expect(w.reports.every((report) => report.callFilesSaved === false)).toBe(true);
    // Retried later (the automatic retry): only the two failed files go.
    w.jobs.set(CALL_ID, { ...job, updatedAt: 0 });
    await runDriveQueue(w.deps);
    expect(w.order.slice(3)).toEqual([`call:${START}:transcript-pdf`, `rec:${RECORDING.id}:main`]);
    expect(w.jobs.get(CALL_ID)!.state).toBe('done');
    expect(w.reports.some((report) => report.callFilesSaved === true)).toBe(true);
    expect(w.counts.small).toBe(3);
  });

  it('never uploads a file already in Drive (same keys as the older per-session upload)', async () => {
    const w = world({ existing: [`call:${START}:transcript-txt`, `rec:${RECORDING.id}:main`] });
    await runDriveQueue(w.deps);
    expect(w.order).toEqual([
      `call:${START}:transcript-pdf`,
      `call:${START}:notes-pdf`,
      `rec:${RECORDING.id}:stereo`,
    ]);
    expect(w.jobs.get(CALL_ID)!.files.every((file) => file.done)).toBe(true);
  });

  it('reports an earlier call "manual only", with no email rule', async () => {
    const w = world({ job: { ...JOB, origin: 'earlier', recordingMatch: 'window' } });
    await runDriveQueue(w.deps);
    expect(w.reports.length).toBeGreaterThan(0);
    for (const report of w.reports) {
      expect(report.manualOnly).toBe(true);
      expect(report.emailRule).toBeUndefined();
    }
  });
});

describe('planCallFiles and recordingOfCall', () => {
  it('orders the files and matches recordings by meeting, or by time for an older call', () => {
    const other: LocalRecording = { ...RECORDING, id: 'r2', meetingId: 'another', part: 2 };
    const planned = planCallFiles(JOB, [other, RECORDING], CALL_FILES);
    expect(planned.map((file) => file.key)).toEqual([
      `call:${START}:transcript-txt`,
      `call:${START}:transcript-pdf`,
      `call:${START}:notes-pdf`,
      `rec:${RECORDING.id}:main`,
      `rec:${RECORDING.id}:stereo`,
    ]);
    const legacy = { ...JOB, recordingMatch: 'window' as const };
    expect(recordingOfCall(legacy, { sessionId: SID, startedAt: START - 30_000 })).toBe(true);
    expect(recordingOfCall(legacy, { sessionId: SID, startedAt: END + 1 })).toBe(false);
    expect(recordingOfCall(legacy, { sessionId: 'other', startedAt: START })).toBe(false);
    expect(recordingOfCall(JOB, { meetingId: CALL_ID, startedAt: 0 })).toBe(true);
    expect(recordingOfCall(JOB, { meetingId: 'x', startedAt: START })).toBe(false);
  });
});

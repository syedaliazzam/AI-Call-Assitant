/**
 * Tests for apps/web/src/core/drive/uploader.ts (ADR-0072; ADR-0074: over a fake of Kite's server-side
 * Drive routes, never a Google token), with a fake desktop shell and an in-memory job store:
 * - ADR-0074: the page never sends a token; a recording that does not verify is uploaded again; a desktop
 *   app older than 1.6.2 keeps its recordings waiting ("update") while transcripts and notes save;
 * - a desktop call saves its recording part's main file, transcript PDF and notes PDF (ADR-0080: no
 *   stereo file, no transcript TXT) into "<date> <title>/Recordings" and "/Transcripts", then tells the
 *   server once and shows one notice;
 * - ADR-0080: a job queued before drops its not-yet-sent TXT and stereo files and keeps the ones in Drive;
 *   a job that failed is queued again and finishes;
 * - idempotency: running again, or after this device lost its ids, never makes a folder or file twice;
 * - resume: a call starting mid-upload pauses it, and the next run continues the SAME upload session; a
 *   gone session gets a new one; a lost local file is skipped;
 * - reconnect: a refused token or a "reconnect" status makes jobs wait with their files untouched, and
 *   they finish once Drive works again; nothing runs while a call is live;
 * - a notification that could not reach the server is sent at the next run without uploading again;
 * - ADR-0073: a session started again reports each call on its own (its own email), and a call already
 *   emailed under its session's single email is never reported again.
 * All values are invented; no real Google, shell or server is used.
 */
import type {
  DriveStatusResponse,
  DriveUploadRequest,
  DriveUploadResult,
  LocalRecording,
} from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { DriveApiError } from '@/core/drive/api';
import type { CallFile } from '@/core/drive/callFiles';
import {
  isDroppedFile,
  jobPercent,
  planFiles,
  runDriveQueue,
  withoutDroppedFiles,
  type UploaderDeps,
} from '@/core/drive/uploader';
import type { DriveFileJob, DriveSessionJob, Session } from '@/core/storage/types';

/** The session. */
const SID = '11111111-1111-4111-8111-111111111111';

/** The call: 11 Nov 2026 14:30–15:00 local time. */
const CALL = {
  startedAt: new Date(2026, 10, 11, 14, 30).getTime(),
  endedAt: new Date(2026, 10, 11, 15, 0).getTime(),
};

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
  email: { configured: false, enabled: true, alsoNotify: [] },
};

/** One item in the fake company Drive. */
interface Item {
  /** Its id. */
  id: string;
  /** Its folder. */
  parent: string;
  /** Its name. */
  name: string;
  /** Its tags (appProperties). */
  tags: Record<string, string>;
}

/**
 * A fake of Kite's server-side Drive routes (ADR-0074) over a fake company Drive: session folders,
 * recording uploads started by the server (session address and ticket only), offsets, verification, and
 * the page's small files uploaded by the server. Never a token.
 * @param state The world's switches (the company connection refused).
 * @returns The routes and the Drive's state.
 */
function fakeServer(state: { tokenRefused: boolean }) {
  const items: Item[] = [];
  const sessions = new Map<string, { name: string; parentId: string; tag: string; got: number }>();
  let n = 0;
  const counts = { folders: 0, sessions: 0, small: 0, offsets: 0, completes: 0 };
  const find = (parent: string, tags: Record<string, string>) =>
    items.find(
      (item) =>
        item.parent === parent && Object.entries(tags).every(([k, v]) => item.tags[k] === v),
    )?.id ?? null;
  const folder = (parent: string, name: string, tags: Record<string, string>) => {
    const found = find(parent, tags);
    if (found) return found;
    counts.folders += 1;
    const id = `folder-${++n}`;
    items.push({ id, parent, name, tags });
    return id;
  };
  const refuse = () => {
    if (state.tokenRefused) throw new DriveApiError(409, 'reconnect', 'Reconnect');
  };
  const sub = (sessionId: string, which: string) => {
    const session = find('ROOT', { kiteSession: sessionId, kiteFolder: 'session' });
    return session ? find(session, { kiteSession: sessionId, kiteFolder: which }) : null;
  };
  /**
   * Turns an upload session into a file.
   * @param url The session.
   * @returns The file's id.
   */
  const finish = (url: string): string => {
    const meta = sessions.get(url)!;
    const id = `file-${++n}`;
    items.push({ id, parent: meta.parentId, name: meta.name, tags: { kiteFile: meta.tag } });
    sessions.delete(url);
    return id;
  };
  const api: Pick<
    UploaderDeps['api'],
    'sessionFolder' | 'startUpload' | 'uploadOffset' | 'completeUpload' | 'uploadFile'
  > = {
    async sessionFolder({ sessionId, name }) {
      refuse();
      const session = folder('ROOT', name, { kiteSession: sessionId, kiteFolder: 'session' });
      return {
        folderId: session,
        recordingsId: folder(session, 'Recordings', {
          kiteSession: sessionId,
          kiteFolder: 'Recordings',
        }),
        transcriptsId: folder(session, 'Transcripts', {
          kiteSession: sessionId,
          kiteFolder: 'Transcripts',
        }),
      };
    },
    async startUpload({ sessionId, key, name }) {
      refuse();
      const parent = sub(sessionId, 'Recordings');
      if (!parent) throw new DriveApiError(409, 'no_session_folder', 'No folder');
      const tag = `${sessionId}\n${key}`;
      const existing = find(parent, { kiteFile: tag });
      if (existing) return { status: 'exists', fileId: existing };
      counts.sessions += 1;
      const url = `https://www.googleapis.com/upload/drive/v3/files?upload_id=${++n}`;
      sessions.set(url, { name, parentId: parent, tag, got: 0 });
      return { status: 'started', uploadUrl: url, ticket: `ticket-${n}` };
    },
    async uploadOffset({ uploadUrl }) {
      counts.offsets += 1;
      const session = sessions.get(uploadUrl);
      return session ? { state: 'partial', offset: session.got } : { state: 'expired' };
    },
    async completeUpload({ fileId }) {
      counts.completes += 1;
      if (!items.some((item) => item.id === fileId)) {
        throw new DriveApiError(409, 'verify_failed', 'Did not match');
      }
      return { fileId };
    },
    async uploadFile({ sessionId, key, name }) {
      refuse();
      counts.small += 1;
      const parent = sub(sessionId, 'Transcripts');
      if (!parent) throw new DriveApiError(409, 'no_session_folder', 'No folder');
      const tag = `${sessionId}\n${key}`;
      const existing = find(parent, { kiteFile: tag });
      if (existing) return { fileId: existing };
      const id = `file-${++n}`;
      items.push({ id, parent, name, tags: { kiteFile: tag } });
      return { fileId: id };
    },
  };
  return { api, items, sessions, counts, finish };
}

/** A recording part on this computer. */
const RECORDING: LocalRecording = {
  id: '22222222-2222-4222-8222-222222222222',
  sessionId: SID,
  meetingId: '33333333-3333-4333-8333-333333333333',
  part: 1,
  kind: 'screen',
  startedAt: CALL.startedAt + 5_000,
  durationMs: 60_000,
  bytes: 1_000,
  fileName: 'Paramount AI 2026-11-11 14-30-05.mkv',
  hasStereo: true,
  status: 'complete',
};

/** The session. */
const SESSION = {
  id: SID,
  type: 'interview',
  company: 'Acme',
  role: 'Backend Engineer',
  saveTranscript: true,
} as Session;

/** Options for one test's world. */
interface WorldOptions {
  /** The status the server answers. */
  status?: DriveStatusResponse;
  /** Results the shell gives, in order, before it uploads normally. */
  hostScript?: ((request: DriveUploadRequest) => DriveUploadResult)[];
  /** Recordings on this computer. */
  recordings?: LocalRecording[];
  /** A desktop app older than 1.6.2 (no fileSize: it cannot upload without a token). */
  oldShell?: boolean;
}

/**
 * A world: fake Drive, shell, server and job store, with one queued job.
 * @param options What differs.
 * @returns The deps and the parts to inspect.
 */
function world(options: WorldOptions = {}) {
  const state = {
    status: options.status ?? CONNECTED,
    callLive: false,
    notifyFails: false,
    tokenRefused: false,
  };
  const google = fakeServer(state);
  const jobs = new Map<string, DriveSessionJob>();
  jobs.set(SID, {
    sessionId: SID,
    calls: [CALL],
    files: [],
    state: 'queued',
    notified: false,
    reportedFiles: 0,
    noticeShown: false,
    queuedAt: CALL.endedAt,
    updatedAt: CALL.endedAt,
  });
  const notified: unknown[] = [];
  const notices: unknown[] = [];
  const hostCalls: DriveUploadRequest[] = [];
  const script = [...(options.hostScript ?? [])];
  // With a TXT, as an older builder made: ADR-0080 leaves it out.
  const callFiles: CallFile[] = [
    { kind: 'transcript-txt', blob: new Blob(['lines']) },
    { kind: 'transcript-pdf', blob: new Blob(['%PDF']) },
    { kind: 'notes-pdf', blob: new Blob(['%PDF notes']) },
  ];
  const host: NonNullable<UploaderDeps['host']> = {
    recordings: async () => options.recordings ?? [RECORDING],
    async upload(request, onProgress) {
      hostCalls.push(request);
      const next = script.shift();
      if (next) return next(request);
      if (!google.sessions.has(request.uploadUrl)) return { status: 'expired' };
      onProgress({
        recordingId: request.recordingId,
        track: request.track,
        sent: 500,
        total: 500,
      });
      return { status: 'done', fileId: google.finish(request.uploadUrl), bytes: 500 };
    },
  };
  // Desktop 1.6.2: the file's size (and uploads without a token); 1.6.0 and 1.6.1 do not have it.
  if (!options.oldShell) host.fileSize = async () => 500;
  const deps: UploaderDeps = {
    api: {
      status: async () => state.status,
      notify: async (request) => {
        if (state.notifyFails) throw new DriveApiError(0, 'network', 'offline');
        notified.push(request);
        return { status: 'not-set-up' };
      },
      ...google.api,
    },
    host,
    jobs: {
      next: async () =>
        [...jobs.values()]
          .filter((job) => ['queued', 'uploading', 'paused'].includes(job.state))
          .sort((a, b) => a.queuedAt - b.queuedAt)[0] ?? null,
      list: async () => [...jobs.values()],
      put: async (job) => {
        jobs.set(job.sessionId, structuredClone(job));
      },
      remove: async (id) => {
        jobs.delete(id);
      },
    },
    session: async (id) => (id === SID ? SESSION : null),
    callFiles: async () => callFiles,
    callActive: async () => state.callLive,
    notice: (notice) => notices.push(notice),
    now: () => Date.now(),
    timeZone: () => 'UTC',
    expectedRecordings: async () =>
      (options.recordings ?? [RECORDING]).map((r) => ({
        id: r.id,
        part: r.part,
        stereo: r.hasStereo,
        startedAt: r.startedAt,
      })),
  };
  return { deps, google, jobs, notified, notices, hostCalls, state, job: () => jobs.get(SID)! };
}

describe('a desktop call', () => {
  it('saves every file into the session folder, then notifies once', async () => {
    const w = world();
    expect(await runDriveQueue(w.deps)).toBe('idle');
    const job = w.job();
    expect(job.state).toBe('done');
    const folder = w.google.items.find((item) => item.parent === 'ROOT')!;
    expect(folder.name).toBe('2026-11-11 Acme – Backend Engineer');
    const sub = (name: string) =>
      w.google.items.find((i) => i.parent === folder.id && i.name === name)!;
    const inFolder = (parent: Item) =>
      w.google.items.filter((i) => i.parent === parent.id).map((i) => i.name);
    // ADR-0080: the main video only (the recording has a stereo file), and the two PDFs only.
    expect(inFolder(sub('Recordings'))).toEqual(['2026-11-11 14.30 Part 1.mkv']);
    expect(inFolder(sub('Transcripts'))).toEqual([
      '2026-11-11 14.30 Transcript.pdf',
      '2026-11-11 14.30 Notes.pdf',
    ]);
    expect(w.notified).toHaveLength(1);
    expect(w.notified[0]).toMatchObject({
      sessionId: SID,
      title: 'Acme – Backend Engineer',
      durationMs: 30 * 60_000,
      folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
      alsoNotify: null,
    });
    expect(w.notices).toEqual([
      {
        title: 'Recording and transcript saved — Acme – Backend Engineer',
        body: 'Open in Drive',
        url: `https://drive.google.com/drive/folders/${folder.id}`,
      },
    ]);
    expect(jobPercent(job)).toBe(100);
  });
});

describe('idempotency', () => {
  it('never makes a folder or a file twice: run again, or after this device lost its ids', async () => {
    const w = world();
    await runDriveQueue(w.deps);
    const before = w.google.items.length;
    // The same call queued again (a retry): nothing new.
    w.jobs.set(SID, { ...w.job(), state: 'queued' });
    await runDriveQueue(w.deps);
    expect(w.google.items.length).toBe(before);
    // This device forgot every id (a reinstall): Kite's tags find the folders and files.
    w.jobs.set(SID, {
      ...w.job(),
      state: 'queued',
      folderId: undefined,
      recordingsId: undefined,
      transcriptsId: undefined,
      files: [],
      notified: false,
    });
    const uploadsBefore = w.google.counts.sessions;
    await runDriveQueue(w.deps);
    expect(w.google.items.length).toBe(before);
    expect(w.google.counts.sessions).toBe(uploadsBefore);
    expect(w.job().files.every((file) => file.done && file.driveFileId)).toBe(true);
  });
});

describe('resume', () => {
  it('pauses for a call and continues the same upload session afterwards', async () => {
    const w = world({
      hostScript: [
        (request) => {
          w.state.callLive = true;
          // Google kept 256 KiB of it.
          w.google.sessions.get(request.uploadUrl)!.got = 256 * 1024;
          return { status: 'paused', offset: 256 * 1024, bytes: 1_000_000 };
        },
      ],
    });
    expect(await runDriveQueue(w.deps)).toBe('call');
    const paused = w.job();
    expect(paused.state).toBe('paused');
    const recording = paused.files.find((file) => file.key.endsWith(':main'))!;
    expect(recording.uploadUrl).toBeTruthy();
    expect(recording.sent).toBe(256 * 1024);
    // Nothing runs while the call is live.
    expect(await runDriveQueue(w.deps)).toBe('call');
    expect(w.hostCalls).toHaveLength(1);
    w.state.callLive = false;
    const sessionsBefore = w.google.counts.sessions;
    expect(await runDriveQueue(w.deps)).toBe('idle');
    expect(w.hostCalls[1]!.uploadUrl).toBe(recording.uploadUrl);
    // ADR-0074: the server said where Google got to; the shell starts there.
    expect(w.hostCalls[1]!.startOffset).toBe(256 * 1024);
    // No new session was needed (Transcripts files go through the server; ADR-0080: no stereo file).
    expect(w.google.counts.sessions - sessionsBefore).toBe(0);
    expect(w.job().state).toBe('done');
  });

  it('opens a new session when the old one is gone (also after a 401: no token is involved)', async () => {
    const w = world({
      hostScript: [
        () => ({ status: 'expired' }),
        () => ({ status: 'auth', offset: 0, bytes: 1_000 }),
      ],
    });
    await runDriveQueue(w.deps);
    expect(w.job().state).toBe('done');
    expect(new Set(w.hostCalls.slice(0, 3).map((c) => c.uploadUrl)).size).toBe(3);
  });

  it('skips a recording whose file was deleted from this computer', async () => {
    const w = world({ hostScript: [() => ({ status: 'missing' })] });
    await runDriveQueue(w.deps);
    const main = w.job().files.find((file) => file.key.endsWith(':main'))!;
    expect(main).toMatchObject({ done: true, missing: true });
    const sent = (w.notified[0] as { files: { name: string }[] }).files.map((file) => file.name);
    expect(sent).not.toContain('2026-11-11 14.30 Part 1.mkv');
  });
});

describe('reconnect', () => {
  it('waits with its files untouched when the token is refused, and finishes after reconnecting', async () => {
    const w = world();
    w.state.tokenRefused = true;
    expect(await runDriveQueue(w.deps)).toBe('waiting');
    expect(w.job()).toMatchObject({ state: 'waiting', reason: 'reconnect' });
    expect(w.job().files.some((file) => file.done && file.recordingId)).toBe(false);
    // The server now says "reconnect" too: still waiting, nothing uploaded.
    w.state.status = { ...CONNECTED, status: 'reconnect' };
    await runDriveQueue(w.deps);
    expect(w.job().state).toBe('waiting');
    // Reconnected.
    w.state.tokenRefused = false;
    w.state.status = CONNECTED;
    expect(await runDriveQueue(w.deps)).toBe('idle');
    expect(w.job().state).toBe('done');
    expect(w.notified).toHaveLength(1);
  });

  it('waits for a folder, and for "Save calls" to be on', async () => {
    const noFolder = world({ status: { ...CONNECTED, folder: null } });
    await runDriveQueue(noFolder.deps);
    expect(noFolder.job()).toMatchObject({ state: 'waiting', reason: 'no-folder' });
    const off = world({ status: { ...CONNECTED, saveEnabled: false } });
    await runDriveQueue(off.deps);
    expect(off.job()).toMatchObject({ state: 'waiting', reason: 'save-off' });
    expect(off.google.items).toHaveLength(0);
  });
});

describe('the server notification', () => {
  it('is sent at the next run when the server could not be reached, without uploading again', async () => {
    const w = world();
    w.state.notifyFails = true;
    await runDriveQueue(w.deps);
    expect(w.job()).toMatchObject({ state: 'done', notified: false });
    const sessions = w.google.counts.sessions;
    w.state.notifyFails = false;
    await runDriveQueue(w.deps);
    expect(w.notified).toHaveLength(1);
    expect(w.job().notified).toBe(true);
    expect(w.google.counts.sessions).toBe(sessions);
    await runDriveQueue(w.deps);
    expect(w.notified).toHaveLength(1);
  });
});

describe('runDriveQueue', () => {
  it('picks up an error queued again by auto-retry in the same run', async () => {
    const w = world();
    w.jobs.set(SID, {
      ...w.job(),
      state: 'error',
      reason: 'network',
      autoRetry: true,
      updatedAt: 0,
    });
    expect(await runDriveQueue(w.deps)).toBe('idle');
    expect(w.job().state).toBe('done');
  });

  it('stops marking jobs as waiting when a call starts', async () => {
    const w = world();
    const second = { ...w.job(), sessionId: 'other-session', queuedAt: CALL.endedAt + 1 };
    w.jobs.set('other-session', second);
    let calls = 0;
    // The token is refused (waiting), and a call starts while the next job is looked at.
    w.state.tokenRefused = true;
    w.deps.callActive = async () => {
      calls += 1;
      return calls > 3;
    };
    expect(await runDriveQueue(w.deps)).toMatch(/call|waiting/);
  });
});

describe('planFiles', () => {
  it('takes only this session and call, finished parts, and never lists a file twice', () => {
    const job = { sessionId: SID, calls: [CALL], files: [] } as unknown as DriveSessionJob;
    const others: LocalRecording[] = [
      { ...RECORDING, id: 'other-session', sessionId: 'x' },
      { ...RECORDING, id: 'still-recording', status: 'recording' },
      { ...RECORDING, id: 'earlier-call', startedAt: CALL.startedAt - 3_600_000 },
    ];
    const once = planFiles(job, [RECORDING, ...others], new Map());
    // ADR-0080: the main file only, though the recording has a stereo file.
    expect(once.map((file) => file.key)).toEqual([`rec:${RECORDING.id}:main`]);
    const twice = planFiles({ ...job, files: once }, [RECORDING], new Map());
    expect(twice).toHaveLength(1);
  });
});

describe('ADR-0080: jobs queued before (TXT and stereo files)', () => {
  /**
   * A job's file.
   * @param key  Its key.
   * @param done Whether it is in Drive.
   * @returns The file.
   */
  const file = (key: string, done: boolean): DriveFileJob => ({
    key,
    folder: key.startsWith('rec:') ? 'Recordings' : 'Transcripts',
    name: key,
    callStartedAt: CALL.startedAt,
    bytes: 10,
    sent: done ? 10 : 0,
    done,
    ...(done ? { driveFileId: `id-${key}` } : {}),
    ...(key.startsWith('rec:')
      ? {
          recordingId: RECORDING.id,
          track: key.endsWith(':stereo') ? ('stereo' as const) : ('main' as const),
          part: 1,
        }
      : {}),
  });

  it('drops only the not-yet-sent TXT and stereo files; the ones in Drive stay', () => {
    expect(isDroppedFile(file(`call:${CALL.startedAt}:transcript-txt`, false))).toBe(true);
    expect(isDroppedFile(file(`rec:${RECORDING.id}:stereo`, false))).toBe(true);
    expect(isDroppedFile(file(`call:${CALL.startedAt}:transcript-txt`, true))).toBe(false);
    expect(isDroppedFile(file(`rec:${RECORDING.id}:stereo`, true))).toBe(false);
    expect(isDroppedFile(file(`call:${CALL.startedAt}:transcript-pdf`, false))).toBe(false);
    expect(isDroppedFile(file(`rec:${RECORDING.id}:main`, false))).toBe(false);
    const job = {
      sessionId: SID,
      calls: [CALL],
      state: 'queued',
      updatedAt: 1,
      files: [
        file(`call:${CALL.startedAt}:transcript-txt`, true),
        file(`rec:${RECORDING.id}:main`, true),
      ],
    } as DriveSessionJob;
    // Nothing to drop: the very same object (nothing is saved).
    expect(withoutDroppedFiles(job, 2)).toBe(job);
    const withUnsent = { ...job, files: [...job.files, file(`rec:${RECORDING.id}:stereo`, false)] };
    expect(withoutDroppedFiles(withUnsent, 2).files.map((one) => one.key)).toEqual([
      `call:${CALL.startedAt}:transcript-txt`,
      `rec:${RECORDING.id}:main`,
    ]);
    // planFiles drops them too, and never adds them again.
    const planned = planFiles(withUnsent, [RECORDING], new Map());
    expect(planned.map((one) => one.key)).toEqual([
      `call:${CALL.startedAt}:transcript-txt`,
      `rec:${RECORDING.id}:main`,
    ]);
  });

  it('a session job that failed on its stereo file is queued again and finishes without it', async () => {
    const w = world();
    w.jobs.set(SID, {
      ...w.job(),
      state: 'error',
      reason: 'refused',
      files: [file(`rec:${RECORDING.id}:main`, false), file(`rec:${RECORDING.id}:stereo`, false)],
    });
    expect(await runDriveQueue(w.deps)).toBe('idle');
    expect(w.job().state).toBe('done');
    expect(w.job().files.map((one) => one.key)).toEqual([
      `rec:${RECORDING.id}:main`,
      `call:${CALL.startedAt}:transcript-pdf`,
      `call:${CALL.startedAt}:notes-pdf`,
    ]);
    expect(w.hostCalls.map((call) => call.track)).toEqual(['main']);
  });
});

describe('the report (1.6.0)', () => {
  it('carries each file with its key, Drive id, kind and part, and the expected recordings', async () => {
    const w = world();
    await runDriveQueue(w.deps);
    const report = w.notified[0] as {
      files: { key: string; fileId?: string; kind?: string; part?: number }[];
      expectedRecordings: unknown[];
      manualOnly: boolean;
    };
    expect(report.manualOnly).toBe(false);
    expect(report.expectedRecordings).toEqual([{ id: RECORDING.id, part: 1, stereo: true }]);
    // ADR-0080: the main video and the two PDFs only.
    expect(report.files.map((f) => [f.key, f.kind, f.part ?? null])).toEqual([
      [`rec:${RECORDING.id}:main`, 'recording', 1],
      [`call:${CALL.startedAt}:transcript-pdf`, 'transcript-pdf', null],
      [`call:${CALL.startedAt}:notes-pdf`, 'notes-pdf', null],
    ]);
    expect(report.files.every((f) => f.fileId)).toBe(true);
    expect(w.job()).toMatchObject({ notified: true, reportedFiles: 3 });
  });

  it('reports the files saved before an error, so the session can be emailed without them', async () => {
    const part2: LocalRecording = {
      ...RECORDING,
      id: '55555555-5555-4555-8555-555555555555',
      part: 2,
      startedAt: RECORDING.startedAt + 70_000,
    };
    const w = world({
      recordings: [RECORDING, part2],
      hostScript: [
        // Part 1 uploads; part 2 is refused.
        (request) => ({ status: 'done', fileId: w.google.finish(request.uploadUrl), bytes: 500 }),
        () => ({ status: 'failed', retryable: false, reason: 'http-403' }),
      ],
    });
    await runDriveQueue(w.deps);
    expect(w.job().state).toBe('error');
    expect(w.notified).toHaveLength(0);
    // The next run tells the server what is in Drive (the server sends after 24 hours if nothing more).
    await runDriveQueue(w.deps);
    const report = w.notified[0] as { files: { key: string }[] };
    expect(report.files.map((f) => f.key)).toEqual([`rec:${RECORDING.id}:main`]);
    expect(w.job()).toMatchObject({ state: 'error', reportedFiles: 1, notified: false });
    await runDriveQueue(w.deps);
    expect(w.notified).toHaveLength(1);
  });
});

describe('backfill (1.6.0)', () => {
  it('queues a finished session again for a recording on this computer, and uploads only it', async () => {
    // The session was saved by a 1.5.2 app: transcripts only, no recording.
    const w = world({ recordings: [] });
    await runDriveQueue(w.deps);
    expect(w.job().state).toBe('done');
    const before = w.google.counts.sessions;
    // 1.6.0 starts: the recording is in this computer's index.
    w.deps.host!.recordings = async () => [RECORDING];
    w.deps.expectedRecordings = async () => [
      { id: RECORDING.id, part: 1, stereo: true, startedAt: RECORDING.startedAt },
      // An older call's recording, never part of this upload: not waited for.
      { id: 'older', part: 1, stereo: false, startedAt: CALL.startedAt - 86_400_000 },
    ];
    expect(await runDriveQueue(w.deps)).toBe('idle');
    // ADR-0080: the main file only.
    expect(w.google.counts.sessions - before).toBe(1);
    expect(w.job().state).toBe('done');
    const last = w.notified.at(-1) as {
      files: { key: string }[];
      expectedRecordings: { id: string }[];
    };
    expect(last.files.map((f) => f.key)).toContain(`rec:${RECORDING.id}:main`);
    expect(last.files.map((f) => f.key)).not.toContain(`rec:${RECORDING.id}:stereo`);
    expect(last.expectedRecordings.map((r) => r.id)).toEqual([RECORDING.id]);
  });

  it('marks a job from before the combined email as "manual email only" and reports it once', async () => {
    const w = world({ recordings: [] });
    await runDriveQueue(w.deps);
    const reports = w.notified.length;
    // As a 1.5.2-era job: no report count, already notified, and calls without their own flags (they
    // came with ADR-0073).
    const { reportedFiles: _old, ...legacy } = w.job();
    w.jobs.set(SID, {
      ...legacy,
      notified: true,
      calls: legacy.calls.map(({ startedAt, endedAt }) => ({ startedAt, endedAt })),
    });
    await runDriveQueue(w.deps);
    expect(w.job().manualEmail).toBe(true);
    await runDriveQueue(w.deps);
    expect(w.notified.length).toBe(reports + 1);
    expect((w.notified.at(-1) as { manualOnly: boolean }).manualOnly).toBe(true);
  });
});

describe('a session started again (ADR-0073: each call has its own email)', () => {
  /** The second call: the same day, 17:00–17:20. */
  const CALL2 = {
    startedAt: new Date(2026, 10, 11, 17, 0).getTime(),
    endedAt: new Date(2026, 10, 11, 17, 20).getTime(),
  };
  /** Its recording. */
  const RECORDING2: LocalRecording = {
    ...RECORDING,
    id: '44444444-4444-4444-8444-444444444444',
    startedAt: CALL2.startedAt + 5_000,
    fileName: 'Paramount AI 2026-11-11 17-00-05.mkv',
  };
  /** A report as the server receives it. */
  type Report = {
    /** The call's start. */
    callStartedAt: number;
    /** The call's length, ms. */
    durationMs: number;
    /** Its saved files. */
    files: { key?: string }[];
    /** The recordings it waits for. */
    expectedRecordings: { id: string }[];
  };

  /**
   * Queues the second call, as the live page's End does.
   * @param w The world.
   */
  function startAgain(w: ReturnType<typeof world>) {
    const job = w.job();
    w.jobs.set(SID, {
      ...job,
      state: 'queued',
      calls: [...job.calls, { ...CALL2, reportedFiles: 0, notified: false }],
    });
  }

  it('reports the second call on its own, with only its files; the first is not reported again', async () => {
    const w = world({ recordings: [RECORDING, RECORDING2] });
    await runDriveQueue(w.deps);
    expect(w.notified).toHaveLength(1);
    expect((w.notified[0] as Report).callStartedAt).toBe(CALL.startedAt);
    // The first call's report holds only the first call's recording.
    expect((w.notified[0] as Report).expectedRecordings.map((r) => r.id)).toEqual([RECORDING.id]);

    startAgain(w);
    expect(await runDriveQueue(w.deps)).toBe('idle');
    expect(w.notified).toHaveLength(2);
    const second = w.notified[1] as Report;
    expect(second).toMatchObject({ sessionId: SID, callStartedAt: CALL2.startedAt });
    expect(second.durationMs).toBe(20 * 60_000);
    expect(second.files.map((file) => file.key).sort()).toEqual(
      [
        `call:${CALL2.startedAt}:notes-pdf`,
        `call:${CALL2.startedAt}:transcript-pdf`,
        `rec:${RECORDING2.id}:main`,
      ].sort(),
    );
    expect(second.expectedRecordings.map((r) => r.id)).toEqual([RECORDING2.id]);
    // Each call keeps its own files, in the same session folder.
    const folder = w.google.items.find((item) => item.parent === 'ROOT')!;
    expect(w.google.items.filter((item) => item.parent === 'ROOT')).toHaveLength(1);
    const names = w.google.items
      .filter((item) => item.parent !== 'ROOT' && item.parent !== folder.id)
      .map((item) => item.name);
    expect(names).toEqual(
      expect.arrayContaining(['2026-11-11 14.30 Part 1.mkv', '2026-11-11 17.00 Part 1.mkv']),
    );
    // Nothing more to tell.
    await runDriveQueue(w.deps);
    expect(w.notified).toHaveLength(2);
  });

  it('never reports again a call its session was emailed for before the change', async () => {
    const w = world({ recordings: [RECORDING, RECORDING2] });
    await runDriveQueue(w.deps);
    const done = w.job();
    // As 1.6.0 and 1.6.1 left it: emailed for the session, its calls without their own flags.
    w.jobs.set(SID, {
      ...done,
      calls: done.calls.map(({ startedAt, endedAt }) => ({ startedAt, endedAt })),
    });
    await runDriveQueue(w.deps);
    expect(w.job().calls[0]).toMatchObject({ closed: true, notified: true });
    expect(w.notified).toHaveLength(1);
    // Started again: only the new call is reported.
    startAgain(w);
    await runDriveQueue(w.deps);
    expect(w.notified).toHaveLength(2);
    expect((w.notified[1] as Report).callStartedAt).toBe(CALL2.startedAt);
  });
});

describe('no Google token in the page (ADR-0074)', () => {
  it('never asks for or sends a token: the server makes folders and starts uploads', async () => {
    const w = world();
    await runDriveQueue(w.deps);
    expect(w.job().state).toBe('done');
    expect('token' in w.deps.api).toBe(false);
    expect(w.hostCalls.every((call) => call.accessToken === undefined)).toBe(true);
    // The recording through the shell, verified by the server; the two Transcripts files by the server.
    expect(w.google.counts.completes).toBe(1);
    expect(w.google.counts.small).toBe(2);
  });

  it('uploads a recording again when the server cannot verify it', async () => {
    const w = world({
      hostScript: [
        // Google answers with an id the server cannot find with this upload's tag.
        () => ({ status: 'done', fileId: 'not-ours', bytes: 500, md5: '0'.repeat(32) }),
      ],
    });
    await runDriveQueue(w.deps);
    expect(w.job().state).toBe('done');
    const main = w.job().files.find((file) => file.key.endsWith(':main'))!;
    expect(main.driveFileId).not.toBe('not-ours');
    expect(new Set(w.hostCalls.slice(0, 2).map((c) => c.uploadUrl)).size).toBe(2);
  });

  it('keeps recordings waiting on a desktop app older than 1.6.2, and saves the rest', async () => {
    const w = world({ oldShell: true });
    expect(await runDriveQueue(w.deps)).toBe('waiting');
    expect(w.job()).toMatchObject({ state: 'waiting', reason: 'update-desktop' });
    expect(w.hostCalls).toHaveLength(0);
    const transcripts = w.job().files.filter((file) => !file.recordingId);
    expect(transcripts.every((file) => file.done && file.driveFileId)).toBe(true);
    // Later runs on the same old app leave it alone (no server calls).
    const before = { ...w.google.counts };
    await runDriveQueue(w.deps);
    expect(w.google.counts).toEqual(before);
    // Updated to 1.6.2: the recordings upload.
    w.deps.host!.fileSize = async () => 500;
    expect(await runDriveQueue(w.deps)).toBe('idle');
    expect(w.job().state).toBe('done');
    expect(w.job().files.every((file) => file.done)).toBe(true);
  });
});

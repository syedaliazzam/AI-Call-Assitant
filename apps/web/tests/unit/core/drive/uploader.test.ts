/**
 * Tests for apps/web/src/core/drive/uploader.ts (ADR-0072), with a fake Drive, a fake desktop shell and
 * an in-memory job store:
 * - a desktop call saves its recording part (and stereo file), transcript TXT and PDF and notes PDF into
 *   "<date> <title>/Recordings" and "/Transcripts", then tells the server once and shows one notice;
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
import type { DriveClient, DriveTag } from '@/core/drive/google';
import { jobPercent, planFiles, runDriveQueue, type UploaderDeps } from '@/core/drive/uploader';
import type { DriveSessionJob, Session } from '@/core/storage/types';

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
  saveEnabled: true,
  email: { configured: false, enabled: true, alsoNotify: [] },
};

/** One item in the fake Drive. */
interface Item {
  /** Its id. */
  id: string;
  /** Its folder. */
  parent: string;
  /** Its name. */
  name: string;
  /** Its tags. */
  tags: DriveTag[];
}

/**
 * A fake Drive that keeps folders and files, with upload sessions that become files when finished.
 * @returns The client and its state.
 */
function fakeDrive() {
  const items: Item[] = [];
  const sessions = new Map<string, { name: string; parentId: string; tags: DriveTag[] }>();
  let n = 0;
  const counts = { folders: 0, sessions: 0, blobs: 0 };
  const has = (item: Item, tags: DriveTag[]) =>
    tags.every((tag) => item.tags.some((t) => t.key === tag.key && t.value === tag.value));
  /**
   * Turns an upload session into a file.
   * @param url The session.
   * @returns The file's id.
   */
  const finish = (url: string): string => {
    const meta = sessions.get(url)!;
    const id = `file-${++n}`;
    items.push({ id, parent: meta.parentId, name: meta.name, tags: meta.tags });
    sessions.delete(url);
    return id;
  };
  const drive: DriveClient = {
    async find(parentId, tags) {
      return items.find((item) => item.parent === parentId && has(item, tags))?.id ?? null;
    },
    async createFolder(name, parentId, tags) {
      counts.folders += 1;
      const id = `folder-${++n}`;
      items.push({ id, parent: parentId, name, tags });
      return id;
    },
    async startUpload(meta) {
      counts.sessions += 1;
      const url = `https://www.googleapis.com/upload/drive/v3/files?upload_id=${++n}`;
      sessions.set(url, { name: meta.name, parentId: meta.parentId, tags: meta.tags });
      return url;
    },
    async uploadBlob(url, blob, onProgress) {
      counts.blobs += 1;
      if (!sessions.has(url)) return { status: 'expired' };
      onProgress(blob.size);
      return { status: 'done', fileId: finish(url), bytes: blob.size };
    },
  };
  return { drive, items, sessions, counts, finish };
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
}

/**
 * A world: fake Drive, shell, server and job store, with one queued job.
 * @param options What differs.
 * @returns The deps and the parts to inspect.
 */
function world(options: WorldOptions = {}) {
  const google = fakeDrive();
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
  const state = {
    status: options.status ?? CONNECTED,
    callLive: false,
    notifyFails: false,
    tokenRefused: false,
  };
  const callFiles: CallFile[] = [
    { kind: 'transcript-txt', blob: new Blob(['lines']) },
    { kind: 'transcript-pdf', blob: new Blob(['%PDF']) },
    { kind: 'notes-pdf', blob: new Blob(['%PDF notes']) },
  ];
  const deps: UploaderDeps = {
    api: {
      status: async () => state.status,
      token: async () => {
        if (state.tokenRefused) throw new DriveApiError(409, 'reconnect', 'Reconnect');
        return { accessToken: 'at', expiresAt: Date.now() + 3_600_000 };
      },
      notify: async (request) => {
        if (state.notifyFails) throw new DriveApiError(0, 'network', 'offline');
        notified.push(request);
        return { status: 'not-set-up' };
      },
    },
    drive: google.drive,
    host: {
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
    },
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
    expect(inFolder(sub('Recordings'))).toEqual([
      '2026-11-11 14.30 Part 1.mkv',
      '2026-11-11 14.30 Part 1 stereo.webm',
    ]);
    expect(inFolder(sub('Transcripts'))).toEqual([
      '2026-11-11 14.30 Transcript.txt',
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
        () => {
          w.state.callLive = true;
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
    // Only the stereo file and the three Transcripts files needed new sessions.
    expect(w.google.counts.sessions - sessionsBefore).toBe(4);
    expect(w.job().state).toBe('done');
  });

  it('opens a new session when the old one is gone, and gets a new token after "auth"', async () => {
    let tokens = 0;
    const w = world({
      hostScript: [
        () => ({ status: 'expired' }),
        () => ({ status: 'auth', offset: 0, bytes: 1_000 }),
      ],
    });
    const token = w.deps.api.token;
    w.deps.api.token = async (fresh) => {
      if (fresh) tokens += 1;
      return token(fresh);
    };
    await runDriveQueue(w.deps);
    expect(w.job().state).toBe('done');
    expect(new Set(w.hostCalls.slice(0, 2).map((c) => c.uploadUrl)).size).toBe(2);
    expect(tokens).toBe(1);
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
    expect(once.map((file) => file.key)).toEqual([
      `rec:${RECORDING.id}:main`,
      `rec:${RECORDING.id}:stereo`,
    ]);
    const twice = planFiles({ ...job, files: once }, [RECORDING], new Map());
    expect(twice).toHaveLength(2);
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
    expect(report.files.map((f) => [f.key, f.kind, f.part ?? null])).toEqual([
      [`rec:${RECORDING.id}:main`, 'recording', 1],
      [`rec:${RECORDING.id}:stereo`, 'stereo', 1],
      [`call:${CALL.startedAt}:transcript-txt`, 'transcript-txt', null],
      [`call:${CALL.startedAt}:transcript-pdf`, 'transcript-pdf', null],
      [`call:${CALL.startedAt}:notes-pdf`, 'notes-pdf', null],
    ]);
    expect(report.files.every((f) => f.fileId)).toBe(true);
    expect(w.job()).toMatchObject({ notified: true, reportedFiles: 5 });
  });

  it('reports the files saved before an error, so the session can be emailed without them', async () => {
    const w = world({
      hostScript: [
        // The main file uploads; the stereo file is refused.
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
    expect(w.google.counts.sessions - before).toBe(2);
    expect(w.job().state).toBe('done');
    const last = w.notified.at(-1) as {
      files: { key: string }[];
      expectedRecordings: { id: string }[];
    };
    expect(last.files.map((f) => f.key)).toContain(`rec:${RECORDING.id}:stereo`);
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
        `call:${CALL2.startedAt}:transcript-txt`,
        `rec:${RECORDING2.id}:main`,
        `rec:${RECORDING2.id}:stereo`,
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

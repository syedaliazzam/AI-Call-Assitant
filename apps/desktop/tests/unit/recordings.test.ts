/**
 * Tests for apps/desktop/src/recordings/manager.ts (1.5.0, ADR-0068), on real files in a temporary
 * folder with a fake finaliser, free-space check and Recycle Bin:
 * - open(): checks the request (the page is not trusted), refuses below 2 GB free, makes the files under
 *   names it chooses (never overwriting), adds the recording to the index as 'recording' before any piece;
 * - write(): pieces land in order in the right file; a bad id, track or payload is refused; the drive's
 *   state is reported ('low' under 1 GB, 'stop' at 300 MB);
 * - close(): finalises (the finalised copy replaces the original) and marks it 'complete'; a failed
 *   finalise keeps the original;
 * - list() reports a deleted file as 'missing'; remove() sends the files to the Recycle Bin and forgets it;
 * - abandon() and recover(): a recording whose page went, or left by a crash, is finalised as
 *   'recovered'; the index survives a restart and refuses entries that point outside the folder.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRecordingManager,
  diskState,
  isOpenRequest,
  type ManagerDeps,
} from '../../src/recordings/manager';

/** Three UUIDs. */
const ID = '11111111-2222-4333-8444-555555555555';
const SESSION = '22222222-2222-4333-8444-555555555555';
const MEETING = '33333333-2222-4333-8444-555555555555';

/** A valid open request. */
const REQUEST = {
  id: ID,
  sessionId: SESSION,
  meetingId: MEETING,
  part: 1,
  kind: 'screen',
  startedAt: new Date(2026, 10, 10, 14, 30, 5).getTime(),
  container: 'mkv',
  stereo: true,
};

let root: string;
let folder: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'kite-recordings-test-'));
  folder = path.join(root, 'Recordings');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/**
 * A manager over the temporary folder.
 * @param changes Dependencies to replace.
 * @returns The manager and its fakes.
 */
function setup(changes: Partial<ManagerDeps> = {}) {
  let free = 50e9;
  const trashed: string[] = [];
  const deps: ManagerDeps = {
    folder: () => folder,
    indexFile: path.join(root, 'data', 'recordings.json'),
    freeBytes: async () => free,
    // The fake finaliser copies the file and says how long it is.
    finalise: vi.fn(async (input: string, output: string) => {
      writeFileSync(output, `final:${readFileSync(input, 'utf8')}`);
      return { durationMs: 61_000 };
    }),
    trash: async (file) => {
      trashed.push(path.basename(file));
      rmSync(file);
    },
    now: () => REQUEST.startedAt + 61_500,
    ...changes,
  };
  return {
    deps,
    trashed,
    setFree: (bytes: number) => {
      free = bytes;
    },
    manager: createRecordingManager(deps),
  };
}

describe('isOpenRequest and diskState', () => {
  it('accepts only a well-formed request', () => {
    expect(isOpenRequest(REQUEST)).toBe(true);
    expect(isOpenRequest({ ...REQUEST, id: '../x' })).toBe(false);
    expect(isOpenRequest({ ...REQUEST, kind: 'video' })).toBe(false);
    expect(isOpenRequest({ ...REQUEST, part: 0 })).toBe(false);
    expect(isOpenRequest({ ...REQUEST, container: 'mp4' })).toBe(false);
    expect(isOpenRequest({ ...REQUEST, kind: 'audio', container: 'mkv' })).toBe(false);
    expect(isOpenRequest(null)).toBe(false);
  });

  it('words the drive', () => {
    expect(diskState(5e9)).toBe('ok');
    expect(diskState(900e6)).toBe('low');
    expect(diskState(300e6)).toBe('stop');
  });
});

describe('createRecordingManager', () => {
  it('opens the files, writes the pieces in order, and finalises on close', async () => {
    const { manager } = setup();
    const opened = await manager.open(REQUEST, 7);
    expect(opened).toEqual({
      ok: true,
      fileName: 'Paramount AI 2026-11-10 14-30-05.mkv',
      freeBytes: 50e9,
    });
    // In the index before any piece, so a crash from here on is recovered.
    expect(manager.list()[0]).toMatchObject({ id: ID, status: 'recording', hasStereo: true });
    const writes = ['a', 'b', 'c'].map((t) =>
      manager.write(ID, 'main', new TextEncoder().encode(t)),
    );
    await manager.write(ID, 'stereo', new TextEncoder().encode('s'));
    expect((await Promise.all(writes)).every((r) => r.ok && r.disk === 'ok')).toBe(true);
    const closed = await manager.close(ID);
    expect(closed.ok).toBe(true);
    expect(closed.recording).toMatchObject({ status: 'complete', durationMs: 61_000 });
    const main = path.join(folder, 'Paramount AI 2026-11-10 14-30-05.mkv');
    expect(readFileSync(main, 'utf8')).toBe('final:abc');
    expect(
      readFileSync(path.join(folder, 'Paramount AI 2026-11-10 14-30-05.stereo.webm'), 'utf8'),
    ).toBe('final:s');
    expect(closed.recording?.bytes).toBe('final:abc'.length);
    expect(manager.fileOf(ID)?.file).toBe(main);
  });

  it('never overwrites a file, and refuses a busy id', async () => {
    const { manager } = setup();
    await manager.open(REQUEST, 7);
    const second = await manager.open(
      { ...REQUEST, id: '44444444-2222-4333-8444-555555555555' },
      7,
    );
    expect(second).toMatchObject({
      ok: true,
      fileName: 'Paramount AI 2026-11-10 14-30-05 (2).mkv',
    });
    expect(await manager.open(REQUEST, 7)).toEqual({ ok: false, reason: 'busy' });
  });

  it('refuses below 2 GB free, and reports low space and the stop', async () => {
    const low = setup();
    low.setFree(1.5e9);
    expect(await low.manager.open(REQUEST, 7)).toEqual({
      ok: false,
      reason: 'low-disk',
      freeBytes: 1.5e9,
    });
    let now = REQUEST.startedAt;
    const s = setup({ now: () => now });
    await s.manager.open(REQUEST, 7);
    s.setFree(800e6);
    now += 10_000;
    expect(await s.manager.write(ID, 'main', new Uint8Array([1]))).toMatchObject({ disk: 'low' });
    s.setFree(200e6);
    now += 10_000;
    expect(await s.manager.write(ID, 'main', new Uint8Array([1]))).toMatchObject({ disk: 'stop' });
  });

  it('refuses a bad id, track or payload', async () => {
    const { manager } = setup();
    await manager.open({ ...REQUEST, stereo: false }, 7);
    expect((await manager.write('nope', 'main', new Uint8Array([1]))).ok).toBe(false);
    expect((await manager.write(ID, 'video', new Uint8Array([1]))).ok).toBe(false);
    expect((await manager.write(ID, 'stereo', new Uint8Array([1]))).ok).toBe(false);
    expect((await manager.write(ID, 'main', 'text')).ok).toBe(false);
    expect(await manager.open({ ...REQUEST, id: 'x' }, 7)).toEqual({ ok: false, reason: 'failed' });
  });

  it('keeps the original when finalising fails', async () => {
    const { manager } = setup({
      finalise: async () => {
        throw new Error('unreadable');
      },
    });
    await manager.open({ ...REQUEST, stereo: false }, 7);
    await manager.write(ID, 'main', new TextEncoder().encode('raw'));
    const closed = await manager.close(ID);
    expect(closed.recording).toMatchObject({ status: 'complete', durationMs: 61_500 });
    expect(readFileSync(manager.fileOf(ID)!.file, 'utf8')).toBe('raw');
  });

  it('reports a deleted file as missing, and sends files to the Recycle Bin', async () => {
    const { manager, trashed } = setup();
    await manager.open(REQUEST, 7);
    await manager.close(ID);
    expect(await manager.remove(ID)).toBe(true);
    expect(trashed).toEqual([
      'Paramount AI 2026-11-10 14-30-05.mkv',
      'Paramount AI 2026-11-10 14-30-05.stereo.webm',
    ]);
    expect(manager.list()).toEqual([]);
    await manager.open({ ...REQUEST, id: '55555555-2222-4333-8444-555555555555' }, 7);
    await manager.close('55555555-2222-4333-8444-555555555555');
    rmSync(path.join(folder, 'Paramount AI 2026-11-10 14-30-05.mkv'));
    expect(manager.list()[0]?.status).toBe('missing');
    expect(manager.fileOf('55555555-2222-4333-8444-555555555555')).toBeNull();
  });

  it('recovers a recording whose page went, and one left by a crash', async () => {
    const first = setup();
    await first.manager.open(REQUEST, 7);
    await first.manager.write(ID, 'main', new TextEncoder().encode('x'));
    await first.manager.abandon(7);
    expect(first.manager.list()[0]?.status).toBe('recovered');

    // A crash: the files are closed with what they hold and the app starts again.
    const crashed = setup();
    const other = '66666666-2222-4333-8444-555555555555';
    await crashed.manager.open({ ...REQUEST, id: other, part: 2 }, 9);
    await crashed.manager.write(other, 'main', new TextEncoder().encode('y'));
    crashed.manager.closeAllNow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const restarted = setup();
    expect(await restarted.manager.recover()).toBe(1);
    expect(restarted.manager.list().find((r) => r.id === other)).toMatchObject({
      status: 'recovered',
      durationMs: 61_000,
      part: 2,
    });
  });

  it('refuses index entries that point outside the folder', async () => {
    const s = setup();
    await s.manager.open(REQUEST, 7);
    await s.manager.close(ID);
    const index = JSON.parse(readFileSync(s.deps.indexFile, 'utf8')) as {
      recordings: { fileName: string }[];
    };
    index.recordings[0]!.fileName = '..\\..\\secret.txt';
    writeFileSync(s.deps.indexFile, JSON.stringify(index));
    expect(setup().manager.list()).toEqual([]);
    expect(existsSync(s.deps.indexFile)).toBe(true);
  });
});

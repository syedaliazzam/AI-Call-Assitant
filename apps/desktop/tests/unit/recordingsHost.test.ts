/**
 * Tests for apps/desktop/src/recordings/host.ts (1.5.0, ADR-0068), with fake IPC, protocol, dialog,
 * shell and screen, and real files in a temporary folder:
 * - parseRange(): byte ranges as media elements send them; past the end is invalid;
 * - recordingDisplays(): the main display first, labelled with its real pixels;
 * - deviceIdentity(): a random id made once; the computer's name until renamed;
 * - installRecordings(): every channel refuses another origin; open → write → close goes through; Play
 *   opens the player only for a recording on this computer; the kite-recording:// scheme serves only
 *   indexed files, the whole file or a range (206), and 416 past the end; a page that goes recovers its
 *   recording; Save as copies the file (or makes an MP4 through the finaliser); renaming trims and caps.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RecordingCloseResult } from '@kite/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));

const { deviceIdentity, installRecordings, parseRange, recordingDisplays } =
  await import('../../src/recordings/host');
const { createStore } = await import('../../src/store');

/** The Kite origin. */
const ORIGIN = 'https://kite-call-assistant.vercel.app';
/** A recording id. */
const ID = '11111111-2222-4333-8444-555555555555';
const SESSION = '22222222-2222-4333-8444-555555555555';
const MEETING = '33333333-2222-4333-8444-555555555555';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'kite-recordings-host-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A fake screen with two displays, the main one second. */
const SCREEN = {
  getPrimaryDisplay: () => ({ id: 2 }),
  getAllDisplays: () => [
    { id: 1, size: { width: 2560, height: 1440 }, scaleFactor: 1 },
    { id: 2, size: { width: 1280, height: 720 }, scaleFactor: 1.5 },
  ],
};

describe('parseRange', () => {
  it('reads the ranges media elements send', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBeNull();
  });
});

describe('recordingDisplays and deviceIdentity', () => {
  it('lists the main display first, in real pixels', () => {
    expect(recordingDisplays(SCREEN as never)).toEqual([
      { id: '2', label: 'Display 1 (1920 × 1080, main)', primary: true },
      { id: '1', label: 'Display 2 (2560 × 1440)', primary: false },
    ]);
  });

  it('makes an id once, and uses the given name or the computer’s', () => {
    const store = createStore(path.join(root, 'shell.json'));
    const first = deviceIdentity(store);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(deviceIdentity(store).id).toBe(first.id);
    expect(first.name.length).toBeGreaterThan(0);
    store.write({ deviceName: 'Desk laptop' });
    expect(deviceIdentity(store).name).toBe('Desk laptop');
  });
});

/**
 * The host over fakes.
 * @returns The handlers, the scheme handler and the fakes.
 */
function setup() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  let scheme: ((request: Request) => Promise<Response>) | null = null;
  const opened: string[] = [];
  const finalise = vi.fn();
  const contents = new Map<string, () => void>();
  const sender = {
    id: 7,
    once: (event: string, listener: () => void) => contents.set(event, listener),
    on: () => undefined,
  };
  const store = createStore(path.join(root, 'shell.json'));
  const saveDialog = vi.fn(async () => ({
    canceled: false,
    filePath: path.join(root, 'copy.mkv'),
  }));
  installRecordings({
    ipcMain: { handle: (channel: string, handler: never) => void handlers.set(channel, handler) },
    allowedOrigin: ORIGIN,
    session: {
      protocol: { handle: (_scheme: string, handler: never) => (scheme = handler) },
    } as never,
    folder: () => path.join(root, 'Recordings'),
    dataFolder: path.join(root, 'data'),
    store,
    forkWorker: () => {
      const listeners: Record<string, (message: never) => void> = {};
      return {
        postMessage: (request: { id: number; input: string; output: string }) => {
          finalise(request);
          // Finalising copies the file as it is.
          copyFileSync(request.input, request.output);
          setTimeout(
            () =>
              listeners.message?.({
                type: 'done',
                id: request.id,
                durationMs: 9_000,
                ms: 1,
                bytes: 3,
              } as never),
            0,
          );
        },
        on: (event: string, listener: (message: never) => void) => {
          listeners[event] = listener;
        },
      };
    },
    openPlayer: (page) => opened.push(page),
    dialog: { showSaveDialog: saveDialog } as never,
    shell: { trashItem: async () => undefined, showItemInFolder: () => undefined } as never,
    screen: SCREEN as never,
    windowOf: () => null,
  });
  const kite = { senderFrame: { url: `${ORIGIN}/live/x`, parent: null }, sender };
  const other = { senderFrame: { url: 'https://evil.example/', parent: null }, sender };
  /**
   * Calls a channel as the Kite page.
   * @param channel The channel.
   * @param args    Its arguments.
   * @returns Its answer.
   */
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(kite, ...args);
  return { handlers, call, other, opened, finalise, contents, saveDialog, scheme: () => scheme! };
}

describe('installRecordings', () => {
  it('refuses another origin on every channel', () => {
    const { handlers, other } = setup();
    expect(handlers.size).toBe(12);
    for (const [channel, handler] of handlers) {
      expect(() => handler(other), channel).toThrow();
    }
  });

  it('records, plays and serves the file with byte ranges', async () => {
    const { call, opened, scheme } = setup();
    const open = (await call('kite:recording-open', {
      id: ID,
      sessionId: SESSION,
      meetingId: MEETING,
      part: 1,
      kind: 'screen',
      startedAt: Date.now(),
      container: 'mkv',
      stereo: false,
    })) as { ok: boolean };
    expect(open.ok).toBe(true);
    // Not playable while it is being written.
    expect(await call('kite:recording-play', ID)).toBe(false);
    await call('kite:recording-write', ID, 'main', new TextEncoder().encode('0123456789'));
    const closed = (await call('kite:recording-close', ID)) as RecordingCloseResult;
    expect(closed.recording?.durationMs).toBe(9_000);
    expect(await call('kite:recording-play', ID)).toBe(true);
    expect(opened).toEqual([`/player/${ID}`]);

    const whole = await scheme()(new Request(`kite-recording://file/${ID}`));
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/x-matroska');
    expect(await whole.text()).toBe('0123456789');
    const part = await scheme()(
      new Request(`kite-recording://file/${ID}`, { headers: { range: 'bytes=2-4' } }),
    );
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await part.text()).toBe('234');
    const past = await scheme()(
      new Request(`kite-recording://file/${ID}`, { headers: { range: 'bytes=50-' } }),
    );
    expect(past.status).toBe(416);
    const unknown = await scheme()(new Request('kite-recording://file/other'));
    expect(unknown.status).toBe(404);
  });

  it('recovers the recording of a page that went', async () => {
    const { call, contents } = setup();
    await call('kite:recording-open', {
      id: ID,
      sessionId: SESSION,
      meetingId: MEETING,
      part: 1,
      kind: 'audio',
      startedAt: Date.now(),
      container: 'webm',
      stereo: false,
    });
    contents.get('destroyed')!();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const list = (await call('kite:recording-list')) as { status: string }[];
    expect(list[0]?.status).toBe('recovered');
  });

  it('saves a copy, or an MP4 through the finaliser', async () => {
    const { call, finalise, saveDialog } = setup();
    await call('kite:recording-open', {
      id: ID,
      sessionId: SESSION,
      meetingId: MEETING,
      part: 1,
      kind: 'screen',
      startedAt: Date.now(),
      container: 'mkv',
      stereo: false,
    });
    await call('kite:recording-write', ID, 'main', new TextEncoder().encode('abc'));
    await call('kite:recording-close', ID);
    expect(await call('kite:recording-save-as', ID)).toBe('saved');
    expect(readFileSync(path.join(root, 'copy.mkv'), 'utf8')).toBe('abc');
    saveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(root, 'copy.mp4') });
    finalise.mockClear();
    expect(await call('kite:recording-save-as', ID)).toBe('saved');
    expect(finalise).toHaveBeenCalledWith(expect.objectContaining({ container: 'mp4' }));
    saveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' });
    expect(await call('kite:recording-save-as', ID)).toBe('cancelled');
    expect(await call('kite:recording-save-as', 'unknown')).toBe('missing');
  });

  it('picks only a known display, and renames the computer within limits', async () => {
    const { call } = setup();
    expect(await call('kite:list-displays')).toHaveLength(2);
    const renamed = (await call('kite:rename-device', `  Desk   laptop ${'x'.repeat(80)}`)) as {
      name: string;
    };
    expect(renamed.name.startsWith('Desk laptop')).toBe(true);
    expect(renamed.name.length).toBe(60);
  });
});

/**
 * Tests for apps/desktop/src/updater.ts (Day 6 Stage 3): nextUpdateStep() asks to restart only
 * when an update has downloaded, no call is live and the user has not been asked yet; during a
 * call it waits. 1.7.2 (ADR-0106): it also waits while Drive uploads are left. 1.8.0 (ADR-0109):
 * testUpdateFeed() accepts only an http:// feed on this computer, and startUpdater() uses it.
 * Mac 1.8.1 / Windows 1.7.5: "Check for Updates…" (checkNow()) says up to date, downloading, failed or not available
 * here; a downloaded update asks again, but waits while a call is on; manualCheckReply() has the words.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '1.8.0' }, dialog: dialogs }));
const updater = vi.hoisted(() => ({
  setFeedURL: vi.fn(),
  on: vi.fn(),
  quitAndInstall: vi.fn(),
  checkForUpdates: vi.fn((): Promise<unknown> => Promise.resolve(null)),
}));
const dialogs = vi.hoisted(() => ({
  showMessageBox: vi.fn(() => Promise.resolve({ response: 1 })),
}));
vi.mock('electron-updater', () => ({ autoUpdater: updater }));

const { CHECK_EVERY_MS, manualCheckReply, nextUpdateStep, startUpdater, testUpdateFeed } =
  await import('../../src/updater');

describe('testUpdateFeed (ADR-0109)', () => {
  it('accepts an http feed on this computer, from the variable or the file', () => {
    expect(testUpdateFeed('http://127.0.0.1:8765', null)).toBe('http://127.0.0.1:8765/');
    expect(testUpdateFeed(undefined, ' http://localhost:8765/feed \n')).toBe(
      'http://localhost:8765/feed',
    );
  });

  it('refuses anything else: no feed, another host, https, credentials, nonsense', () => {
    expect(testUpdateFeed(undefined, null)).toBeNull();
    expect(testUpdateFeed('', '  ')).toBeNull();
    expect(testUpdateFeed('http://example.com/feed', null)).toBeNull();
    expect(testUpdateFeed('http://127.0.0.1.example.com/', null)).toBeNull();
    expect(testUpdateFeed('https://127.0.0.1:8765', null)).toBeNull();
    expect(testUpdateFeed('http://user:secret@127.0.0.1:8765', null)).toBeNull();
    expect(testUpdateFeed('file:///tmp/feed', null)).toBeNull();
    expect(testUpdateFeed('not a url', null)).toBeNull();
  });

  it('the variable wins over the file', () => {
    expect(testUpdateFeed('http://example.com', 'http://127.0.0.1:1')).toBeNull();
  });
});

describe('startUpdater test feed (ADR-0109)', () => {
  /**
   * The options startUpdater needs, with a fake ipcMain.
   *
   * @param testFeed The test feed to pass, or null.
   * @returns The options.
   */
  const options = (testFeed: string | null) => ({
    ipcMain: { on: vi.fn() } as never,
    allowedOrigin: 'https://kite.example',
    getWindow: () => null,
    testFeed,
  });

  it('points the updater at the test feed only when one is given', () => {
    vi.useFakeTimers();
    startUpdater(options(null));
    expect(updater.setFeedURL).not.toHaveBeenCalled();
    startUpdater(options('http://127.0.0.1:8765/'));
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'http://127.0.0.1:8765/',
      useMultipleRangeRequest: false,
    });
    vi.useRealTimers();
  });
});

describe('nextUpdateStep', () => {
  it('asks only after a download, outside a call, once', () => {
    expect(nextUpdateStep({ downloaded: false, callActive: false, asked: false })).toBe('none');
    expect(nextUpdateStep({ downloaded: true, callActive: false, asked: false })).toBe('ask');
    expect(nextUpdateStep({ downloaded: true, callActive: false, asked: true })).toBe('none');
  });

  it('waits while a call is live', () => {
    expect(nextUpdateStep({ downloaded: true, callActive: true, asked: false })).toBe('wait');
  });

  it('1.7.2 (ADR-0106): waits while Drive uploads are left, and asks once they are done', () => {
    expect(
      nextUpdateStep({ downloaded: true, callActive: false, asked: false, uploading: true }),
    ).toBe('wait');
    expect(
      nextUpdateStep({ downloaded: true, callActive: false, asked: false, uploading: false }),
    ).toBe('ask');
  });

  it('checks every 6 hours', () => {
    expect(CHECK_EVERY_MS).toBe(21_600_000);
  });
});

describe('Check for Updates… (Mac 1.8.1 / Windows 1.7.5)', () => {
  /**
   * Starts an updater with fakes and returns it with its event handlers.
   *
   * @returns The updater, the handlers by event name, and the call-active IPC handler.
   */
  const start = () => {
    vi.useFakeTimers();
    updater.on.mockClear();
    const ipcOn = vi.fn();
    const started = startUpdater({
      ipcMain: { on: ipcOn } as never,
      allowedOrigin: 'https://kite.example',
      getWindow: () => null,
    });
    const handlers = new Map<string, (info: { version: string }) => void>(
      updater.on.mock.calls.map(([name, fn]) => [name as string, fn as never]),
    );
    const callActive = ipcOn.mock.calls[0]![1] as (event: unknown, on: boolean) => void;
    vi.useRealTimers();
    return { started, handlers, callActive };
  };

  it('says up to date, downloading (with the version), failed, or not available here', async () => {
    const { started } = start();
    updater.checkForUpdates.mockResolvedValueOnce({
      isUpdateAvailable: false,
      updateInfo: { version: '1.8.0' },
    });
    expect(await started.checkNow()).toBe('up-to-date');
    updater.checkForUpdates.mockResolvedValueOnce({
      isUpdateAvailable: true,
      updateInfo: { version: '1.8.1' },
    });
    expect(await started.checkNow()).toBe('downloading');
    expect(started.foundVersion()).toBe('1.8.1');
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    expect(await started.checkNow()).toBe('failed');
    updater.checkForUpdates.mockResolvedValueOnce(null);
    expect(await started.checkNow()).toBe('unavailable');
  });

  it('asks Restart now / Later again for a downloaded update, but not during a call', async () => {
    const { started, handlers, callActive } = start();
    const senderFrame = { url: 'https://kite.example/live/s1', parent: null };
    callActive({ senderFrame }, true);
    dialogs.showMessageBox.mockClear();
    handlers.get('update-downloaded')!({ version: '1.8.1' });
    expect(dialogs.showMessageBox).not.toHaveBeenCalled();
    expect(await started.checkNow()).toBe('ready-later');
    expect(dialogs.showMessageBox).not.toHaveBeenCalled();
    // The call ends: the question comes (Later is answered in this fake), and a manual check asks again.
    callActive({ senderFrame }, false);
    expect(dialogs.showMessageBox).toHaveBeenCalledTimes(1);
    expect(await started.checkNow()).toBe('ready');
    expect(dialogs.showMessageBox).toHaveBeenCalledTimes(2);
    expect(updater.checkForUpdates).not.toHaveBeenCalledWith(expect.anything());
  });

  it('has the words for each outcome, and none for the restart question', () => {
    expect(manualCheckReply('up-to-date', { current: '1.8.1' })).toEqual({
      message: "You're up to date",
      detail: 'Paramount AI 1.8.1 is the newest version.',
    });
    expect(manualCheckReply('downloading', { current: '1.7.4', next: '1.7.5' })?.message).toBe(
      'Downloading Paramount AI 1.7.5',
    );
    expect(manualCheckReply('downloading', { current: '1.7.4' })?.detail).toMatch(
      /never during a call/,
    );
    expect(manualCheckReply('ready-later', { current: '1.8.0', next: '1.8.1' })?.detail).toMatch(
      /when your call ends/,
    );
    expect(manualCheckReply('failed', { current: '1.8.1' })?.message).toBe(
      'Could not check for updates',
    );
    expect(manualCheckReply('unavailable', { current: '1.8.1' })?.message).toBe(
      'Updates are not checked here',
    );
    expect(manualCheckReply('ready', { current: '1.8.1' })).toBeNull();
  });
});

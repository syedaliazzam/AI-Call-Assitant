/**
 * Tests for apps/desktop/src/updater.ts (Day 6 Stage 3): nextUpdateStep() asks to restart only
 * when an update has downloaded, no call is live and the user has not been asked yet; during a
 * call it waits. 1.7.2 (ADR-0106): it also waits while Drive uploads are left. 1.8.0 (ADR-0109):
 * testUpdateFeed() accepts only an http:// feed on this computer, and startUpdater() uses it.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '1.8.0' }, dialog: {} }));
const updater = vi.hoisted(() => ({
  setFeedURL: vi.fn(),
  on: vi.fn(),
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('electron-updater', () => ({ autoUpdater: updater }));

const { CHECK_EVERY_MS, nextUpdateStep, startUpdater, testUpdateFeed } =
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

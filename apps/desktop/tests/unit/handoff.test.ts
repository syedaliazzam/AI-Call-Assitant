/**
 * Tests apps/desktop/src/handoff.ts (spec S9, option B): links in the command line, when the protocol is
 * registered, and the file calls: only the Kite page may use them, and the only file that can be deleted
 * is the one picked in the system's dialog, once.
 */
import { describe, expect, it, vi } from 'vitest';
import { HANDOFF_DELETE_CHANNEL, HANDOFF_PICK_CHANNEL } from '../../src/channels';
import {
  installHandoff,
  linkFromArgv,
  MAX_HANDOFF_BYTES,
  shouldRegisterProtocol,
} from '../../src/handoff';

vi.mock('electron', () => ({}));

/** A valid session id. */
const ID = '86495cda-fbd1-4cea-8387-cd29f5c1381b';

/** The Kite origin in these tests. */
const ORIGIN = 'https://kite.test';

/** A call from the Kite page. */
const KITE = { senderFrame: { url: `${ORIGIN}/home`, parent: null } };

/** A call from somewhere else. */
const OTHER = { senderFrame: { url: 'https://evil.example/', parent: null } };

/**
 * Installs the calls with fakes.
 *
 * @param chosen What the system's dialog answers.
 * @param size   The file's size.
 * @returns The two calls and the fakes.
 */
function setup(chosen: { canceled: boolean; filePaths: string[] }, size = 100) {
  const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
  const files = {
    size: vi.fn(async () => size),
    read: vi.fn(async () => 'FILE-TEXT'),
    remove: vi.fn(async () => undefined),
  };
  const dialog = { showOpenDialog: vi.fn(async () => chosen) };
  installHandoff({
    ipcMain: {
      handle: (channel: string, handler: (event: unknown) => Promise<unknown>) =>
        handlers.set(channel, handler),
    } as never,
    dialog: dialog as never,
    windowFor: () => null,
    files,
    allowedOrigin: ORIGIN,
  });
  return {
    pick: (event: unknown = KITE) => handlers.get(HANDOFF_PICK_CHANNEL)!(event),
    remove: (event: unknown = KITE) => handlers.get(HANDOFF_DELETE_CHANNEL)!(event),
    files,
    dialog,
  };
}

describe('linkFromArgv', () => {
  it('finds a valid link among the arguments', () => {
    expect(linkFromArgv(['app.exe', '--flag', `paramountai://session/${ID}`])).toEqual({
      kind: 'session',
      sessionId: ID,
    });
    expect(linkFromArgv(['app.exe', 'paramountai://open'])).toEqual({ kind: 'open' });
  });

  it('ignores anything else, and an invalid link', () => {
    expect(linkFromArgv(['app.exe', '--flag'])).toBeNull();
    expect(linkFromArgv(['app.exe', 'paramountai://session/not-a-uuid'])).toBeNull();
    expect(linkFromArgv(['app.exe', `https://session/${ID}`])).toBeNull();
  });
});

describe('shouldRegisterProtocol', () => {
  it('registers only for an installed app on its own profile', () => {
    expect(shouldRegisterProtocol({ isPackaged: true, hasUserDataDirSwitch: false })).toBe(true);
    // A test run must never change what the person's computer opens.
    expect(shouldRegisterProtocol({ isPackaged: true, hasUserDataDirSwitch: true })).toBe(false);
    expect(shouldRegisterProtocol({ isPackaged: false, hasUserDataDirSwitch: false })).toBe(false);
  });
});

describe('picking a file', () => {
  it('reads the chosen file, in memory', async () => {
    const { pick } = setup({ canceled: false, filePaths: ['C:\\Users\\x\\Downloads\\a.json'] });
    expect(await pick()).toEqual({ name: 'a.json', text: 'FILE-TEXT' });
  });

  it('gives null when the dialog is cancelled', async () => {
    const { pick, files } = setup({ canceled: true, filePaths: [] });
    expect(await pick()).toBeNull();
    expect(files.read).not.toHaveBeenCalled();
  });

  it('does not read a file that is too large', async () => {
    const { pick, files } = setup(
      { canceled: false, filePaths: ['/x/big.json'] },
      MAX_HANDOFF_BYTES + 1,
    );
    expect(await pick()).toEqual({ name: 'big.json', text: '', tooLarge: true });
    expect(files.read).not.toHaveBeenCalled();
  });

  it('refuses any other page', async () => {
    const { pick, dialog } = setup({ canceled: false, filePaths: ['/x/a.json'] });
    await expect(pick(OTHER)).rejects.toThrow('Not for this page');
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  });
});

describe('deleting the file', () => {
  it('deletes only the picked file, and only once', async () => {
    const { pick, remove, files } = setup({ canceled: false, filePaths: ['/x/a.json'] });
    await pick();
    expect(await remove()).toBe(true);
    expect(files.remove).toHaveBeenCalledExactlyOnceWith('/x/a.json');
    expect(await remove()).toBe(false);
    expect(files.remove).toHaveBeenCalledTimes(1);
  });

  it('deletes nothing when nothing was picked, or a too-large file was refused', async () => {
    const first = setup({ canceled: true, filePaths: [] });
    await first.pick();
    expect(await first.remove()).toBe(false);
    expect(first.files.remove).not.toHaveBeenCalled();

    const big = setup({ canceled: false, filePaths: ['/x/big.json'] }, MAX_HANDOFF_BYTES + 1);
    await big.pick();
    expect(await big.remove()).toBe(false);
    expect(big.files.remove).not.toHaveBeenCalled();
  });

  it('refuses any other page, and keeps the path out of the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { pick, remove, files } = setup({ canceled: false, filePaths: ['/secret/a.json'] });
    await pick();
    await expect(remove(OTHER)).rejects.toThrow('Not for this page');
    expect(files.remove).not.toHaveBeenCalled();

    files.remove.mockRejectedValueOnce(new Error('gone'));
    expect(await remove()).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });
});

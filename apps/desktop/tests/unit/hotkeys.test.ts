/**
 * Tests for apps/desktop/src/hotkeys.ts, with Electron's globalShortcut and ipcMain faked:
 * createHotkeys() registers the §7.3 defaults, forwards a press to the page as its action,
 * reports a shortcut another app holds as not registered, releases only what it registered,
 * and re-enabling does not register twice; isKiteSender() accepts only the Kite page's main
 * frame; installHotkeys() turns the shortcuts on and off over IPC for the Kite page, refuses
 * any other sender, and logs only the taken accelerators; overlay shortcuts go to the shell,
 * text-editing keys are never global, and check() finds conflicts without keeping anything.
 */
import { DEFAULT_GLOBAL_HOTKEYS, FOCUSED_HOTKEYS } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import { HOTKEY_CHANNEL, SET_HOTKEYS_CHANNEL } from '../../src/channels';
import { createHotkeys, installHotkeys, isKiteSender } from '../../src/hotkeys';

/** The Kite origin used in these tests. */
const ORIGIN = 'https://kite-call-assistant.vercel.app';

/**
 * A fake globalShortcut: records registrations and lets the test press a shortcut.
 *
 * @param taken Accelerators another app already holds (register returns false).
 * @returns The fake, the registered callbacks and press().
 */
function fakeGlobalShortcut(taken: string[] = []) {
  const callbacks = new Map<string, () => void>();
  const globalShortcut = {
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (taken.includes(accelerator)) return false;
      callbacks.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      callbacks.delete(accelerator);
    }),
  };
  const press = (accelerator: string) => callbacks.get(accelerator)?.();
  return { globalShortcut, callbacks, press };
}

/**
 * An IPC event from a frame.
 *
 * @param url    The frame's URL.
 * @param parent True for a sub-frame.
 * @returns The event.
 */
function eventFrom(url: string, parent = false) {
  return { senderFrame: { url, parent: parent ? {} : null } } as never;
}

describe('createHotkeys', () => {
  it('registers the defaults and forwards a press as its action', () => {
    const { globalShortcut, callbacks, press } = fakeGlobalShortcut();
    const send = vi.fn();
    const hotkeys = createHotkeys(globalShortcut, send);
    const statuses = hotkeys.enable();
    expect(statuses.every((status) => status.registered)).toBe(true);
    expect([...callbacks.keys()].sort()).toEqual(Object.values(DEFAULT_GLOBAL_HOTKEYS).sort());
    press('CommandOrControl+Enter');
    press('CommandOrControl+Alt+Left');
    expect(send.mock.calls).toEqual([['answer'], ['overlay-left']]);
    expect(hotkeys.enabled()).toBe(true);
  });

  it('reports a shortcut another app holds, and never releases it', () => {
    const { globalShortcut } = fakeGlobalShortcut(['CommandOrControl+Alt+H']);
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    const statuses = hotkeys.enable();
    expect(statuses.find((status) => status.action === 'overlay-toggle')).toEqual({
      action: 'overlay-toggle',
      accelerator: 'CommandOrControl+Alt+H',
      registered: false,
    });
    hotkeys.disable();
    expect(globalShortcut.unregister).not.toHaveBeenCalledWith('CommandOrControl+Alt+H');
    expect(globalShortcut.unregister).toHaveBeenCalledTimes(
      Object.keys(DEFAULT_GLOBAL_HOTKEYS).length - 1,
    );
  });

  it('counts an accelerator the OS refuses outright as not registered', () => {
    const globalShortcut = {
      register: vi.fn(() => {
        throw new Error('bad accelerator');
      }),
      unregister: vi.fn(),
    };
    const statuses = createHotkeys(globalShortcut, vi.fn()).enable();
    expect(statuses.some((status) => status.registered)).toBe(false);
  });

  it('releases everything on disable, and re-enabling does not register twice', () => {
    const { globalShortcut, callbacks } = fakeGlobalShortcut();
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    hotkeys.enable();
    hotkeys.enable();
    expect(callbacks.size).toBe(Object.keys(DEFAULT_GLOBAL_HOTKEYS).length);
    hotkeys.disable();
    expect(callbacks.size).toBe(0);
    expect(hotkeys.enabled()).toBe(false);
  });
});

describe('isKiteSender', () => {
  it('accepts only the Kite page’s main frame', () => {
    expect(isKiteSender(eventFrom(`${ORIGIN}/live/s1`), ORIGIN)).toBe(true);
    expect(isKiteSender(eventFrom(`${ORIGIN}/live/s1`, true), ORIGIN)).toBe(false);
    expect(isKiteSender(eventFrom('https://example.com/'), ORIGIN)).toBe(false);
    expect(isKiteSender(eventFrom('not a url'), ORIGIN)).toBe(false);
    expect(isKiteSender({ senderFrame: null } as never, ORIGIN)).toBe(false);
  });
});

describe('installHotkeys', () => {
  it('turns the shortcuts on and off over IPC for the Kite page only', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { globalShortcut, callbacks, press } = fakeGlobalShortcut(['CommandOrControl+Alt+H']);
    const handlers = new Map<string, (event: unknown, on: unknown) => unknown>();
    const ipcMain = { handle: vi.fn((channel: string, fn) => handlers.set(channel, fn)) };
    const sendToPage = vi.fn();
    installHotkeys({ globalShortcut, ipcMain, sendToPage, allowedOrigin: ORIGIN });
    const setHotkeys = handlers.get(SET_HOTKEYS_CHANNEL)!;

    const statuses = (await setHotkeys(eventFrom(`${ORIGIN}/live/s1`), true)) as {
      registered: boolean;
    }[];
    expect(statuses.filter((status) => !status.registered)).toHaveLength(1);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).toContain(
      '"taken":["CommandOrControl+Alt+H"]',
    );
    press('CommandOrControl+Enter');
    expect(sendToPage).toHaveBeenCalledWith(HOTKEY_CHANNEL, 'answer');

    expect(() => setHotkeys(eventFrom('https://example.com/'), false)).toThrow(/Kite page/);
    expect(callbacks.size).toBe(Object.keys(DEFAULT_GLOBAL_HOTKEYS).length - 1);
    expect(await setHotkeys(eventFrom(`${ORIGIN}/`), false)).toEqual([]);
    expect(callbacks.size).toBe(0);
    // Anything but true turns them off.
    await setHotkeys(eventFrom(`${ORIGIN}/`), 'yes');
    expect(callbacks.size).toBe(0);
  });
});

describe('overlay shortcuts and the conflict check (ADR-0029)', () => {
  it('sends the page its actions and the shell the overlay actions', async () => {
    const { globalShortcut, press } = fakeGlobalShortcut();
    const sendToPage = vi.fn();
    const overlayAction = vi.fn();
    const controller = installHotkeys({
      globalShortcut,
      ipcMain: { handle: vi.fn() } as never,
      sendToPage,
      overlayAction,
      allowedOrigin: ORIGIN,
    });
    controller.enable();
    press('CommandOrControl+Enter');
    press('CommandOrControl+Alt+H');
    press('CommandOrControl+Alt+Shift+Up');
    expect(sendToPage.mock.calls).toEqual([[HOTKEY_CHANNEL, 'answer']]);
    expect(overlayAction.mock.calls).toEqual([['overlay-toggle'], ['overlay-up-big']]);
  });

  it('never registers the shortcuts that edit text in other apps', () => {
    const accelerators = Object.values(DEFAULT_GLOBAL_HOTKEYS);
    for (const text of Object.values(FOCUSED_HOTKEYS)) expect(accelerators).not.toContain(text);
  });

  it('check() finds conflicts outside a call and releases everything again', () => {
    const { globalShortcut, callbacks } = fakeGlobalShortcut(['CommandOrControl+Alt+H']);
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    const statuses = hotkeys.check();
    expect(statuses.filter((status) => !status.registered).map((s) => s.action)).toEqual([
      'overlay-toggle',
    ]);
    expect(hotkeys.enabled()).toBe(false);
    expect(globalShortcut.unregister).toHaveBeenCalledTimes(statuses.length - 1);
    void callbacks;
  });

  it('check() during a call reports the current state and leaves the shortcuts on', () => {
    const { globalShortcut } = fakeGlobalShortcut();
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    const statuses = hotkeys.enable();
    expect(hotkeys.check()).toBe(statuses);
    expect(hotkeys.enabled()).toBe(true);
    expect(globalShortcut.unregister).not.toHaveBeenCalled();
  });
});

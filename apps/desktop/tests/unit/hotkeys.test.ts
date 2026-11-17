/**
 * Tests for apps/desktop/src/hotkeys.ts, with Electron's globalShortcut and ipcMain faked:
 * createHotkeys() registers the §7.3 defaults, forwards a press to the page as its action,
 * reports a shortcut another app holds as not registered, releases only what it registered,
 * and re-enabling does not register twice; isKiteSender() accepts only the Kite page's main
 * frame; installHotkeys() turns the shortcuts on and off over IPC for the Kite page, refuses
 * any other sender, and logs only the taken accelerators; overlay shortcuts go to the shell,
 * and check() finds conflicts without keeping anything. 1.6.4 (ADR-0082): the screenshot and voice
 * question, Clear answers, Clear transcript, previous / next answer and the zoom keys are held during a
 * call and released at End; setChatSend() only reports Ctrl+Alt+Enter; Escape is held only while a voice
 * question listens during a call (setVoiceCancel and its IPC channel).
 */
import {
  ASK_KITE_HOTKEY,
  DEFAULT_GLOBAL_HOTKEYS,
  FOCUSED_HOTKEYS,
  SCREENSHOT_SEND_HOTKEY,
  VOICE_CANCEL_HOTKEY,
} from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  HOTKEY_CHANNEL,
  SET_HOTKEYS_CHANNEL,
  VOICE_CANCEL_HOTKEY_CHANNEL,
} from '../../src/channels';
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
    // ADR-0095 (1.7.0): Ctrl+Shift+Left jumps a spot (Ctrl+Alt+Left from 1.3.0 to 1.6.5); the nudge is Ctrl+Alt+Shift+Left.
    press('CommandOrControl+Shift+Left');
    press('CommandOrControl+Alt+Shift+Left');
    expect(send.mock.calls).toEqual([['answer'], ['overlay-spot-left'], ['overlay-left']]);
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
    // Every call shortcut but the taken one, and Ask Kite, which is held for as long as the app runs.
    expect(callbacks.size).toBe(Object.keys(DEFAULT_GLOBAL_HOTKEYS).length);
    expect(await setHotkeys(eventFrom(`${ORIGIN}/`), false)).toEqual([]);
    expect([...callbacks.keys()]).toEqual([ASK_KITE_HOTKEY]);
    // Anything but true turns them off.
    await setHotkeys(eventFrom(`${ORIGIN}/`), 'yes');
    expect([...callbacks.keys()]).toEqual([ASK_KITE_HOTKEY]);
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
    press('CommandOrControl+Shift+Down');
    // v1.0.2 (ADR-0035): the script bar goes to the page, which decides what the overlay shows.
    press('CommandOrControl+Alt+S');
    // v1.3.2: Click-through goes to the page too: the live page holds the switch.
    press('CommandOrControl+Alt+X');
    expect(sendToPage.mock.calls).toEqual([
      [HOTKEY_CHANNEL, 'answer'],
      [HOTKEY_CHANNEL, 'script-bar'],
      [HOTKEY_CHANNEL, 'click-through'],
    ]);
    expect(overlayAction.mock.calls).toEqual([
      ['overlay-toggle'],
      ['overlay-up'],
      ['overlay-row-bottom'],
    ]);
  });

  it('registers the script bar only during a call, and reports it when taken (v1.0.2)', () => {
    const { globalShortcut } = fakeGlobalShortcut();
    const controller = createHotkeys(globalShortcut, vi.fn());
    expect(controller.check().find((s) => s.action === 'script-bar')).toMatchObject({
      accelerator: 'CommandOrControl+Alt+S',
    });
    const statuses = controller.enable();
    expect(statuses.find((s) => s.action === 'script-bar')?.registered).toBe(true);
    controller.disable();
    expect(globalShortcut.unregister).toHaveBeenCalledWith('CommandOrControl+Alt+S');
  });

  it('v1.3.2: Click-through is Ctrl+Alt+X, clashing with no other Kite shortcut', () => {
    const { globalShortcut } = fakeGlobalShortcut();
    const controller = createHotkeys(globalShortcut, vi.fn());
    const statuses = controller.enable();
    expect(statuses.find((s) => s.action === 'click-through')).toMatchObject({
      accelerator: 'CommandOrControl+Alt+X',
      registered: true,
    });
    const all = statuses.map((s) => s.accelerator);
    expect(new Set(all).size).toBe(all.length);
    expect(controller.check().map((s) => s.accelerator)).not.toContain(undefined);
  });

  it('1.6.4 (ADR-0082): the focused keys are held during a call too, with the same keys', () => {
    // Until 1.6.3 these keys were never global; the developer chose to hold them during a call
    // (ParakeetAI parity). The page still handles them itself while Kite has focus.
    const accelerators = Object.values(DEFAULT_GLOBAL_HOTKEYS);
    for (const text of Object.values(FOCUSED_HOTKEYS)) expect(accelerators).toContain(text);
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

  it('holds Ctrl+Shift+Arrows for the jumps only during a call, and releases them at End (1.7.0, ADR-0095)', () => {
    // v1.3.0 to 1.6.5 never held them (they select text by word in other apps); the developer moved the
    // jumps there in 1.7.0, so they must never outlive the call.
    const { globalShortcut, callbacks } = fakeGlobalShortcut();
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    expect(callbacks.has('CommandOrControl+Shift+Left')).toBe(false);
    hotkeys.enable();
    for (const arrow of ['Up', 'Down', 'Left', 'Right']) {
      expect(callbacks.has(`CommandOrControl+Shift+${arrow}`)).toBe(true);
      expect(Object.values(DEFAULT_GLOBAL_HOTKEYS)).not.toContain(`CommandOrControl+Alt+${arrow}`);
    }
    hotkeys.disable();
    for (const arrow of ['Up', 'Down', 'Left', 'Right']) {
      expect(callbacks.has(`CommandOrControl+Shift+${arrow}`)).toBe(false);
    }
  });

  it('check() also tries Transcript (Ctrl+Alt+T) for a moment, and reports another app holding it', () => {
    const free = fakeGlobalShortcut();
    const freeStatus = createHotkeys(free.globalShortcut, vi.fn())
      .check()
      .find((status) => status.action === 'transcript');
    expect(freeStatus).toEqual({
      action: 'transcript',
      accelerator: 'CommandOrControl+Alt+T',
      registered: true,
    });
    expect(free.globalShortcut.unregister).toHaveBeenCalledWith('CommandOrControl+Alt+T');
    const taken = fakeGlobalShortcut(['CommandOrControl+Alt+T']);
    expect(
      createHotkeys(taken.globalShortcut, vi.fn())
        .check()
        .find((status) => status.action === 'transcript')?.registered,
    ).toBe(false);
  });

  it('check() during a call reports the current state and leaves the shortcuts on', () => {
    const { globalShortcut } = fakeGlobalShortcut();
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    const statuses = hotkeys.enable();
    expect(hotkeys.check().slice(0, statuses.length)).toEqual(statuses);
    expect(hotkeys.enabled()).toBe(true);
    // Only the moment's try (Transcript's keys) was released; the call's shortcuts stay, Ctrl+Alt+Enter
    // among them (1.6.4, ADR-0082).
    expect(globalShortcut.unregister.mock.calls).toEqual([['CommandOrControl+Alt+T']]);
  });
});

describe('the call keys added in 1.6.4 (ADR-0082)', () => {
  /** The shortcuts that became global during a call in 1.6.4, in the order the test presses them. */
  const ADDED = [
    SCREENSHOT_SEND_HOTKEY,
    'CommandOrControl+Backspace',
    'CommandOrControl+Shift+Backspace',
    'CommandOrControl+Left',
    'CommandOrControl+Right',
    'CommandOrControl+=',
    'CommandOrControl+-',
    'CommandOrControl+0',
  ];

  it('are registered during a call, reach the page, and are released at End', () => {
    const { globalShortcut, callbacks, press } = fakeGlobalShortcut();
    const send = vi.fn();
    const hotkeys = createHotkeys(globalShortcut, send);
    // Not before a call: they edit text in other apps.
    for (const keys of ADDED) expect(callbacks.has(keys)).toBe(false);
    hotkeys.enable();
    for (const keys of ADDED) expect(callbacks.has(keys)).toBe(true);
    for (const keys of ADDED) press(keys);
    expect(send.mock.calls).toEqual([
      ['screenshot-send'],
      ['clear'],
      ['clear-transcript'],
      ['prev'],
      ['next'],
      ['zoom-in'],
      ['zoom-out'],
      ['zoom-reset'],
    ]);
    hotkeys.disable();
    for (const keys of ADDED) {
      expect(callbacks.has(keys)).toBe(false);
      expect(globalShortcut.unregister).toHaveBeenCalledWith(keys);
    }
  });

  it('Settings can see a Ctrl+Alt+Enter clash before a call; the keys are not kept', () => {
    const { globalShortcut, callbacks } = fakeGlobalShortcut();
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    const found = hotkeys.check().filter((status) => status.action === 'screenshot-send');
    // Reported once, with the other call shortcuts.
    expect(found).toEqual([
      { action: 'screenshot-send', accelerator: SCREENSHOT_SEND_HOTKEY, registered: true },
    ]);
    expect(globalShortcut.unregister).toHaveBeenCalledWith(SCREENSHOT_SEND_HOTKEY);
    expect(callbacks.has(SCREENSHOT_SEND_HOTKEY)).toBe(false);
  });
});

describe('setChatSend (spec S14; 1.6.4, ADR-0082: it only reports)', () => {
  it('reports the call’s Ctrl+Alt+Enter status without registering anything', () => {
    const { globalShortcut } = fakeGlobalShortcut([SCREENSHOT_SEND_HOTKEY]);
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    // Not during a call: nothing to report, nothing registered.
    expect(hotkeys.setChatSend(true)).toBeNull();
    expect(globalShortcut.register).not.toHaveBeenCalled();

    hotkeys.enable();
    const registerCalls = globalShortcut.register.mock.calls.length;
    // The status enable() found; here another app holds the keys.
    expect(hotkeys.setChatSend(true)).toEqual({
      action: 'screenshot-send',
      accelerator: SCREENSHOT_SEND_HOTKEY,
      registered: false,
    });
    expect(hotkeys.setChatSend(false)).toBeNull();
    expect(globalShortcut.register.mock.calls.length).toBe(registerCalls);
    expect(globalShortcut.unregister).not.toHaveBeenCalled();
  });

  it('turning it off keeps Ctrl+Alt+Enter held for the rest of the call', () => {
    const { globalShortcut, callbacks } = fakeGlobalShortcut();
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    hotkeys.enable();
    expect(hotkeys.setChatSend(true)?.registered).toBe(true);
    hotkeys.setChatSend(false);
    expect(callbacks.has(SCREENSHOT_SEND_HOTKEY)).toBe(true);
    hotkeys.disable();
    expect(callbacks.has(SCREENSHOT_SEND_HOTKEY)).toBe(false);
  });
});

describe('Escape while a voice question listens (1.6.4, ADR-0082)', () => {
  it('is held only during a call, only while asked, and reaches the page', () => {
    const { globalShortcut, callbacks, press } = fakeGlobalShortcut();
    const send = vi.fn();
    const hotkeys = createHotkeys(globalShortcut, send);
    // Not during a call: a late message must not take Escape from other apps.
    expect(hotkeys.setVoiceCancel(true)).toBeNull();
    expect(callbacks.has(VOICE_CANCEL_HOTKEY)).toBe(false);
    // Not one of the call's shortcuts either.
    hotkeys.enable();
    expect(callbacks.has(VOICE_CANCEL_HOTKEY)).toBe(false);

    expect(hotkeys.setVoiceCancel(true)).toEqual({
      action: 'voice-cancel',
      accelerator: VOICE_CANCEL_HOTKEY,
      registered: true,
    });
    press(VOICE_CANCEL_HOTKEY);
    expect(send).toHaveBeenCalledWith('voice-cancel');
    expect(hotkeys.setVoiceCancel(false)).toBeNull();
    expect(callbacks.has(VOICE_CANCEL_HOTKEY)).toBe(false);
    // The call's shortcuts stay.
    expect(hotkeys.enabled()).toBe(true);
    expect(callbacks.has(DEFAULT_GLOBAL_HOTKEYS.answer)).toBe(true);
  });

  it('asking twice registers it once, and disable() releases it', () => {
    const { globalShortcut, callbacks } = fakeGlobalShortcut();
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    hotkeys.enable();
    hotkeys.setVoiceCancel(true);
    hotkeys.setVoiceCancel(true);
    const calls = globalShortcut.register.mock.calls.filter(
      ([keys]) => keys === VOICE_CANCEL_HOTKEY,
    );
    expect(calls).toHaveLength(1);
    hotkeys.disable();
    expect(globalShortcut.unregister).toHaveBeenCalledWith(VOICE_CANCEL_HOTKEY);
    expect(callbacks.has(VOICE_CANCEL_HOTKEY)).toBe(false);
  });

  it('reports Escape held by another app, and never releases it', () => {
    const { globalShortcut } = fakeGlobalShortcut([VOICE_CANCEL_HOTKEY]);
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    hotkeys.enable();
    expect(hotkeys.setVoiceCancel(true)?.registered).toBe(false);
    hotkeys.setVoiceCancel(false);
    hotkeys.disable();
    expect(globalShortcut.unregister).not.toHaveBeenCalledWith(VOICE_CANCEL_HOTKEY);
  });

  it('is turned on and off over IPC by the Kite page only', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { globalShortcut, callbacks } = fakeGlobalShortcut();
    const handlers = new Map<string, (event: unknown, on: unknown) => unknown>();
    const ipcMain = { handle: vi.fn((channel: string, fn) => handlers.set(channel, fn)) };
    installHotkeys({ globalShortcut, ipcMain, sendToPage: vi.fn(), allowedOrigin: ORIGIN });
    await handlers.get(SET_HOTKEYS_CHANNEL)!(eventFrom(`${ORIGIN}/live/s1`), true);
    const setVoiceCancel = handlers.get(VOICE_CANCEL_HOTKEY_CHANNEL)!;

    expect(() => setVoiceCancel(eventFrom('https://example.com/'), true)).toThrow(/Kite page/);
    expect(callbacks.has(VOICE_CANCEL_HOTKEY)).toBe(false);
    // Anything but true counts as off.
    await setVoiceCancel(eventFrom(`${ORIGIN}/live/s1`), 'yes');
    expect(callbacks.has(VOICE_CANCEL_HOTKEY)).toBe(false);
    await setVoiceCancel(eventFrom(`${ORIGIN}/live/s1`), true);
    expect(callbacks.has(VOICE_CANCEL_HOTKEY)).toBe(true);
    await setVoiceCancel(eventFrom(`${ORIGIN}/live/s1`), false);
    expect(callbacks.has(VOICE_CANCEL_HOTKEY)).toBe(false);
  });
});

describe('the Ask Kite shortcut (ADR-0030)', () => {
  it('is held from the start, outside any call, and reaches the page in view', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { globalShortcut, press } = fakeGlobalShortcut();
    const sendToPage = vi.fn();
    const showForAskKite = vi.fn();
    const hotkeys = installHotkeys({
      globalShortcut,
      ipcMain: { handle: vi.fn() },
      sendToPage,
      showForAskKite,
      allowedOrigin: ORIGIN,
    });
    expect(hotkeys.enabled()).toBe(false);
    press(ASK_KITE_HOTKEY);
    expect(showForAskKite).toHaveBeenCalledOnce();
    expect(sendToPage).toHaveBeenCalledWith(HOTKEY_CHANNEL, 'ask-kite');
  });

  it('survives the end of a call, and goes when the app quits', () => {
    const { globalShortcut, callbacks } = fakeGlobalShortcut();
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    hotkeys.enableAskKite();
    hotkeys.enable();
    hotkeys.disable();
    expect([...callbacks.keys()]).toEqual([ASK_KITE_HOTKEY]);
    hotkeys.releaseAll();
    expect(callbacks.size).toBe(0);
  });

  it('reports a clash in the conflict check, without giving up the key', () => {
    const { globalShortcut, callbacks } = fakeGlobalShortcut([ASK_KITE_HOTKEY]);
    const hotkeys = createHotkeys(globalShortcut, vi.fn());
    expect(hotkeys.enableAskKite().registered).toBe(false);
    const found = hotkeys.check().find((status) => status.action === 'ask-kite');
    expect(found?.registered).toBe(false);

    const free = fakeGlobalShortcut();
    const other = createHotkeys(free.globalShortcut, vi.fn());
    other.enableAskKite();
    expect(other.check().find((status) => status.action === 'ask-kite')?.registered).toBe(true);
    expect(free.callbacks.has(ASK_KITE_HOTKEY)).toBe(true);
    expect(callbacks.has(ASK_KITE_HOTKEY)).toBe(false);
  });
});

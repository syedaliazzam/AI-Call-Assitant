/**
 * Tests for apps/desktop/src/preload.ts, with the `electron` module mocked:
 * the version is read from the --kite-version argument, platforms map to mac/windows/linux,
 * and exactly one frozen object { version, os, setHotkeysEnabled, onHotkey } is exposed as
 * `kiteDesktop`; setHotkeysEnabled sends only a boolean on its fixed channel; onHotkey passes
 * only valid actions to the page (never the IPC event) and stops when asked.
 */
import { describe, expect, it, vi } from 'vitest';

/** Spy standing in for contextBridge.exposeInMainWorld. */
const exposeInMainWorld = vi.fn();
/** Listeners added with ipcRenderer.on, by channel. */
const listeners = new Map<string, Set<(event: unknown, value: unknown) => void>>();
/** Messages sent with ipcRenderer.send, in order: [channel, value]. */
const sent: [string, unknown][] = [];

/** Stand-in for ipcRenderer. */
const ipcRenderer = {
  invoke: vi.fn(async () => []),
  /** Fire-and-forget messages (Day 6: setCallActive). */
  send: vi.fn((channel: string, value: unknown) => {
    sent.push([channel, value]);
  }),
  on: vi.fn((channel: string, listener: (event: unknown, value: unknown) => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(listener);
  }),
  removeListener: vi.fn((channel: string, listener: (event: unknown, value: unknown) => void) => {
    listeners.get(channel)?.delete(listener);
  }),
};

vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer }));

const { isHotkeyAction, readVersion, toDesktopOs } = await import('../../src/preload');
const { HOTKEY_CHANNEL, SET_HOTKEYS_CHANNEL } = await import('../../src/channels');

// The preload exposes the bridge once, at import time. Copy that call now, because the
// test runner clears mock history before each test (restoreMocks).
const exposeCalls = [...exposeInMainWorld.mock.calls];

describe('readVersion', () => {
  it('reads the version passed by the main process', () => {
    expect(readVersion(['electron', '--type=renderer', '--kite-version=0.1.0'])).toBe('0.1.0');
  });

  it('falls back to 0.0.0 when the argument is missing', () => {
    expect(readVersion(['electron'])).toBe('0.0.0');
  });
});

describe('toDesktopOs', () => {
  it('maps Node platform names to the bridge OS names', () => {
    expect(toDesktopOs('darwin')).toBe('mac');
    expect(toDesktopOs('win32')).toBe('windows');
    expect(toDesktopOs('linux')).toBe('linux');
  });
});

describe('the exposed bridge', () => {
  it('exposes only kiteDesktop with exactly the bridge methods, frozen', () => {
    expect(exposeCalls).toHaveLength(1);
    const [name, api] = exposeCalls[0]!;
    expect(name).toBe('kiteDesktop');
    expect(Object.keys(api).sort()).toEqual([
      'captureScreenshot',
      'closeCompactView',
      'getShareProtection',
      'onHotkey',
      'openCompactView',
      'os',
      'setCallActive',
      'setHotkeysEnabled',
      'setShareProtection',
      'version',
    ]);
    expect(Object.isFrozen(api)).toBe(true);
  });

  it('setHotkeysEnabled sends only a boolean on its channel', async () => {
    const [, api] = exposeCalls[0]!;
    await api.setHotkeysEnabled(true);
    await api.setHotkeysEnabled('yes');
    expect(ipcRenderer.invoke.mock.calls).toEqual([
      [SET_HOTKEYS_CHANNEL, true],
      [SET_HOTKEYS_CHANNEL, false],
    ]);
  });

  it('onHotkey passes only valid actions, without the IPC event, until stopped', () => {
    const [, api] = exposeCalls[0]!;
    const handler = vi.fn();
    const stop = api.onHotkey(handler);
    const emit = (value: unknown) => {
      for (const listener of listeners.get(HOTKEY_CHANNEL) ?? []) listener({ sender: 'x' }, value);
    };
    emit('answer');
    emit('format-disk');
    emit({ action: 'answer' });
    expect(handler.mock.calls).toEqual([['answer']]);
    stop();
    emit('next');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('isHotkeyAction', () => {
  it('accepts the five actions only', () => {
    for (const action of ['answer', 'screenshot', 'clear', 'prev', 'next']) {
      expect(isHotkeyAction(action)).toBe(true);
    }
    expect(isHotkeyAction('ANSWER')).toBe(false);
    expect(isHotkeyAction(1)).toBe(false);
  });

  it('setCallActive sends only a boolean on its channel (Day 6)', () => {
    const [, api] = exposeCalls[0]!;
    (api as { setCallActive: (active: unknown) => void }).setCallActive('yes');
    expect(sent.at(-1)).toEqual(['kite:call-active', false]);
    (api as { setCallActive: (active: unknown) => void }).setCallActive(true);
    expect(sent.at(-1)).toEqual(['kite:call-active', true]);
  });
});

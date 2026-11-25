/**
 * Tests for apps/desktop/src/macPermissions.ts (desktop 1.8.0, ADR-0111), with Electron faked: on macOS
 * it reads both permissions (an unexpected answer becomes 'unknown'), asks for the microphone with macOS's
 * own question and for screen recording by listing the screens, opens only the two System Settings pages,
 * and quits and reopens on request; the page's requests are answered for the Kite page only and only for
 * the two permissions; on Windows every answer is null and nothing is opened; the start-up log holds the
 * two words only.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MAC_PERMISSIONS_CHANNEL,
  MAC_PERMISSION_REQUEST_CHANNEL,
  MAC_PRIVACY_SETTINGS_CHANNEL,
  RELAUNCH_CHANNEL,
} from '../../src/channels';
import {
  installMacPermissions,
  isMacPermissionKind,
  logMacPermissions,
  MAC_PRIVACY_PAGES,
  readMacPermissions,
  requestMacPermission,
  type MacPermissionDeps,
} from '../../src/macPermissions';

/** The Kite origin used in these tests. */
const ORIGIN = 'https://kite-call-assistant.vercel.app';

/**
 * Fake Electron pieces.
 *
 * @param platform The OS.
 * @param status   What macOS answers for each permission.
 * @returns The dependencies and their mocks.
 */
function fakeDeps(
  platform: NodeJS.Platform = 'darwin',
  status: Record<string, string> = { microphone: 'granted', screen: 'not-determined' },
) {
  const deps = {
    platform,
    systemPreferences: {
      getMediaAccessStatus: vi.fn((kind: string) => status[kind]),
      askForMediaAccess: vi.fn(async () => {
        status.microphone = 'granted';
        return true;
      }),
    },
    desktopCapturer: { getSources: vi.fn(async () => []) },
    openExternal: vi.fn(async () => undefined),
    relaunch: vi.fn(),
  };
  return deps as typeof deps & MacPermissionDeps;
}

/**
 * An IPC event from a frame.
 *
 * @param url The frame's URL.
 * @returns The event.
 */
function eventFrom(url: string) {
  return { senderFrame: { url, parent: null } } as never;
}

describe('readMacPermissions', () => {
  it('reads both on macOS, and is null on Windows', () => {
    expect(readMacPermissions(fakeDeps())).toEqual({
      microphone: 'granted',
      screen: 'not-determined',
    });
    expect(readMacPermissions(fakeDeps('win32'))).toBeNull();
  });

  it('reports an answer it does not know as unknown', () => {
    expect(readMacPermissions(fakeDeps('darwin', { microphone: 'odd', screen: 'denied' }))).toEqual(
      {
        microphone: 'unknown',
        screen: 'denied',
      },
    );
  });
});

describe('requestMacPermission', () => {
  it('asks macOS for the microphone with its own question', async () => {
    const deps = fakeDeps('darwin', { microphone: 'not-determined', screen: 'granted' });
    expect(await requestMacPermission(deps, 'microphone')).toEqual({
      microphone: 'granted',
      screen: 'granted',
    });
    expect(deps.systemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');
    expect(deps.desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it('lists the screens for screen recording (macOS adds the app and asks), and survives a refusal', async () => {
    const deps = fakeDeps();
    deps.desktopCapturer.getSources.mockRejectedValueOnce(new Error('denied'));
    expect(await requestMacPermission(deps, 'screen')).toEqual({
      microphone: 'granted',
      screen: 'not-determined',
    });
    expect(deps.desktopCapturer.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
  });

  it('does nothing on Windows', async () => {
    const deps = fakeDeps('win32');
    expect(await requestMacPermission(deps, 'microphone')).toBeNull();
    expect(deps.systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
  });
});

describe('installMacPermissions', () => {
  /**
   * Installs the handlers on a fake ipcMain.
   *
   * @param deps The fake Electron pieces.
   * @returns The handlers by channel.
   */
  const install = (deps: MacPermissionDeps) => {
    const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
    installMacPermissions(
      { handle: (channel: string, handler: never) => handlers.set(channel, handler) } as never,
      deps,
      ORIGIN,
    );
    return handlers;
  };

  it('answers the Kite page: state, request, System Settings, quit and reopen', async () => {
    const deps = fakeDeps();
    const handlers = install(deps);
    const kite = eventFrom(`${ORIGIN}/home`);
    expect(handlers.get(MAC_PERMISSIONS_CHANNEL)!(kite)).toEqual({
      microphone: 'granted',
      screen: 'not-determined',
    });
    await handlers.get(MAC_PERMISSION_REQUEST_CHANNEL)!(kite, 'screen');
    expect(deps.desktopCapturer.getSources).toHaveBeenCalled();
    await handlers.get(MAC_PRIVACY_SETTINGS_CHANNEL)!(kite, 'screen');
    expect(deps.openExternal).toHaveBeenCalledWith(MAC_PRIVACY_PAGES.screen);
    handlers.get(RELAUNCH_CHANNEL)!(kite);
    expect(deps.relaunch).toHaveBeenCalledTimes(1);
  });

  it('refuses other pages and anything but the two permissions', async () => {
    const deps = fakeDeps();
    const handlers = install(deps);
    const other = eventFrom('https://example.com/');
    expect(() => handlers.get(MAC_PERMISSIONS_CHANNEL)!(other)).toThrow();
    expect(() => handlers.get(RELAUNCH_CHANNEL)!(other)).toThrow();
    expect(() =>
      handlers.get(MAC_PERMISSION_REQUEST_CHANNEL)!(eventFrom(`${ORIGIN}/`), 'camera'),
    ).toThrow('Not a permission');
    await expect(
      handlers.get(MAC_PRIVACY_SETTINGS_CHANNEL)!(eventFrom(`${ORIGIN}/`), 'https://evil.example'),
    ).rejects.toThrow('Not a permission');
    expect(deps.openExternal).not.toHaveBeenCalled();
    expect(deps.relaunch).not.toHaveBeenCalled();
  });

  it('opens nothing on Windows', async () => {
    const deps = fakeDeps('win32');
    await install(deps).get(MAC_PRIVACY_SETTINGS_CHANNEL)!(eventFrom(`${ORIGIN}/`), 'microphone');
    expect(deps.openExternal).not.toHaveBeenCalled();
  });
});

describe('the rest', () => {
  it('opens only System Settings privacy pages', () => {
    for (const url of Object.values(MAC_PRIVACY_PAGES)) {
      expect(
        url.startsWith('x-apple.systempreferences:com.apple.preference.security?Privacy_'),
      ).toBe(true);
    }
  });

  it('knows exactly the two permissions', () => {
    expect(isMacPermissionKind('microphone')).toBe(true);
    expect(isMacPermissionKind('screen')).toBe(true);
    expect(isMacPermissionKind('camera')).toBe(false);
    expect(isMacPermissionKind(undefined)).toBe(false);
  });

  it('logs the two words at start on macOS, and nothing on Windows', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    logMacPermissions(fakeDeps());
    expect(info).toHaveBeenCalledWith('desktop: mac permissions', {
      microphone: 'granted',
      screen: 'not-determined',
    });
    info.mockClear();
    logMacPermissions(fakeDeps('win32'));
    expect(info).not.toHaveBeenCalled();
  });
});

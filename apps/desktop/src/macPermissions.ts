/**
 * File: apps/desktop/src/macPermissions.ts
 * Purpose: The macOS privacy permissions Paramount AI needs (desktop 1.8.0, ADR-0111): the Microphone
 *          ("You") and Screen & System Audio Recording ("Them", screenshots, screen recordings). The page
 *          reads their state, asks macOS for one, opens System Settings at the right page, and quits and
 *          reopens the app (macOS applies a new Screen Recording permission only to a freshly started app).
 *          At start the shell logs both states, the words only, so the real-Mac test can confirm they
 *          survive an update (ADR-0109 §5). On Windows every answer is null and nothing is opened.
 * Used by: src/main.ts (installMacPermissions, logMacPermissions); tests/unit/macPermissions.test.ts
 * Depends on: electron (types: SystemPreferences, DesktopCapturer, IpcMain), src/channels.ts,
 *             src/hotkeys.ts (isKiteSender), @kite/shared (MacPermissionKind, MacPermissionState)
 * Architecture: docs/decisions/ADR-0111-mac-parity.md; ADR-0109 §5
 *
 * Asks nothing by itself: macOS's questions appear only after the person presses a button in the page.
 */
import type { MacPermissionKind, MacPermissionState, MacPermissionStatus } from '@kite/shared';
import type { DesktopCapturer, IpcMain, SystemPreferences } from 'electron';
import {
  MAC_PERMISSIONS_CHANNEL,
  MAC_PERMISSION_REQUEST_CHANNEL,
  MAC_PRIVACY_SETTINGS_CHANNEL,
  RELAUNCH_CHANNEL,
} from './channels';
import { isKiteSender } from './hotkeys';

/**
 * System Settings → Privacy & Security at each permission's page (the addresses macOS 13 to 15 answer).
 * A closed list: the page names a permission, never an address.
 */
export const MAC_PRIVACY_PAGES: Readonly<Record<MacPermissionKind, string>> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

/** What the module needs from Electron (faked in tests). */
export interface MacPermissionDeps {
  /** process.platform. */
  platform: NodeJS.Platform;
  /** Electron's systemPreferences (macOS permission state and the microphone question). */
  systemPreferences: Pick<SystemPreferences, 'getMediaAccessStatus' | 'askForMediaAccess'>;
  /** Electron's desktopCapturer (listing screens is what makes macOS ask for Screen Recording). */
  desktopCapturer: Pick<DesktopCapturer, 'getSources'>;
  /** Opens an address with the system (shell.openExternal). */
  openExternal: (url: string) => Promise<void>;
  /** Quits and reopens the app through the usual exit (app.relaunch(), then app.quit()). */
  relaunch: () => void;
}

/** The states macOS can report; anything else is reported as 'unknown'. */
const KNOWN: readonly MacPermissionStatus[] = ['granted', 'denied', 'restricted', 'not-determined'];

/**
 * Whether a value is one of the two permissions.
 *
 * @param value What the page sent.
 * @returns True for 'microphone' or 'screen'.
 * Called from: installMacPermissions(); tests
 */
export function isMacPermissionKind(value: unknown): value is MacPermissionKind {
  return value === 'microphone' || value === 'screen';
}

/**
 * Both permissions as macOS reports them now.
 *
 * @param deps Electron and the platform.
 * @returns The two states, or null on Windows.
 * Called from: installMacPermissions(), logMacPermissions(); tests
 */
export function readMacPermissions(deps: MacPermissionDeps): MacPermissionState | null {
  if (deps.platform !== 'darwin') return null;
  const read = (kind: MacPermissionKind): MacPermissionStatus => {
    const status = deps.systemPreferences.getMediaAccessStatus(kind) as MacPermissionStatus;
    return KNOWN.includes(status) ? status : 'unknown';
  };
  return { microphone: read('microphone'), screen: read('screen') };
}

/**
 * Asks macOS for one permission. The microphone: macOS's own question when it was never asked (once
 * refused, only System Settings can change it). Screen recording: listing the screens adds Paramount AI to
 * System Settings' list and makes macOS show its prompt the first time; the permission itself is turned on
 * in System Settings and applies after the app is reopened.
 *
 * @param deps Electron and the platform.
 * @param kind The permission.
 * @returns Both states afterwards, or null on Windows.
 * Called from: installMacPermissions(); tests
 */
export async function requestMacPermission(
  deps: MacPermissionDeps,
  kind: MacPermissionKind,
): Promise<MacPermissionState | null> {
  if (deps.platform !== 'darwin') return null;
  if (kind === 'microphone') {
    await deps.systemPreferences.askForMediaAccess('microphone');
  } else {
    // A 1×1 thumbnail is enough: only the listing matters. A refusal or an error changes nothing here.
    await deps.desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      .catch(() => []);
  }
  return readMacPermissions(deps);
}

/**
 * Logs both states at start, the words only (ADR-0109 §5: the real-Mac test checks them after an update).
 *
 * @param deps Electron and the platform.
 * Called from: start() in main.ts (macOS only has anything to log)
 */
export function logMacPermissions(deps: MacPermissionDeps): void {
  const state = readMacPermissions(deps);
  if (state) console.info('desktop: mac permissions', state);
}

/**
 * Answers the page (Kite origin main frames only): the state, a request, System Settings, quit and reopen.
 *
 * @param ipcMain       Electron's ipcMain.
 * @param deps          Electron and the platform.
 * @param allowedOrigin The Kite origin.
 * Called from: start() in main.ts; tests
 */
export function installMacPermissions(
  ipcMain: Pick<IpcMain, 'handle'>,
  deps: MacPermissionDeps,
  allowedOrigin: string,
): void {
  ipcMain.handle(MAC_PERMISSIONS_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can read it');
    return readMacPermissions(deps);
  });
  ipcMain.handle(MAC_PERMISSION_REQUEST_CHANNEL, (event, kind: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can ask');
    if (!isMacPermissionKind(kind)) throw new Error('Not a permission');
    return requestMacPermission(deps, kind);
  });
  ipcMain.handle(MAC_PRIVACY_SETTINGS_CHANNEL, async (event, kind: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can open it');
    if (!isMacPermissionKind(kind)) throw new Error('Not a permission');
    if (deps.platform !== 'darwin') return;
    await deps.openExternal(MAC_PRIVACY_PAGES[kind]);
  });
  ipcMain.handle(RELAUNCH_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can do this');
    console.info('desktop: quit and reopen asked by the page');
    deps.relaunch();
  });
}

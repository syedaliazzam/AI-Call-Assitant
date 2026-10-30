/**
 * File: apps/desktop/src/protection.ts
 * Purpose: Screen-share protection for the compact live window (architecture §4, §7.3):
 *          `setContentProtection` only, applied when the window is created and re-applied every
 *          time it is shown; the user's setting is remembered by the shell (on by default, as
 *          the developer decided on Day 5) and reported to the page with whether this OS
 *          supports it.
 * Used by: src/windows.ts (applies it to the compact window), src/main.ts (IPC)
 * Depends on: electron (BrowserWindow, IpcMain types), src/store.ts, src/channels.ts,
 *             src/hotkeys.ts (isKiteSender)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §4 (screen-share protection), §7.3
 *               (protection.ts), §8; day-05-overlay-screenshots-notes.md Stage 3; ADR-0026
 *
 * What it does and does not do (CLAUDE.md): it only asks the OS not to include the window's
 * pixels in screen captures. The window stays in the taskbar, the Dock and Alt+Tab, and nothing
 * here hides Kite from process lists or tries to evade monitoring or proctoring software.
 * - Windows 10 2004 and later: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE), so captures
 *   leave the window out (older Windows shows a black box instead). It takes effect with the
 *   next desktop composition, not instantly.
 * - macOS: NSWindowSharingNone; apps built on ScreenCaptureKit can still capture the window
 *   (Electron docs). Not verified here (no Mac): a known limit for the Day 6 macOS checks.
 * - Linux: not supported.
 */
import type { ShareProtectionState } from '@kite/shared';
import type { BrowserWindow, IpcMain } from 'electron';
import { GET_PROTECTION_CHANNEL, SET_PROTECTION_CHANNEL } from './channels';
import { isKiteSender } from './hotkeys';
import type { ShellStore } from './store';

/** First Windows 10 build (version 2004) where protected windows are left out of captures. */
export const WINDOWS_EXCLUDE_FROM_CAPTURE_BUILD = 19_041;

/**
 * Whether this OS can hide a window from screen capture.
 *
 * @param platform process.platform.
 * @param release  os.release(), for example '10.0.26200' on Windows.
 * @returns True on Windows 10 2004+ and on macOS; false elsewhere.
 * Called from: createProtection(); tests
 */
export function protectionSupported(platform: string, release: string): boolean {
  if (platform === 'darwin') return true;
  if (platform !== 'win32') return false;
  const build = Number(release.split('.')[2]);
  return Number.isFinite(build) && build >= WINDOWS_EXCLUDE_FROM_CAPTURE_BUILD;
}

/** The protection setting and how to apply it. */
export interface Protection {
  /** The current state (setting and OS support). */
  state(): ShareProtectionState;
  /**
   * Changes the setting, remembers it, and applies it to the window given.
   *
   * @param on     The new setting.
   * @param window The compact window, if open.
   * @returns The new state.
   */
  set(
    on: boolean,
    window: Pick<BrowserWindow, 'setContentProtection'> | null,
  ): ShareProtectionState;
  /**
   * Applies the setting to a window now and every time it is shown.
   *
   * @param window The compact window.
   */
  attach(window: Pick<BrowserWindow, 'setContentProtection' | 'on'>): void;
}

/**
 * Creates the protection controller.
 *
 * @param store    Where the setting is remembered.
 * @param platform process.platform.
 * @param release  os.release().
 * @returns The controller.
 * Called from: start() in main.ts; tests
 */
export function createProtection(store: ShellStore, platform: string, release: string): Protection {
  const supported = protectionSupported(platform, release);
  // On by default (Day 5 decision); the user can turn it off in Settings or the compact view.
  const wanted = () => store.read().shareProtection ?? true;
  const state = (): ShareProtectionState => ({ on: wanted(), supported });
  return {
    state,
    set(on, window) {
      store.write({ shareProtection: on });
      window?.setContentProtection(on);
      return state();
    },
    attach(window) {
      window.setContentProtection(wanted());
      // Re-applied on every show: a hidden and shown window must never come back unprotected.
      window.on('show', () => window.setContentProtection(wanted()));
    },
  };
}

/**
 * Answers the Kite page's protection requests (Kite origin main frames only): read the state,
 * or change it (only a boolean is accepted) and apply it to the compact window if it is open.
 *
 * @param ipcMain       Electron's ipcMain.
 * @param protection    The controller.
 * @param getWindow     The compact window, if open.
 * @param allowedOrigin The Kite origin.
 * Called from: start() in main.ts; tests
 */
export function installProtection(
  ipcMain: Pick<IpcMain, 'handle'>,
  protection: Protection,
  getWindow: () => Pick<BrowserWindow, 'setContentProtection'> | null,
  allowedOrigin: string,
): void {
  ipcMain.handle(GET_PROTECTION_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can read it');
    return protection.state();
  });
  ipcMain.handle(SET_PROTECTION_CHANNEL, (event, on: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    const state = protection.set(on === true, getWindow());
    console.info('desktop: share protection', state);
    return state;
  });
}

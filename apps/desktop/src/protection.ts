/**
 * File: apps/desktop/src/protection.ts
 * Purpose: Screen-share protection for every Kite window (architecture §4, §7.3; all windows from
 *          v1.1.0, ADR-0042): `setContentProtection` only, applied when a window is created and
 *          re-applied every time it is shown and (1.7.1, ADR-0105) resized; the user's setting is remembered by the shell on this
 *          device (off by default: the user turns it on) and reported to the page with whether this
 *          OS supports it.
 * Used by: src/windows.ts (the compact window), src/main.ts (every other window, IPC)
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
   * Changes the setting, remembers it, and applies it to the windows given.
   *
   * @param on      The new setting.
   * @param windows Every open Kite window.
   * @returns The new state.
   */
  set(
    on: boolean,
    windows: readonly Pick<BrowserWindow, 'setContentProtection'>[],
  ): ShareProtectionState;
  /**
   * Applies the setting to a window now and every time it is shown. A window already attached is left
   * as it is (v1.3.0: every window is attached as it is created, and some also by their owner).
   *
   * @param window A Kite window.
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
  // Off by default (Day 5 file); the user turns it on in Settings or the compact view.
  const wanted = () => store.read().shareProtection ?? false;
  const state = (): ShareProtectionState => ({ on: wanted(), supported, scope: 'all' });
  // Windows already attached: one show listener each.
  const attached = new WeakSet<object>();
  return {
    state,
    set(on, windows) {
      store.write({ shareProtection: on });
      for (const window of windows) window.setContentProtection(on);
      return state();
    },
    attach(window) {
      if (attached.has(window)) return;
      attached.add(window);
      window.setContentProtection(wanted());
      // Re-applied on every show: a hidden and shown window must never come back unprotected.
      window.on('show', () => window.setContentProtection(wanted()));
      // 1.7.1 (ADR-0105): and after every resize (the overlay now grows and shrinks with each answer), so
      // a resized window is never left unprotected. Only while it is on: turning it off is set() alone.
      window.on('resize', () => {
        if (wanted()) window.setContentProtection(true);
      });
    },
  };
}

/**
 * Answers the Kite page's protection requests (Kite origin main frames only): read the state,
 * or change it (only a boolean is accepted) and apply it to every open Kite window.
 *
 * @param ipcMain       Electron's ipcMain.
 * @param protection    The controller.
 * @param getWindows    Every open Kite window.
 * @param allowedOrigin The Kite origin.
 * Called from: start() in main.ts; tests
 */
export function installProtection(
  ipcMain: Pick<IpcMain, 'handle'>,
  protection: Protection,
  getWindows: () => readonly Pick<BrowserWindow, 'setContentProtection'>[],
  allowedOrigin: string,
): void {
  ipcMain.handle(GET_PROTECTION_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can read it');
    return protection.state();
  });
  ipcMain.handle(SET_PROTECTION_CHANNEL, (event, on: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    const state = protection.set(on === true, getWindows());
    console.info('desktop: share protection', state);
    return state;
  });
}

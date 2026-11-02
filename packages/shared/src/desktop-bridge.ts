/**
 * File: packages/shared/src/desktop-bridge.ts
 * Purpose: The typed contract between the Electron preload script and the web app: the shape of
 *          `window.kiteDesktop`, which exists only when Kite runs inside the desktop app.
 * Used by: apps/desktop/src/preload.ts (Stage 5, implements it),
 *          apps/web/src/platform/desktop.ts and apps/web/src/platform/index.ts (read it)
 * Depends on: ./hotkeys.ts, ./screenshot.ts (types only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 and §7.3 (preload.ts)
 */
import type { HotkeyAction, HotkeyStatus } from './hotkeys';
import type { DesktopScreenshot } from './screenshot';

/** Operating system the desktop app is running on. */
export type DesktopOs = 'mac' | 'windows' | 'linux';

/**
 * The API the desktop shell exposes to the web page as `window.kiteDesktop`
 * (via Electron's contextBridge; nothing else is exposed).
 *
 * Day 1 has only the two read-only fields below. Later days add methods, roughly:
 * - Day 2: approve system-audio loopback for `getOtherSideStream` (handled in the shell's media.ts).
 * - Day 4: `onHotkey(handler)` for global shortcuts forwarded from the shell.
 * - Day 5: `captureScreenshot()`, `openCompactView(sessionId)`, `setShareProtection(on)`.
 */
export interface KiteDesktopApi {
  /** Version of the desktop shell, for example '0.1.0'. Shown in the sidebar footer (Stage 5). */
  version: string;
  /** Operating system the shell runs on. */
  os: DesktopOs;
  /**
   * Day 4: turns the global shortcuts (architecture §7.3) on or off. The page turns them on
   * only during a live call, because global shortcuts take these keys from every other app
   * (Ctrl+Backspace, Ctrl+← and Ctrl+→ edit text in most apps).
   * Optional: a desktop app installed before Day 4 does not have it.
   *
   * @param on True to register them, false to release them.
   * @returns Whether each shortcut could be registered (another app may already use one).
   */
  setHotkeysEnabled?: (on: boolean) => Promise<HotkeyStatus[]>;
  /**
   * Day 4: listens for the global shortcuts, forwarded from the shell while they are on.
   * Optional: a desktop app installed before Day 4 does not have it.
   *
   * @param handler Called with the action each time a shortcut is pressed (from any app).
   * @returns A function that removes the listener.
   */
  onHotkey?: (handler: (action: HotkeyAction) => void) => () => void;
  /**
   * Day 5: takes a screenshot of the display the Kite window is on (the primary display if
   * that cannot be told), already scaled so its longest side is at most 1,568 px. Never stored
   * or logged by the shell. Optional: a desktop app installed before Day 5 does not have it.
   *
   * @returns The PNG and its size, or why it failed (for example macOS Screen Recording
   *          permission missing).
   */
  captureScreenshot?: () => Promise<DesktopScreenshot>;
  /**
   * Day 5: opens (or brings back) the compact live window for a session: frameless, always on
   * top, shown without taking focus from the meeting, at its last position and size.
   * Optional: a desktop app installed before Day 5 does not have it.
   *
   * @param sessionId The live session's id.
   * @returns Resolves when the window is open.
   */
  openCompactView?: (sessionId: string) => Promise<void>;
  /**
   * Day 5: closes the compact live window (End).
   *
   * @returns Resolves when it is closed (also when none was open).
   */
  closeCompactView?: () => Promise<void>;
  /**
   * Day 5: turns screen-share protection of the compact window on or off
   * (setContentProtection only; the window stays in the taskbar and Alt+Tab). Remembered by
   * the shell.
   *
   * @param on True to hide the compact window from screen capture.
   * @returns The new state, and whether this OS supports it.
   */
  setShareProtection?: (on: boolean) => Promise<ShareProtectionState>;
  /**
   * Day 6: tells the shell whether a live call is going on, so an update never asks to restart
   * during a call.
   *
   * @param active True while connected to a call.
   */
  setCallActive?: (active: boolean) => void;
  /**
   * Day 5: the remembered protection setting.
   *
   * @returns The state, and whether this OS supports it.
   */
  getShareProtection?: () => Promise<ShareProtectionState>;
}

/** Screen-share protection of the compact window (Day 5). */
export interface ShareProtectionState {
  /** True when the user wants the compact window hidden from screen capture. */
  on: boolean;
  /**
   * True when this OS can hide a window from capture at all (Windows 10 2004+ and macOS;
   * on macOS, apps built on ScreenCaptureKit may still capture it).
   */
  supported: boolean;
}

declare global {
  interface Window {
    /**
     * Present only inside the Kite desktop app; undefined in a normal browser.
     * Read it only through apps/web/src/platform (getPlatform / isDesktop).
     */
    kiteDesktop?: KiteDesktopApi;
  }
}

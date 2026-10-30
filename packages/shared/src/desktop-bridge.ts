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

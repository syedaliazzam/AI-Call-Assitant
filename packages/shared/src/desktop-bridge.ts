/**
 * File: packages/shared/src/desktop-bridge.ts
 * Purpose: The typed contract between the Electron preload script and the web app: the shape of
 *          `window.kiteDesktop`, which exists only when Kite runs inside the desktop app.
 * Used by: apps/desktop/src/preload.ts (Stage 5, implements it),
 *          apps/web/src/platform/desktop.ts and apps/web/src/platform/index.ts (read it)
 * Depends on: nothing (types only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 and §7.3 (preload.ts)
 */

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

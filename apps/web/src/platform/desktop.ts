/**
 * File: apps/web/src/platform/desktop.ts
 * Purpose: The Platform implementation used when Kite runs inside the desktop app (Electron).
 *          It wraps `window.kiteDesktop`, the bridge exposed by the shell's preload script.
 *          Day 1: reports the shell version and OS, and opens the microphone; the other methods
 *          throw NotImplementedError naming the day they arrive.
 * Used by: src/platform/index.ts (getPlatform)
 * Depends on: @kite/shared (KiteDesktopApi), src/platform/types.ts, errors.ts, media.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (desktop column), §7.3
 */
import type { DesktopOs, KiteDesktopApi } from '@kite/shared';
import { NotImplementedError } from './errors';
import { openMicrophone } from './media';
import type { Platform } from './types';

/** The desktop Platform, plus details about the shell that only exist on desktop. */
export interface DesktopPlatform extends Platform {
  /** Always 'desktop'. */
  kind: 'desktop';
  /** Version of the desktop shell, for example '0.1.0' (shown in the sidebar, Stage 5). */
  version: string;
  /** Operating system the shell runs on. */
  os: DesktopOs;
}

/**
 * Builds the desktop Platform around the bridge object from the shell.
 * A factory (instead of a module-level constant) because `window` does not exist while Next.js
 * renders on the server, so the bridge can only be read once the code runs in the page.
 *
 * @param bridge The `window.kiteDesktop` object exposed by apps/desktop/src/preload.ts.
 * @returns A DesktopPlatform backed by that bridge.
 * Called from: getPlatform() in src/platform/index.ts
 */
export function createDesktopPlatform(bridge: KiteDesktopApi): DesktopPlatform {
  return {
    kind: 'desktop',
    version: bridge.version,
    os: bridge.os,

    // The page calls getUserMedia exactly as in a browser; the shell grants the microphone
    // permission for the Kite origin only (Stage 5, security.ts). Needed on Day 1 for the
    // speech-to-text spike inside the desktop app (Stage 6).
    getMicStream: openMicrophone,

    /** Day 2: getDisplayMedia, auto-approved by the shell with system-audio loopback. */
    async getOtherSideStream() {
      throw new NotImplementedError('desktop.getOtherSideStream', 2);
    },

    /** Day 5: the shell captures the current display with desktopCapturer. */
    async captureScreenshot() {
      throw new NotImplementedError('desktop.captureScreenshot', 5);
    },

    /** Day 5: the shell opens a frameless, always-on-top live window. */
    async openCompactView(_sessionId: string) {
      throw new NotImplementedError('desktop.openCompactView', 5);
    },

    /** Day 4: global shortcuts registered by the shell and forwarded to the page. */
    onHotkey(_handler) {
      throw new NotImplementedError('desktop.onHotkey', 4);
    },

    /** Day 5: setContentProtection on the live window. */
    async setShareProtection(_on: boolean) {
      throw new NotImplementedError('desktop.setShareProtection', 5);
    },
  };
}

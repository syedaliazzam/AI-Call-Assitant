/**
 * File: apps/web/src/platform/browser.ts
 * Purpose: The Platform implementation used when Kite runs in Chrome or Edge (no desktop app).
 *          Day 1: only the microphone works; the other methods throw NotImplementedError naming
 *          the day they arrive.
 * Used by: src/platform/index.ts (getPlatform)
 * Depends on: src/platform/types.ts, src/platform/errors.ts, src/platform/media.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (browser column)
 */
import { NotImplementedError } from './errors';
import { openMicrophone } from './media';
import type { Platform } from './types';

/** Platform implementation for Chrome / Edge. */
export const browserPlatform: Platform = {
  kind: 'browser',

  /** Opens the microphone with getUserMedia (the browser asks the user for permission). */
  getMicStream: openMicrophone,

  /** Day 2: getDisplayMedia with the share picker and "Also share tab audio" guidance. */
  async getOtherSideStream() {
    throw new NotImplementedError('browser.getOtherSideStream', 2);
  },

  /** Day 5: grab a frame from the screen or tab stream the user already shared. */
  async captureScreenshot() {
    throw new NotImplementedError('browser.captureScreenshot', 5);
  },

  /** Day 5: Document Picture-in-Picture window. */
  async openCompactView(_sessionId: string) {
    throw new NotImplementedError('browser.openCompactView', 5);
  },

  /** Day 4: in-page keyboard shortcuts while the Kite tab or PiP window has focus. */
  onHotkey(_handler) {
    throw new NotImplementedError('browser.onHotkey', 4);
  },

  /** Day 5: returns false (browsers cannot hide a window from screen sharing) and the UI explains. */
  async setShareProtection(_on: boolean) {
    throw new NotImplementedError('browser.setShareProtection', 5);
  },
};

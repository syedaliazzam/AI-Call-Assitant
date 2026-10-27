/**
 * File: apps/web/src/platform/errors.ts
 * Purpose: Errors thrown by platform methods:
 *          - NotImplementedError: the method is not built yet (names the feature and the day);
 *          - CaptureError: capturing the other side of the call failed, with a typed reason and a
 *            message the UI can show as it is (Day 2).
 * Used by: src/platform/browser.ts, src/platform/desktop.ts, src/platform/media.ts; the
 *          Connect view (Day 2 Stage 4) shows CaptureError messages
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 and §12 (build plan)
 */

/**
 * Thrown when a platform feature is planned but not implemented yet.
 *
 * @example throw new NotImplementedError('browser.captureScreenshot', 5)
 *          // message: "browser.captureScreenshot is not implemented yet (arrives on Day 5)"
 */
export class NotImplementedError extends Error {
  /** Which method was called, for example 'desktop.onHotkey'. */
  readonly feature: string;
  /** The build-plan day (architecture §12.2) on which the feature is implemented. */
  readonly day: number;

  /**
   * @param feature Name of the method that was called, written as '<platform>.<method>'.
   * @param day     Build-plan day on which it will be implemented.
   */
  constructor(feature: string, day: number) {
    super(`${feature} is not implemented yet (arrives on Day ${day})`);
    this.name = 'NotImplementedError';
    this.feature = feature;
    this.day = day;
  }
}

/**
 * Why capturing the other side ("Them") failed:
 * - 'no-audio-track': the share has no sound (browser: "Also share tab audio" was not ticked);
 * - 'user-cancelled': the user closed the share picker;
 * - 'not-supported': this browser or OS cannot capture the call's sound (for example macOS 12
 *   in the desktop app, or a browser without getDisplayMedia);
 * - 'permission-denied': the OS or the app refused (for example macOS privacy settings).
 */
export type CaptureErrorCode =
  'no-audio-track' | 'user-cancelled' | 'not-supported' | 'permission-denied';

/**
 * Thrown by getOtherSideStream(). Its message is written for the user (what happened and what to
 * do) and contains no transcript or page content.
 *
 * @example throw new CaptureError('no-audio-track', 'Share again and tick "Also share tab audio".')
 */
export class CaptureError extends Error {
  /** Why capture failed. */
  readonly code: CaptureErrorCode;

  /**
   * @param code    Why capture failed.
   * @param message What happened and what to do, for the user.
   */
  constructor(code: CaptureErrorCode, message: string) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
  }
}

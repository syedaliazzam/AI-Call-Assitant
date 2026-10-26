/**
 * File: apps/web/src/platform/errors.ts
 * Purpose: Error thrown by platform methods that are not built yet, so callers get a clear
 *          message naming the feature and the day it arrives instead of a silent failure.
 * Used by: src/platform/browser.ts, src/platform/desktop.ts
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

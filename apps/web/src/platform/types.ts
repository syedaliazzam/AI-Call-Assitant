/**
 * File: apps/web/src/platform/types.ts
 * Purpose: The Platform interface: the one API the web app uses for everything that differs
 *          between the desktop app (Electron) and a normal browser (Chrome / Edge).
 * Used by: src/platform/browser.ts, src/platform/desktop.ts, src/platform/index.ts, and any code
 *          that calls getPlatform()
 * Depends on: @kite/shared (HotkeyAction)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (the platform adapter)
 */
import type { HotkeyAction } from '@kite/shared';

// Re-exported so code using the platform can import every platform type from one place.
export type { HotkeyAction };

/**
 * Where the other side's sound comes from:
 * - 'system-loopback': everything the computer plays (desktop app);
 * - 'tab-audio': one Chrome/Edge tab shared with "Also share tab audio" (browser);
 * - 'screen-audio': a whole screen or window shared with its sound (browser; Windows can include
 *   system audio when the entire screen is shared).
 */
export type OtherSideSource = 'system-loopback' | 'tab-audio' | 'screen-audio';

/** The other side of the call, ready to transcribe as "Them". */
export interface OtherSideStream {
  /** A stream with exactly one live audio track (desktop: audio only; browser: plus the video
   *  track of the shared tab or screen, kept unrendered for Day 5 screenshots). */
  stream: MediaStream;
  /** Where the sound comes from. */
  source: OtherSideSource;
}

/**
 * Everything the web app needs that the desktop app and the browser do differently.
 * getPlatform() (src/platform/index.ts) returns the right implementation at start-up.
 */
export interface Platform {
  /** Which implementation is running: inside the desktop app, or in Chrome / Edge. */
  kind: 'desktop' | 'browser';

  /**
   * Opens the user's microphone (the "You" channel).
   * - Desktop: the page calls getUserMedia; the shell grants the microphone permission for the
   *   Kite origin only (apps/desktop/src/security.ts, Stage 5).
   * - Browser: getUserMedia; the browser shows its own permission prompt.
   *
   * @returns A live audio-only stream. Stop its tracks to release the microphone.
   * @throws DOMException('NotAllowedError') if the user or the system denies the microphone.
   */
  getMicStream(): Promise<MediaStream>;

  /**
   * Opens the other side of the call (the "Them" channel). Always a separate stream from the
   * microphone: the two are never mixed.
   * - Desktop: the page calls getDisplayMedia; the shell approves it automatically with
   *   system-audio loopback, with no picker (Windows; macOS 13+, which also needs the "System
   *   Audio Recording" permission from macOS 14.2). The video track is stopped at once.
   * - Browser: getDisplayMedia with the share picker; the user picks the meeting tab and ticks
   *   "Also share tab audio" (on Windows, sharing the entire screen can include system audio).
   *
   * @returns The stream and where its sound comes from.
   * @throws CaptureError ('no-audio-track', 'user-cancelled', 'not-supported',
   *         'permission-denied') with a message for the user.
   */
  getOtherSideStream(): Promise<OtherSideStream>;

  /**
   * Takes a screenshot to answer from.
   * - Desktop: the shell captures the current display (desktopCapturer) and returns PNG bytes.
   * - Browser: grabs a frame from the screen or tab stream the user already shared.
   *
   * @returns The image as a Blob.
   */
  captureScreenshot(): Promise<Blob>;

  /**
   * Opens the small live view for a session (transcript line, latest answer, Answer button).
   * - Desktop: the shell opens a frameless, always-on-top window.
   * - Browser: a Document Picture-in-Picture window (Chrome / Edge 116+); must be called from a
   *   button click.
   *
   * @param sessionId Id of the live session to show.
   */
  openCompactView(sessionId: string): Promise<void>;

  /**
   * Listens for hotkey actions (answer, screenshot, clear, prev, next).
   * - Desktop: Electron global shortcuts, which work from any app, forwarded to the page.
   * - Browser: keyboard shortcuts while the Kite tab or the picture-in-picture window has focus.
   *
   * @param handler Called with the action each time a hotkey is pressed.
   * @returns A function that removes the listener.
   */
  onHotkey(handler: (action: HotkeyAction) => void): () => void;

  /**
   * Turns screen-share protection on or off for the live window.
   * - Desktop: setContentProtection(on) on the live window (hidden in Windows full-screen share;
   *   still visible in macOS full-screen share).
   * - Browser: not possible; returns false and the UI shows guidance instead.
   *
   * @param on True to protect, false to stop protecting.
   * @returns True if protection is now in the requested state, false if the platform cannot do it.
   */
  setShareProtection(on: boolean): Promise<boolean>;
}

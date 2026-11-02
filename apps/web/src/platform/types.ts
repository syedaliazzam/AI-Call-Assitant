/**
 * File: apps/web/src/platform/types.ts
 * Purpose: The Platform interface: the one API the web app uses for everything that differs
 *          between the desktop app (Electron) and a normal browser (Chrome / Edge).
 * Used by: src/platform/browser.ts, src/platform/desktop.ts, src/platform/index.ts, and any code
 *          that calls getPlatform()
 * Depends on: @kite/shared (HotkeyAction)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (the platform adapter)
 */
import type { HotkeyAction, HotkeyStatus, ShareProtectionState } from '@kite/shared';
import type { PipRenderer } from './pip';

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
   * Whether opening a session first shows the "Choose platform" dialog (Desktop app or Open in
   * browser, architecture §5).
   * - Browser: true, the user may prefer the desktop app for calls outside the browser.
   * - Desktop: false; the session opens directly (the user has already chosen the app).
   */
  offersPlatformChoice: boolean;

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
   * @param render    Browser only: renders the compact view into the picture-in-picture window
   *                  (the features layer passes it; the desktop shell loads /compact/[id] itself).
   * @throws CaptureError('not-supported') when this app or browser cannot open it.
   */
  openCompactView(sessionId: string, render?: PipRenderer): Promise<void>;

  /**
   * Closes the small live view (End).
   *
   * @returns Resolves when closed (also when none was open).
   */
  closeCompactView(): Promise<void>;

  /**
   * Whether this platform can change the overlay window itself: opacity, and its size when it
   * collapses (the desktop app; a browser picture-in-picture window cannot).
   *
   * @returns True in a desktop app that supports it.
   */
  overlayWindowControls(): boolean;

  /**
   * Sets the overlay window's opacity. Nothing happens where it is not supported.
   *
   * @param opacity 0–1.
   */
  setOverlayOpacity(opacity: number): void;

  /**
   * Collapses the overlay window to its controls bar, or opens it again. Nothing happens to the
   * window where it is not supported (the view still hides its other bars).
   *
   * @param collapsed True to collapse.
   */
  setOverlayCollapsed(collapsed: boolean): void;

  /**
   * Minimises the main window when a call starts in the overlay. Nothing happens in a browser
   * (a web page cannot minimise its window).
   */
  minimizeMainWindow(): void;

  /**
   * Which global shortcuts another app already uses (Settings → Hotkeys).
   *
   * @returns The statuses, or null where there are no global shortcuts (a browser).
   */
  checkHotkeys(): Promise<HotkeyStatus[] | null>;

  /**
   * Listens for the in-page shortcuts on a window other than the live page, for as long as it
   * has focus (the overlay). It never takes shortcuts from other apps.
   *
   * @param target  The window to listen on.
   * @param handler Called with each action.
   * @returns A function that stops listening.
   */
  listenForFocusedHotkeys(
    target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
    handler: (action: HotkeyAction) => void,
  ): () => void;

  /**
   * Says whether a live call is going on (Day 6): the desktop app then never asks to restart
   * for an update during a call. Nothing happens in the browser.
   *
   * @param active True while connected to a call.
   */
  setCallActive(active: boolean): void;

  /**
   * Listens for hotkey actions (answer, screenshot, chat, clear, prev, next). Call it for the length
   * of a live call only: in the desktop app it takes the shortcuts from every other app.
   * - Desktop: Electron global shortcuts, which work from any app, forwarded to the page (turned
   *   on by this call, off by the returned function), plus the in-page shortcuts.
   * - Browser: keyboard shortcuts while the Kite tab or the picture-in-picture window has focus.
   *
   * @param handler   Called with the action each time a hotkey is pressed.
   * @param onTaken   Desktop only: called with the shortcuts another app already uses (for
   *                  example ['Ctrl+Enter']); those work only while Kite has focus.
   * @returns A function that removes the listener (and, on desktop, releases the shortcuts).
   */
  onHotkey(
    handler: (action: HotkeyAction) => void,
    onTaken?: (shortcuts: string[]) => void,
  ): () => void;

  /**
   * The hotkeys' modifier, for labels ("⌘Enter" or "Ctrl+Enter").
   * - Desktop: from the shell's OS.
   * - Browser: from the browser's platform string.
   *
   * @returns '⌘' on macOS, 'Ctrl+' elsewhere.
   */
  hotkeyModifier(): '⌘' | 'Ctrl+';

  /**
   * Whether a live call can run here (UI theme stage U3). A live call needs a computer: both
   * audio channels, the speech model and screen or tab sharing.
   * - Desktop: always true (the app runs on Windows and macOS).
   * - Browser: false on phones and tablets, and where screen or tab sharing is missing.
   *
   * @returns True when the live page can run a call.
   */
  supportsLiveCalls(): boolean;

  /**
   * Turns screen-share protection of the compact live window on or off (remembered).
   * - Desktop: setContentProtection(on) on the compact window, re-applied on every show; the
   *   window stays in the taskbar and Alt+Tab. Windows 10 2004+: left out of screen shares;
   *   macOS: apps built on ScreenCaptureKit may still capture it.
   * - Browser: not possible (supported: false); the UI gives guidance instead.
   *
   * @param on True to protect, false to stop protecting.
   * @returns The new state and whether this platform supports it.
   */
  setShareProtection(on: boolean): Promise<ShareProtectionState>;

  /**
   * The remembered protection setting.
   *
   * @returns The state and whether this platform supports it.
   */
  getShareProtection(): Promise<ShareProtectionState>;
}

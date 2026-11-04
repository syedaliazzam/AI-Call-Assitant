/**
 * File: packages/shared/src/desktop-bridge.ts
 * Purpose: The typed contract between the Electron preload script and the web app: the shape of
 *          `window.kiteDesktop`, which exists only when Kite runs inside the desktop app.
 * Used by: apps/desktop/src/preload.ts (Stage 5, implements it),
 *          apps/web/src/platform/desktop.ts and apps/web/src/platform/index.ts (read it)
 * Depends on: ./hotkeys.ts, ./screenshot.ts (types only)
 * Also: the accurate-transcription contract (v1.0.1, ADR-0034): status, download, remove, transcribe;
 *       the overlay's presets, page-driven resizing and modes (v1.0.2, ADR-0035); opening pages from
 *       the home panel, window controls and the stacked overlay's layout (v1.1.0, ADR-0041).
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
   * Day 5: turns screen-share protection on or off (setContentProtection only; the windows stay in
   * the taskbar and Alt+Tab). Remembered by the shell. From shell 1.1.0 it covers every Kite window;
   * before that, only the compact window.
   *
   * @param on True to hide Kite's windows from screen capture.
   * @returns The new state, and whether this OS supports it.
   */
  setShareProtection?: (on: boolean) => Promise<ShareProtectionState>;
  /**
   * ADR-0029: which global shortcuts another app already uses (Settings → Hotkeys). Optional: a
   * desktop app installed earlier does not have it.
   *
   * @returns Whether each global shortcut can be registered.
   */
  checkHotkeys?: () => Promise<HotkeyStatus[]>;
  /**
   * ADR-0029: sets the overlay window's opacity. Optional, as above.
   *
   * @param opacity 0–1; the shell keeps it in a readable range.
   * @returns Resolves when set.
   */
  setOverlayOpacity?: (opacity: number) => Promise<void>;
  /**
   * ADR-0029: collapses the overlay window to its controls bar, or opens it again. Optional, as
   * above.
   *
   * @param collapsed True to collapse.
   * @returns Resolves when done.
   */
  setOverlayCollapsed?: (collapsed: boolean) => Promise<void>;
  /**
   * ADR-0029: minimises the main window when a call starts in the overlay. Closing the overlay
   * brings it back. Optional, as above.
   *
   * @returns Resolves when done.
   */
  minimizeMainWindow?: () => Promise<void>;
  /**
   * v1.0.4 (ADR-0040): brings the full call window (the main window) forward and hides the overlay.
   * Optional: a shell before 1.0.4 has no such call, and the page closes the overlay instead (which
   * also brings the main window back).
   *
   * @returns Resolves when done.
   */
  showCallWindow?: () => Promise<void>;
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
  /**
   * v1.0.1 (ADR-0034): the accurate-transcription engine's state (Parakeet, opt-in). Optional: a
   * desktop app installed earlier does not have it.
   *
   * @returns Whether the engine is available on this computer, downloaded, downloading or failed.
   */
  accurateStatus?: () => Promise<AccurateStatus>;
  /**
   * v1.0.1: starts (or resumes) the model download, each file checked against its SHA-256.
   * Returns at once; call accurateStatus() for progress.
   *
   * @returns The state after starting.
   */
  accurateDownload?: () => Promise<AccurateStatus>;
  /**
   * v1.0.1: deletes the downloaded model (and stops a download), freeing the disk space.
   *
   * @returns The state afterwards.
   */
  accurateRemove?: () => Promise<AccurateStatus>;
  /**
   * v1.0.1: transcribes one finished utterance again with the accurate engine. Never stored or
   * logged by the shell (only its length and the time taken).
   *
   * @param samples The utterance's audio: mono, 16 kHz, -1…1, at most ACCURATE_MAX_SECONDS long.
   * @returns The text, or a failure the page answers by keeping the live engine's line.
   */
  accurateTranscribe?: (samples: Float32Array) => Promise<AccurateResult>;
  /**
   * v1.0.2 (ADR-0035): puts the overlay at a preset place, at its default size (560 × 420), on the
   * display it is on, and remembers the preset as where it opens next time. With no overlay open it
   * only remembers. Optional: a desktop app installed earlier does not have it.
   *
   * @param preset Where to put it.
   * @returns Resolves when done.
   */
  placeOverlay?: (preset: OverlayPreset) => Promise<void>;
  /**
   * v1.0.2: the remembered overlay preset ('top-center' until the user picks another).
   *
   * @returns The preset.
   */
  getOverlayPreset?: () => Promise<OverlayPreset>;
  /**
   * v1.0.2: resizes the overlay from one of its edges, driven by the page (a see-through window
   * cannot always be resized by the system's own frame). One drag sends 'start', any number of
   * 'move' and one 'end'; the shell keeps it above its minimum size and on its display.
   *
   * @param step The drag's phase, edge and distance from where it started.
   * @returns Resolves when applied.
   */
  resizeOverlay?: (step: OverlayResizeStep) => Promise<void>;
  /**
   * v1.0.2: switches the overlay window between its full size, its controls bar (collapsed) and
   * the slim script bar (with or without its input row). Leaving a slim mode brings back the size
   * and place the overlay had.
   *
   * @param mode The mode.
   * @returns Resolves when done.
   */
  setOverlayMode?: (mode: OverlayMode) => Promise<void>;
  /**
   * v1.1.0 (ADR-0041): opens a Kite page in a normal window. With no call running it goes to the main
   * window; during a call it goes to a separate window, because the main window is running the call
   * and navigating it would end the call. Optional: a shell before 1.1.0 has only one window, where
   * the page simply navigates.
   *
   * @param path A path on the Kite origin (PAGES_WINDOW_PATH), for example '/sessions/new'.
   * @returns Resolves when the window is showing.
   */
  openPagesWindow?: (path: string) => Promise<void>;
  /**
   * v1.1.0 (ADR-0041): minimises or closes the window this page is in (the frameless home panel draws
   * its own buttons). Optional, as above.
   *
   * @param action What to do.
   * @returns Resolves when done.
   */
  windowControl?: (action: WindowControlAction) => Promise<void>;
  /**
   * v1.1.0 (ADR-0041): tells the shell which of the stacked overlay's panels are open, so it sizes the
   * window to fit them. Optional, as above: an older shell keeps its fixed window, and the panels
   * share its height.
   *
   * @param layout The open panels, and how tall an open menu needs the window to be.
   * @returns Resolves when applied.
   */
  setOverlayLayout?: (layout: OverlayLayout) => Promise<void>;
  /**
   * v1.1.0 (ADR-0041): the snap zone under the pointer while the overlay is dragged (the zones
   * window's page).
   *
   * @param handler Called with the zone, or null when the pointer is on none.
   * @returns A function that removes the listener.
   */
  onSnapZone?: (handler: (zone: OverlayPreset | null) => void) => () => void;
}

/** What windowControl() can do (v1.1.0). */
export type WindowControlAction = 'minimize' | 'close';

/** The paths openPagesWindow() accepts: Kite's own pages, nothing else (v1.1.0). */
export const PAGES_WINDOW_PATH =
  /^\/(?:|sessions(?:\/[\w-]+(?:\/edit)?|\/new)?|live\/[\w-]+|settings|ask-kite|resumes|documents|question-bank|mock|help|profile)$/;

/** Which of the stacked overlay's panels are open (v1.1.0, ADR-0041). */
export interface OverlayLayout {
  /** The transcript panel is open. */
  transcript: boolean;
  /** The answer panel is open. */
  answer: boolean;
  /**
   * The height an open menu or device list needs, in DIPs (0 when none is open): the window grows to
   * at least this for as long as it is open, and goes back afterwards.
   */
  popupHeight: number;
  /** The page's UI scale (Zoom in the ⋮ menu, default 1): the default heights grow with it. */
  scale?: number;
}

/** Where the overlay can be put by a preset (ADR-0035; top-left from v1.1.0). */
export type OverlayPreset = 'top-center' | 'top-left' | 'top-right' | 'bottom-center';

/**
 * Every overlay preset (the first is the default). 'bottom-center' stays valid for positions saved by
 * an earlier version, but is no longer offered (v1.1.0).
 */
export const OVERLAY_PRESETS: readonly OverlayPreset[] = [
  'top-center',
  'top-left',
  'top-right',
  'bottom-center',
];

/** The three places the overlay snaps to while it is dragged, left to right (v1.1.0, ADR-0041). */
export const SNAP_PRESETS: readonly OverlayPreset[] = ['top-left', 'top-center', 'top-right'];

/** An edge or corner of the overlay that the page resizes it from (ADR-0035). */
export type OverlayEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * The overlay window's mode (ADR-0035): `full` (the three bars), `collapsed` (the controls bar
 * only), `script` (a slim bar with the answer line) and `script-input` (the slim bar with its
 * one-line input open). v1.0.4: ⛶ opens the full call window, so there is no expanded overlay.
 */
export type OverlayMode = 'full' | 'collapsed' | 'script' | 'script-input';

/** One step of a page-driven overlay resize (ADR-0035). */
export interface OverlayResizeStep {
  /** 'start' when the drag begins, 'move' while it goes on, 'end' when it is let go. */
  phase: 'start' | 'move' | 'end';
  /** The edge or corner being dragged. */
  edge: OverlayEdge;
  /** Horizontal distance from where the drag started, in DIPs (screenX difference). */
  dx: number;
  /** Vertical distance from where the drag started, in DIPs (screenY difference). */
  dy: number;
}

/** Longest utterance the accurate engine transcribes, in seconds (longer ones keep the live text). */
export const ACCURATE_MAX_SECONDS = 30;

/** Where the accurate-transcription engine stands on this computer (ADR-0034). */
export type AccurateState =
  /** No engine build for this computer (only Windows x64 and macOS arm64 ship one). */
  | 'unavailable'
  /** Available; the model is not downloaded. */
  | 'not-downloaded'
  /** The model is downloading (or being checked). */
  | 'downloading'
  /** Downloaded and checked: ready to use. */
  | 'ready'
  /** The last download or start failed (see `error`); downloading again resumes it. */
  | 'error';

/** The accurate engine's status (ADR-0034). */
export interface AccurateStatus {
  /** Where it stands. */
  state: AccurateState;
  /** Bytes of the model already on disk (for the progress bar). */
  receivedBytes: number;
  /** The model's total size in bytes. */
  totalBytes: number;
  /** A short plain-language reason, with state 'error'. */
  error?: string;
}

/** One accurate transcription (ADR-0034). */
export type AccurateResult =
  | {
      /** Transcribed. */
      ok: true;
      /** The text (never logged). */
      text: string;
      /** Decoding time, in ms. */
      ms: number;
    }
  | {
      /** Not transcribed: the page keeps the live line. */
      ok: false;
      /** Why: the model is missing, the audio was refused, or the engine failed. */
      code: 'not-ready' | 'bad-audio' | 'engine';
    };

/** Screen-share protection (Day 5; every Kite window from v1.1.0, ADR-0042). */
export interface ShareProtectionState {
  /** True when the user wants Kite's windows hidden from screen capture. */
  on: boolean;
  /**
   * What it covers: 'all' from shell 1.1.0. A shell before that sends nothing and covers only the
   * overlay, and the page says so.
   */
  scope?: 'all';
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

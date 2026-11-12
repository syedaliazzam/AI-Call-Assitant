/**
 * File: packages/shared/src/desktop-bridge.ts
 * Purpose: The typed contract between the Electron preload script and the web app: the shape of
 *          `window.kiteDesktop`, which exists only when Kite runs inside the desktop app.
 * Used by: apps/desktop/src/preload.ts (Stage 5, implements it),
 *          apps/web/src/platform/desktop.ts and apps/web/src/platform/index.ts (read it)
 * Depends on: ./hotkeys.ts, ./screenshot.ts, ./recording.ts, ./drive.ts (types only)
 * Also: the accurate-transcription contract (v1.0.1, ADR-0034): status, download, remove, transcribe;
 *       the overlay's presets, page-driven resizing and modes (v1.0.2, ADR-0035); opening pages from
 *       the home panel, window controls and the stacked overlay's layout (v1.1.0, ADR-0041); meeting
 *       recording, the player, displays and this computer's name (desktop 1.5.0, ADR-0068); Drive
 *       uploads of recordings and native notifications (desktop 1.6.0, ADR-0072).
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 and §7.3 (preload.ts)
 */
import type {
  DesktopNotice,
  DriveUploadProgress,
  DriveUploadRequest,
  DriveUploadResult,
} from './drive';
import type { HotkeyAction, HotkeyStatus } from './hotkeys';
import type {
  DeviceIdentity,
  LocalRecording,
  RecordingCloseResult,
  RecordingDisplay,
  RecordingOpenRequest,
  RecordingOpenResult,
  RecordingSaveResult,
  RecordingTrack,
  RecordingWriteResult,
} from './recording';
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
  /**
   * v1.2.0 (spec S13): moves the overlay by a distance, for dragging the icon (a drag region would
   * swallow its click). Optional: a shell before 1.2.0 has no icon mode.
   *
   * @param dx Pixels to the right.
   * @param dy Pixels down.
   * @returns Resolves when done.
   */
  moveOverlay?: (dx: number, dy: number) => Promise<void>;
  /**
   * v1.2.0 (spec S14): holds Ctrl+Alt+Enter for as long as the chat bar is open. Optional: in an older
   * shell the key works only while Paramount AI has focus.
   *
   * @param on True while the chat bar is open.
   * @returns Resolves when done.
   */
  setChatHotkey?: (on: boolean) => Promise<void>;
  /**
   * v1.2.0 (ADR-0045): lets the person pick a session file in the system's dialog, for the hand-off
   * from a browser. Optional: a shell before 1.2.0 has no such call (and no paramountai:// link either).
   *
   * @returns The file, or null when the dialog was cancelled.
   */
  pickHandoffFile?: () => Promise<HandoffPick | null>;
  /**
   * v1.2.0 (ADR-0045): deletes the file picked last. The page names no path: this can delete only that
   * file, once. Optional, as above.
   *
   * @returns True when it was deleted.
   */
  deleteHandoffFile?: () => Promise<boolean>;
  /**
   * v1.3.0 (ADR-0052): the one-time sign-in code a paramountai:// link brought, given once to the
   * panel's link page and then forgotten (it never appears in an address). Optional: older shells have
   * none.
   *
   * @returns The code, or null when there is none (or it was already taken).
   */
  consumeLinkCode?: () => Promise<string | null>;
  /**
   * v1.3.0 (ADR-0055): opens the window that runs a call (the main window) on a session's live page,
   * minimised, so the Connect card in the small window stays in front while the call connects. The
   * session id must be a UUID. Optional: an older shell opens the live page with openPagesWindow, in
   * front.
   *
   * @param sessionId The session.
   * @returns Resolves when the window is opening.
   */
  openCallWindow?: (sessionId: string) => Promise<void>;
  /**
   * v1.3.0 (ADR-0055): asks for the home panel's size (the desktop cards are about 560 wide). The shell
   * keeps it inside the screen. Optional: older shells keep their size.
   *
   * @param size The wanted size, in DIPs.
   * @returns Resolves when applied.
   */
  sizePanel?: (size: PanelSize) => Promise<void>;
  /**
   * v1.3.0 (ADR-0055): lets clicks pass through the overlay window to the app behind it (true) while
   * the pointer is over a transparent gap between its bars and panels, or takes them again (false).
   * Pointer moves still reach the page while passing through, so it can switch back. Optional: older
   * shells keep the whole window clickable.
   *
   * @param through True to pass clicks through.
   * @returns Resolves when applied.
   */
  setOverlayClickThrough?: (through: boolean) => Promise<void>;
  /**
   * v1.3.2: gives the keyboard back to the app that had it, after a click on one of the overlay's panel
   * controls (copy, ← →, a toggle) made the overlay the active window. Only the overlay's own page can
   * ask, and only while the overlay has focus. Optional: an older shell keeps the focus.
   *
   * @returns Resolves when done.
   */
  releaseOverlayFocus?: () => Promise<void>;
  /**
   * v1.3.0 (ADR-0056): the overlay's position (one of the six), or null when it has none yet (no
   * overlay open). Optional: an older shell has no positions grid.
   *
   * @returns The position.
   */
  getOverlayPosition?: () => Promise<OverlayPreset | null>;
  /**
   * v1.3.0 (ADR-0056): puts the open overlay at one of the six positions at its current size (the ⋮
   * grid), remembered for the display it is on. Optional, as above.
   *
   * @param preset Where.
   * @returns The overlay's position afterwards, or null with no overlay open.
   */
  setOverlayPosition?: (preset: OverlayPreset) => Promise<OverlayPreset | null>;
  /**
   * v1.3.0 (ADR-0056): the overlay's position whenever it changes (a shortcut, a drop, the ⋮ grid), so
   * the page puts its panels below the bars on the top row and above them on the bottom row.
   *
   * @param handler Called with the position.
   * @returns A function that removes the listener.
   */
  onOverlayPosition?: (handler: (preset: OverlayPreset) => void) => () => void;
  /**
   * Desktop 1.5.0 (ADR-0068): opens a recording's files in Documents/Paramount AI/Recordings and adds it
   * to the shell's index as 'recording'. Refused below RECORDING_DISK.minStartBytes free. Optional: a
   * shell before 1.5.0 cannot record, and the page offers no Record option.
   * @param request What is recorded.
   * @returns The file's name, or why it cannot start.
   */
  recordingOpen?: (request: RecordingOpenRequest) => Promise<RecordingOpenResult>;
  /**
   * Desktop 1.5.0: appends one encoded piece to a recording's file, in order. Never read or logged.
   * @param id    The recording's id.
   * @param track The main file or the stereo file.
   * @param bytes The piece.
   * @returns Whether it was written, and how full the drive is.
   */
  recordingWrite?: (
    id: string,
    track: RecordingTrack,
    bytes: Uint8Array,
  ) => Promise<RecordingWriteResult>;
  /**
   * Desktop 1.5.0: closes a recording's files and finalises them (length and seek index), in the
   * background process. Resolves when it is done.
   * @param id The recording's id.
   * @returns The recording as it now is.
   */
  recordingClose?: (id: string) => Promise<RecordingCloseResult>;
  /**
   * Desktop 1.5.0: the recordings on this computer (the shell's index; a recording whose file has gone
   * is 'missing').
   * @returns Every recording the index holds.
   */
  recordingList?: () => Promise<LocalRecording[]>;
  /**
   * Desktop 1.5.0: opens the player window on a recording saved on this computer.
   * @param id The recording's id.
   * @returns False when this computer does not have it.
   */
  recordingPlay?: (id: string) => Promise<boolean>;
  /**
   * Desktop 1.5.0: copies a recording's main file to where the person picks (the system's Save dialog).
   * @param id The recording's id.
   * @returns What happened.
   */
  recordingSaveAs?: (id: string) => Promise<RecordingSaveResult>;
  /**
   * Desktop 1.5.0: shows a recording's file in the system's file manager.
   * @param id The recording's id.
   * @returns False when the file is not there.
   */
  recordingShowInFolder?: (id: string) => Promise<boolean>;
  /**
   * Desktop 1.5.0: moves a recording's files to the Recycle Bin (Trash) and forgets it.
   * @param id The recording's id.
   * @returns False when it could not be deleted.
   */
  recordingDelete?: (id: string) => Promise<boolean>;
  /**
   * Desktop 1.5.0: the displays a screen recording can be made of (more than one shows a picker).
   * @returns The displays, the main one first.
   */
  listDisplays?: () => Promise<RecordingDisplay[]>;
  /**
   * Desktop 1.5.0: which display the next screen recording captures (the next video-only
   * getDisplayMedia request gets it). Null for the main display.
   * @param displayId The display, or null.
   * @returns Resolves when set.
   */
  setRecordingDisplay?: (displayId: string | null) => Promise<void>;
  /**
   * Desktop 1.5.0: this computer's id and name ("Saved on <name>").
   * @returns The identity.
   */
  deviceIdentity?: () => Promise<DeviceIdentity>;
  /**
   * Desktop 1.5.0: renames this computer for the account's recordings.
   * @param name The new name (trimmed; at most DEVICE_NAME_MAX characters; empty goes back to the
   *             computer's own name).
   * @returns The identity afterwards.
   */
  renameDevice?: (name: string) => Promise<DeviceIdentity>;
  /**
   * Desktop 1.6.0 (ADR-0072): uploads one of this computer's recording files to a Drive resumable
   * upload session the page opened, in DRIVE_CHUNK_BYTES chunks, from where Google says it got to.
   * Stops between chunks while a call is live ('paused'), so the call keeps the computer's bandwidth.
   * @param request The recording, its file, the upload address (1.6.0/1.6.1: and an access token; from
   *                1.6.2, ADR-0074: no token, and the offset the server says Google has).
   * @returns How it ended (1.6.2: with the whole file's MD5 when done).
   */
  driveUpload?: (request: DriveUploadRequest) => Promise<DriveUploadResult>;
  /**
   * Desktop 1.6.2 (ADR-0074): the size of one of this computer's recording files (from its Recordings
   * index only), for the server to start the upload and verify it. Its presence also says the shell
   * uploads without a token; 1.6.0 and 1.6.1 do not have it, and their recordings wait for the update.
   * @param recordingId The recording.
   * @param track       Its main file or its stereo sound file.
   * @returns The size in bytes, or null when the file is not on this computer.
   */
  driveFileSize?: (recordingId: string, track: RecordingTrack) => Promise<number | null>;
  /**
   * Desktop 1.6.0: listens for the progress of this page's Drive uploads.
   * @param handler Called after each chunk.
   * @returns A function that stops listening.
   */
  onDriveUploadProgress?: (handler: (progress: DriveUploadProgress) => void) => () => void;
  /**
   * Desktop 1.6.0: shows a native notification; a click opens its Google Drive link in the system
   * browser (no other link is opened).
   * @param notice The two lines and the link.
   * @returns False when the system cannot show notifications.
   */
  showNotice?: (notice: DesktopNotice) => Promise<boolean>;
}

/** A size the home panel can ask for (v1.3.0, ADR-0055). */
export interface PanelSize {
  /** Width, DIPs. */
  width: number;
  /** Height, DIPs. */
  height: number;
}

/** A session file picked in the system's dialog (v1.2.0, ADR-0045). */
export interface HandoffPick {
  /** The file's name, without its folder. */
  name: string;
  /** The file's text ('' when it was too large to read). Never logged. */
  text: string;
  /** True when the file was too large to read. */
  tooLarge?: boolean;
}

/** What windowControl() can do (v1.1.0). */
export type WindowControlAction = 'minimize' | 'close';

/** The paths openPagesWindow() accepts: Kite's own pages, nothing else (v1.1.0; /meetings from 1.5.0, ADR-0068). */
export const PAGES_WINDOW_PATH =
  /^\/(?:|sessions(?:\/[\w-]+(?:\/edit)?|\/new)?|live\/[\w-]+|settings|ask-kite|resumes|documents|question-bank|mock|help|profile|meetings)$/;

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
  /**
   * v1.3.2: how tall the visible bars and panels are, in DIPs, when that is less than the window would
   * otherwise be: a 1.3.2 shell shrinks the window to it, so the window is exactly its visible box and
   * covers nothing else. Absent (or ignored by an older shell): the window keeps its layout height, and
   * the empty space passes clicks through.
   */
  contentHeight?: number;
}

/**
 * Where the overlay can be put by a preset (ADR-0035; top-left from v1.1.0; bottom-left and bottom-right
 * from v1.3.0, ADR-0056: six positions in a 2 × 3 grid).
 */
export type OverlayPreset =
  'top-center' | 'top-left' | 'top-right' | 'bottom-center' | 'bottom-left' | 'bottom-right';

/**
 * Every overlay preset (the first is the default). A shell before 1.3.0 knows only the first four, and
 * refuses the other two.
 */
export const OVERLAY_PRESETS: readonly OverlayPreset[] = [
  'top-center',
  'top-left',
  'top-right',
  'bottom-center',
  'bottom-left',
  'bottom-right',
];

/** A row of the overlay's positions (v1.3.0, ADR-0056). */
export type OverlayRow = 'top' | 'bottom';

/** The six positions as a grid: two rows, each left to right (v1.3.0, ADR-0056). */
export const OVERLAY_GRID: Readonly<Record<OverlayRow, readonly OverlayPreset[]>> = {
  top: ['top-left', 'top-center', 'top-right'],
  bottom: ['bottom-left', 'bottom-center', 'bottom-right'],
};

/**
 * The row a position is in: on the top row the panels open below the bars, on the bottom row above.
 *
 * @param preset The position.
 * @returns Its row.
 * Called from: apps/desktop/src/positions.ts, apps/web/src/features/live (CompactView, LiveMenu); tests
 */
export function overlayRow(preset: OverlayPreset): OverlayRow {
  return preset.startsWith('bottom') ? 'bottom' : 'top';
}

/**
 * The places the overlay snaps to while it is dragged (v1.1.0, ADR-0041: the top three; v1.3.0,
 * ADR-0056: all six).
 */
export const SNAP_PRESETS: readonly OverlayPreset[] = [...OVERLAY_GRID.top, ...OVERLAY_GRID.bottom];

/** An edge or corner of the overlay that the page resizes it from (ADR-0035). */
export type OverlayEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * The overlay window's mode (ADR-0035): `full` (the three bars), `collapsed` (the controls bar
 * only), `script` (a slim bar with the answer line) and `script-input` (the slim bar with its
 * one-line input open). v1.0.4: ⛶ opens the full call window, so there is no expanded overlay.
 */
export type OverlayMode = 'full' | 'collapsed' | 'script' | 'script-input' | 'icon';

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
      /**
       * Why: the model is missing, the audio was refused, the engine failed, or (1.5.1, ADR-0069) a newer
       * line took this one's place in the engine's queue ('busy').
       */
      code: 'not-ready' | 'bad-audio' | 'engine' | 'busy';
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

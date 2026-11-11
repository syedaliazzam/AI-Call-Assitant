/**
 * File: apps/web/src/platform/types.ts
 * Purpose: The Platform interface: the one API the web app uses for everything that differs
 *          between the desktop app (Electron) and a normal browser (Chrome / Edge).
 * Used by: src/platform/browser.ts, src/platform/desktop.ts, src/platform/index.ts, and any code
 *          that calls getPlatform()
 * Depends on: @kite/shared (HotkeyAction, the overlay and window types, the recording contract, the
 *             Drive upload contract)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (the platform adapter); ADR-0035
 */
import type {
  AccurateResult,
  AccurateStatus,
  DesktopNotice,
  DeviceIdentity,
  DriveUploadProgress,
  DriveUploadRequest,
  DriveUploadResult,
  HandoffPick,
  LocalRecording,
  RecordingCloseResult,
  RecordingDisplay,
  RecordingOpenRequest,
  RecordingOpenResult,
  RecordingQualitySpec,
  RecordingSaveResult,
  RecordingTrack,
  RecordingWriteResult,
  HotkeyAction,
  HotkeyStatus,
  OverlayEdge,
  OverlayLayout,
  OverlayMode,
  OverlayPreset,
  OverlayResizeStep,
  ShareProtectionState,
  WindowControlAction,
} from '@kite/shared';
import type { MicDevice, OutputKind } from './media';
import type { PipRenderer } from './pip';

// Re-exported so code using the platform can import every platform type from one place.
export type { MicDevice };
export type {
  HotkeyAction,
  OverlayEdge,
  OverlayLayout,
  OverlayMode,
  OverlayPreset,
  OverlayResizeStep,
};

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
   * @param deviceId The microphone to open (v1.1.0); the system's default when absent.
   * @returns A live audio-only stream. Stop its tracks to release the microphone.
   * @throws DOMException('NotAllowedError') if the user or the system denies the microphone.
   */
  getMicStream(deviceId?: string): Promise<MediaStream>;

  /**
   * The microphones on this computer, for the overlay's device list (v1.1.0).
   *
   * @returns The microphones.
   */
  listMicrophones(): Promise<MicDevice[]>;

  /**
   * Watches whether the computer is on battery (v1.1.0, ADR-0044).
   *
   * @param handler Called now and on every change: true on battery, false plugged in, null unknown.
   * @returns A function that stops watching.
   */
  watchBattery(handler: (onBattery: boolean | null) => void): () => void;

  /**
   * v1.4 (ADR-0062): whether sound plays through speakers or headphones, from the default output's
   * name, so the call can recommend headphones. Optional: test fakes may leave it out.
   *
   * @returns 'speakers', 'headphones' or 'unknown'.
   */
  outputKind?(): Promise<OutputKind>;

  /**
   * The snap zone under the pointer while the overlay is dragged (v1.1.0, the zones window's page).
   *
   * @param handler Called with the zone, or null when the pointer is on none.
   * @returns A function that stops listening.
   */
  onSnapZone(handler: (zone: OverlayPreset | null) => void): () => void;

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
   * v1.0.2 (ADR-0035): whether the overlay window can be put at a preset place, resized by the
   * page from its edges and switched to the script bar (a desktop app from 1.0.2).
   *
   * @returns True where placeOverlay, resizeOverlay and setOverlayMode do something.
   */
  overlayPlacement(): boolean;

  /**
   * Puts the overlay at a preset place at its default size and remembers the preset (also with no
   * overlay open: then it only remembers). Nothing happens where it is not supported.
   *
   * @param preset Where.
   */
  placeOverlay(preset: OverlayPreset): void;

  /**
   * The remembered overlay preset.
   *
   * @returns The preset, or null where there is none (a browser, an older desktop app).
   */
  getOverlayPreset(): Promise<OverlayPreset | null>;

  /**
   * One step of resizing the overlay window from one of its edges (the page's edge handles).
   * Nothing happens where it is not supported.
   *
   * @param step The drag's phase, edge and distance from where it started.
   */
  resizeOverlay(step: OverlayResizeStep): void;

  /**
   * Switches the overlay window between full, collapsed and the script bar. An older desktop app
   * only collapses ('collapsed') and opens ('full') it; elsewhere nothing happens to the window.
   *
   * @param mode The mode.
   */
  setOverlayMode(mode: OverlayMode): void;

  /**
   * v1.1.0 (ADR-0041): whether this app has the home panel and its window calls (a desktop app from
   * 1.1.0). Elsewhere /home goes to the dashboard.
   *
   * @returns True where openPagesWindow and windowControl do something.
   */
  hasHomePanel(): boolean;

  /**
   * Lets the person pick a session file for the hand-off from a browser (v1.2.0, ADR-0045).
   *
   * @returns The file, or null when cancelled or where this app has no such thing.
   */
  pickHandoffFile(): Promise<HandoffPick | null>;

  /**
   * Deletes the session file picked last (v1.2.0, ADR-0045).
   *
   * @returns True when it was deleted.
   */
  deleteHandoffFile(): Promise<boolean>;

  /**
   * The one-time sign-in code a paramountai:// link brought (desktop 1.3.0, ADR-0052), given once.
   *
   * @returns The code, or null (a browser, an older shell, no link, or already taken).
   */
  consumeLinkCode(): Promise<string | null>;

  /**
   * v1.1.0: opens a Kite page. In a desktop app from 1.1.0: in a normal window (a separate one during
   * a call, whose page must not be navigated away). Elsewhere: in this tab.
   *
   * @param path The page's path, for example '/sessions/new'.
   */
  openPagesWindow(path: string): void;

  /**
   * v1.3.0 (ADR-0055): opens the window that runs a call on a session's live page. A desktop app from
   * 1.3.0 opens it minimised (the Connect card stays in front); an older one opens it like any page;
   * elsewhere nothing happens (a browser runs the call in its own tab).
   *
   * @param sessionId The session.
   */
  openCallWindow(sessionId: string): void;

  /**
   * v1.3.0 (ADR-0055): asks for the home panel's size. Nothing happens where it is not supported.
   *
   * @param width  Width, CSS px.
   * @param height Height, CSS px.
   */
  sizePanel(width: number, height: number): void;

  /**
   * v1.3.0 (ADR-0055): lets clicks pass through the desktop overlay's transparent gaps (true), or takes
   * them again (false). Nothing happens elsewhere.
   *
   * @param through True to pass clicks through.
   */
  setOverlayClickThrough(through: boolean): void;

  /**
   * v1.3.2: gives the keyboard back to the app that had it, after a click on one of the desktop overlay's
   * panel controls made the overlay the active window. Nothing happens elsewhere, or in an older shell.
   */
  releaseOverlayFocus(): void;

  /**
   * v1.3.0 (ADR-0056): whether the overlay has the six positions (the ⋮ grid, the jump shortcuts, panels
   * above the bars on the bottom row): a desktop app from 1.3.0.
   *
   * @returns True where the position methods below do something.
   */
  overlayPositions(): boolean;

  /**
   * v1.3.0: the open overlay's position.
   *
   * @returns The position, or null (no overlay, an older shell, a browser).
   */
  getOverlayPosition(): Promise<OverlayPreset | null>;

  /**
   * v1.3.0: puts the open overlay at a position at its current size. Nothing happens elsewhere.
   *
   * @param preset Where.
   */
  setOverlayPosition(preset: OverlayPreset): void;

  /**
   * v1.3.0: the overlay's position whenever it changes (a jump shortcut, a drop, the ⋮ grid).
   *
   * @param handler Called with the position.
   * @returns A function that stops listening (does nothing where there are no positions).
   */
  onOverlayPosition(handler: (preset: OverlayPreset) => void): () => void;

  /**
   * v1.3.0 (ADR-0055): keeps this page's popups inside its window, where screen-share protection
   * reaches: <select> lists drawn in the page and no native tooltips (desktop app only; once per page).
   */
  keepPopupsInWindow(): void;

  /**
   * v1.1.0: minimises or closes this window (the frameless home panel draws its own buttons). Nothing
   * happens where it is not supported.
   *
   * @param action What to do.
   */
  windowControl(action: WindowControlAction): void;

  /**
   * v1.1.0: whether the overlay's window fits its panels (a desktop app from 1.1.0). An older desktop
   * app and a browser picture-in-picture window keep a fixed window: the panels share its height.
   *
   * @returns True where setOverlayLayout does something.
   */
  overlayFitsPanels(): boolean;

  /**
   * v1.1.0: tells the window which panels are open, so it fits them. Nothing happens where it is not
   * supported.
   *
   * @param layout The open panels.
   */
  setOverlayLayout(layout: OverlayLayout): void;

  /**
   * v1.2.0 (spec S13): whether the overlay can shrink to the icon (a desktop app from 1.2.0).
   *
   * @returns True where moveOverlay and the 'icon' mode work.
   */
  overlayIconMode(): boolean;

  /**
   * v1.2.0 (spec S13): moves the overlay by a distance, for dragging the icon.
   *
   * @param dx Pixels to the right.
   * @param dy Pixels down.
   */
  moveOverlay(dx: number, dy: number): void;

  /**
   * v1.2.0 (spec S14): holds the chat bar's screenshot shortcut from any app, where the shell can. It
   * always works while the page has focus.
   *
   * @param on True while the chat bar is open.
   */
  setChatHotkey(on: boolean): void;

  /**
   * Minimises the main window when a call starts in the overlay. Nothing happens in a browser
   * (a web page cannot minimise its window).
   */
  minimizeMainWindow(): void;

  /**
   * Brings the full call window forward and puts the overlay away (v1.0.4, ADR-0040): the desktop
   * app's main window, or the browser's tab (the picture-in-picture window closes; a browser may
   * not let a page bring its tab to the front).
   *
   * @returns Resolves when done.
   */
  showCallWindow(): Promise<void>;

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
   * Listens for the Ask Kite shortcut on every signed-in page. It never turns on the call's global
   * shortcuts. In the desktop app the shell holds the key from any app; everywhere it also works
   * while Kite has focus.
   *
   * @param handler Called each time it is pressed.
   * @returns A function that stops listening.
   */
  onAskKiteHotkey(handler: () => void): () => void;

  /**
   * Says whether a live call is going on (Day 6): the desktop app then never asks to restart
   * for an update during a call. Nothing happens in the browser.
   *
   * @param active True while connected to a call.
   */
  setCallActive(active: boolean): void;

  /**
   * v1.0.1 (ADR-0034): the accurate-transcription engine (Parakeet, opt-in), or null where there
   * is none: the browser, and a desktop app installed before v1.0.1.
   */
  readonly accurate: AccurateEngine | null;

  /**
   * Desktop 1.5.0 (ADR-0068): meeting recording into the computer's Recordings folder, or null where
   * there is none: the browser (Phase 1 records in the desktop app only), and a desktop app before 1.5.0.
   */
  readonly recording: RecordingHost | null;

  /**
   * Desktop 1.6.0 (ADR-0072): uploading this computer's recordings to Google Drive straight from disk,
   * and native notifications; null in the browser and in a desktop app before 1.6.0.
   */
  readonly drive: DriveHost | null;

  /**
   * ADR-0072: whether Google's consent page and the Drive Picker open in this window. True in a browser;
   * false in the desktop app, which opens the web app's Settings in the system browser instead (the
   * shell loads only the Kite address, so Google's pages cannot open inside it).
   *
   * @returns True in a browser.
   */
  driveSetupHere(): boolean;

  /**
   * ADR-0072: opens a page of the web app where Google Drive is set up: here (browser) or in the system
   * browser (desktop).
   *
   * @param path A path of the web app, for example '/settings?drive=connect#google-drive'.
   */
  openDriveSetup(path: string): void;

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
   * Turns screen-share protection on or off (remembered).
   * - Desktop: setContentProtection(on) on every Kite window (from shell 1.1.0; the compact window
   *   alone before that), re-applied on every show; the windows stay in the taskbar and Alt+Tab.
   *   Windows 10 2004+: left out of screen shares; macOS: apps built on ScreenCaptureKit may still
   *   capture them.
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

/** The accurate-transcription engine of the desktop app (ADR-0034). */
export interface AccurateEngine {
  /**
   * Where the engine stands: unavailable on this computer, not downloaded, downloading, ready or
   * failed.
   *
   * @returns The status, with the download's progress in bytes.
   */
  status(): Promise<AccurateStatus>;
  /**
   * Starts or resumes the model download (about 661 MB, each file checked).
   *
   * @returns The status after starting.
   */
  download(): Promise<AccurateStatus>;
  /**
   * Deletes the downloaded model.
   *
   * @returns The status afterwards.
   */
  remove(): Promise<AccurateStatus>;
  /**
   * Transcribes one finished utterance again (mono 16 kHz audio, at most 30 s).
   *
   * @param samples The utterance's audio.
   * @returns The text, or why not (the page then keeps the live line).
   */
  transcribe(samples: Float32Array): Promise<AccurateResult>;
}

/**
 * Meeting recording in the desktop app (1.5.0, ADR-0068). The page records with MediaRecorder
 * (core/recording); the shell writes the files, finalises them and plays them. Nothing leaves the
 * computer.
 */
export interface RecordingHost {
  /**
   * Opens the screen's video for a screen recording: a video-only capture of the display picked for
   * recordings (the main one when none is), scaled down to the quality's size and frame rate. The
   * shell grants it with no picker.
   *
   * @param quality   The largest size and frame rate.
   * @param displayId The display to record, or null for the main one.
   * @returns A stream with one video track.
   * @throws CaptureError when the screen cannot be captured.
   */
  openScreen(quality: RecordingQualitySpec, displayId: string | null): Promise<MediaStream>;
  /**
   * Opens a recording's files (refused when the drive has less than about 2 GB free).
   *
   * @param request What is recorded.
   * @returns The file's name, or why it cannot start.
   */
  open(request: RecordingOpenRequest): Promise<RecordingOpenResult>;
  /**
   * Appends one encoded piece, in order.
   *
   * @param id    The recording.
   * @param track The main file or the stereo file.
   * @param bytes The piece.
   * @returns Whether it was written, and how full the drive is.
   */
  write(id: string, track: RecordingTrack, bytes: Uint8Array): Promise<RecordingWriteResult>;
  /**
   * Closes and finalises a recording (length and seek index).
   *
   * @param id The recording.
   * @returns The recording as it now is.
   */
  close(id: string): Promise<RecordingCloseResult>;
  /**
   * The recordings on this computer.
   *
   * @returns The shell's index.
   */
  list(): Promise<LocalRecording[]>;
  /**
   * Opens the player window on a recording saved here.
   *
   * @param id The recording.
   * @returns False when this computer does not have it.
   */
  play(id: string): Promise<boolean>;
  /**
   * Saves a copy where the person picks.
   *
   * @param id The recording.
   * @returns What happened.
   */
  saveAs(id: string): Promise<RecordingSaveResult>;
  /**
   * Shows the file in the file manager.
   *
   * @param id The recording.
   * @returns False when the file is not there.
   */
  showInFolder(id: string): Promise<boolean>;
  /**
   * Moves the files to the Recycle Bin.
   *
   * @param id The recording.
   * @returns False when they could not be deleted.
   */
  remove(id: string): Promise<boolean>;
  /**
   * The displays a screen recording can capture.
   *
   * @returns The displays, the main one first.
   */
  displays(): Promise<RecordingDisplay[]>;
  /**
   * This computer's id and name.
   *
   * @returns The identity.
   */
  device(): Promise<DeviceIdentity>;
  /**
   * Renames this computer for recordings.
   *
   * @param name The new name ('' goes back to the computer's own name).
   * @returns The identity afterwards.
   */
  renameDevice(name: string): Promise<DeviceIdentity>;
}

/**
 * Desktop 1.6.0 (ADR-0072): the shell's part of saving to Google Drive. The page decides what goes where
 * (folders, names, upload sessions); the shell sends a recording's bytes from its Recordings index to
 * Google's upload address only, and shows native notifications.
 */
export interface DriveHost {
  /**
   * Uploads one recording file to a resumable upload session, from where Google says it got to.
   *
   * @param request    The recording, its file, the upload address and an access token.
   * @param onProgress Called after each chunk.
   * @returns How it ended ('paused' when a call started).
   */
  upload(
    request: DriveUploadRequest,
    onProgress: (progress: DriveUploadProgress) => void,
  ): Promise<DriveUploadResult>;

  /**
   * Shows a native notification; a click opens its Drive link in the system browser.
   *
   * @param notice The lines and the link.
   * @returns False when the system cannot show one.
   */
  notify(notice: DesktopNotice): Promise<boolean>;
}

/**
 * File: apps/desktop/src/preload.ts
 * Purpose: Runs inside the Kite window before the page and exposes exactly one object to it:
 *          window.kiteDesktop = { version, os, setHotkeysEnabled, onHotkey, captureScreenshot,
 *          openCompactView, closeCompactView, setShareProtection, getShareProtection,
 *          setCallActive, the overlay methods (v1.0.2: placeOverlay, getOverlayPreset,
 *          resizeOverlay, setOverlayMode; ADR-0035), the window calls (v1.1.0: openPagesWindow,
 *          windowControl, setOverlayLayout; ADR-0041), the link's one-time sign-in code (v1.3.0:
 *          consumeLinkCode; ADR-0052; the 1.2.0 hand-off file calls are gone), the icon and chat bar (v1.2.0: moveOverlay, setChatHotkey),
 *          the keyboard back to the app behind (v1.3.2: releaseOverlayFocus; ADR-0061),
 *          accurateStatus / accurateDownload / accurateRemove / accurateTranscribe (v1.0.1, ADR-0034),
 *          and meeting recording (1.5.0, ADR-0068: recordingOpen / Write / Close / List / Play / SaveAs /
 *          ShowInFolder / Delete, listDisplays, setRecordingDisplay, deviceIdentity, renameDevice),
 *          and Google Drive (1.6.0, ADR-0072: driveUpload, onDriveUploadProgress, showNotice; 1.6.2,
 *          ADR-0074: driveFileSize) }
 *          (frozen). Nothing
 *          else is exposed: the two methods wrap two fixed IPC channels, never ipcRenderer.
 * Used by: src/security.ts secureWebPreferences() (loaded as the window's preload, dist/preload.js)
 * Depends on: electron (contextBridge, ipcRenderer); @kite/shared (KiteDesktopApi,
 *             HOTKEY_ACTIONS); src/channels.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3, §7.3 (preload.ts)
 *
 * This preload is sandboxed: it can use contextBridge and a limited `process`
 * (argv, platform), but not Node modules or app.getVersion().
 */
import {
  HOTKEY_ACTIONS,
  OVERLAY_PRESETS,
  type DesktopOs,
  type HotkeyAction,
  type KiteDesktopApi,
  type OverlayLayout,
  type OverlayMode,
  type OverlayPreset,
  type OverlayResizeStep,
  type DesktopNotice,
  type DriveUploadProgress,
  type DriveUploadRequest,
  type RecordingOpenRequest,
  type RecordingTrack,
  type WindowControlAction,
} from '@kite/shared';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  ACCURATE_DOWNLOAD_CHANNEL,
  ACCURATE_REMOVE_CHANNEL,
  ACCURATE_STATUS_CHANNEL,
  ACCURATE_TRANSCRIBE_CHANNEL,
  CAPTURE_SCREENSHOT_CHANNEL,
  CALL_ACTIVE_CHANNEL,
  CHECK_HOTKEYS_CHANNEL,
  CLOSE_COMPACT_CHANNEL,
  GET_PROTECTION_CHANNEL,
  HOTKEY_CHANNEL,
  MINIMIZE_MAIN_CHANNEL,
  OPEN_COMPACT_CHANNEL,
  LINK_CODE_CHANNEL,
  OPEN_CALL_WINDOW_CHANNEL,
  OVERLAY_CLICK_THROUGH_CHANNEL,
  OVERLAY_RELEASE_FOCUS_CHANNEL,
  SIZE_PANEL_CHANNEL,
  OPEN_PAGES_CHANNEL,
  OVERLAY_COLLAPSE_CHANNEL,
  CHAT_HOTKEY_CHANNEL,
  VOICE_CANCEL_HOTKEY_CHANNEL,
  OVERLAY_LAYOUT_CHANNEL,
  OVERLAY_MOVE_CHANNEL,
  OVERLAY_MODE_CHANNEL,
  OVERLAY_OPACITY_CHANNEL,
  OVERLAY_PLACE_CHANNEL,
  OVERLAY_POSITION_CHANNEL,
  OVERLAY_POSITION_EVENT,
  OVERLAY_PRESET_CHANNEL,
  OVERLAY_RESIZE_CHANNEL,
  SHOW_CALL_WINDOW_CHANNEL,
  SET_HOTKEYS_CHANNEL,
  SET_PROTECTION_CHANNEL,
  SNAP_ZONE_CHANNEL,
  WINDOW_CONTROL_CHANNEL,
  DEVICE_IDENTITY_CHANNEL,
  LIST_DISPLAYS_CHANNEL,
  RECORDING_CLOSE_CHANNEL,
  RECORDING_DELETE_CHANNEL,
  RECORDING_DISPLAY_CHANNEL,
  RECORDING_LIST_CHANNEL,
  RECORDING_OPEN_CHANNEL,
  RECORDING_PLAY_CHANNEL,
  RECORDING_SAVE_AS_CHANNEL,
  RECORDING_SHOW_CHANNEL,
  RECORDING_WRITE_CHANNEL,
  RENAME_DEVICE_CHANNEL,
  DRIVE_PROGRESS_EVENT,
  DRIVE_FILE_SIZE_CHANNEL,
  DRIVE_UPLOAD_CHANNEL,
  SHOW_NOTICE_CHANNEL,
} from './channels';

/** Prefix of the argument main.ts passes with the app version. */
const VERSION_ARG = '--kite-version=';

/**
 * Finds the shell version in the renderer's command-line arguments.
 *
 * @param argv The renderer process arguments (process.argv).
 * @returns The version, for example '0.1.0', or '0.0.0' if missing.
 * Called from: the bottom of this file; tests
 */
export function readVersion(argv: readonly string[]): string {
  return argv.find((arg) => arg.startsWith(VERSION_ARG))?.slice(VERSION_ARG.length) || '0.0.0';
}

/**
 * Converts Node's platform name to the bridge's OS name.
 *
 * @param platform process.platform, for example 'darwin' or 'win32'.
 * @returns 'mac', 'windows' or 'linux' (anything else is treated as linux).
 * Called from: the bottom of this file; tests
 */
export function toDesktopOs(platform: string): DesktopOs {
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

/**
 * Whether a value is a hotkey action (messages from the main process are checked anyway).
 *
 * @param value What arrived on the hotkey channel.
 * @returns True for one of HOTKEY_ACTIONS.
 * Called from: onHotkey(); tests
 */
export function isHotkeyAction(value: unknown): value is HotkeyAction {
  return typeof value === 'string' && (HOTKEY_ACTIONS as readonly string[]).includes(value);
}

/**
 * Listens for global shortcuts forwarded by the main process (src/hotkeys.ts).
 *
 * @param handler The page's handler; it receives only valid actions, never the IPC event.
 * @returns A function that removes the listener.
 * Called from: the page, as window.kiteDesktop.onHotkey(); tests
 */
export function onHotkey(handler: (action: HotkeyAction) => void): () => void {
  const listener = (_event: IpcRendererEvent, action: unknown) => {
    if (isHotkeyAction(action)) handler(action);
  };
  ipcRenderer.on(HOTKEY_CHANNEL, listener);
  return () => {
    ipcRenderer.removeListener(HOTKEY_CHANNEL, listener);
  };
}

/**
 * Listens for the snap zone under the pointer during a drag (v1.1.0, the zones window's page).
 *
 * @param handler The page's handler; it receives a preset or null, never the IPC event.
 * @returns A function that removes the listener.
 * Called from: the page, as window.kiteDesktop.onSnapZone(); tests
 */
export function onSnapZone(handler: (zone: OverlayPreset | null) => void): () => void {
  const listener = (_event: IpcRendererEvent, zone: unknown) => {
    handler(
      (OVERLAY_PRESETS as readonly unknown[]).includes(zone) ? (zone as OverlayPreset) : null,
    );
  };
  ipcRenderer.on(SNAP_ZONE_CHANNEL, listener);
  return () => {
    ipcRenderer.removeListener(SNAP_ZONE_CHANNEL, listener);
  };
}

/**
 * Listens for the overlay's position (v1.3.0, ADR-0056: the overlay's own page).
 *
 * @param handler The page's handler; it receives a known position only, never the IPC event.
 * @returns A function that removes the listener.
 * Called from: the page, as window.kiteDesktop.onOverlayPosition(); tests
 */
export function onOverlayPosition(handler: (preset: OverlayPreset) => void): () => void {
  const listener = (_event: IpcRendererEvent, preset: unknown) => {
    if ((OVERLAY_PRESETS as readonly unknown[]).includes(preset)) handler(preset as OverlayPreset);
  };
  ipcRenderer.on(OVERLAY_POSITION_EVENT, listener);
  return () => {
    ipcRenderer.removeListener(OVERLAY_POSITION_EVENT, listener);
  };
}

/**
 * 1.6.0 (ADR-0072): listens for the progress of this page's Drive uploads.
 *
 * @param handler The page's handler; it receives only well-formed progress, never the IPC event.
 * @returns A function that removes the listener.
 * Called from: the page, as window.kiteDesktop.onDriveUploadProgress(); tests
 */
export function onDriveUploadProgress(
  handler: (progress: DriveUploadProgress) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, progress: unknown) => {
    const p = progress as Partial<DriveUploadProgress> | null;
    if (
      p &&
      typeof p.recordingId === 'string' &&
      (p.track === 'main' || p.track === 'stereo') &&
      typeof p.sent === 'number' &&
      typeof p.total === 'number'
    ) {
      handler({ recordingId: p.recordingId, track: p.track, sent: p.sent, total: p.total });
    }
  };
  ipcRenderer.on(DRIVE_PROGRESS_EVENT, listener);
  return () => {
    ipcRenderer.removeListener(DRIVE_PROGRESS_EVENT, listener);
  };
}

/** The bridge object. Frozen, so the page cannot change or extend it. */
const kiteDesktop: KiteDesktopApi = Object.freeze({
  version: readVersion(process.argv),
  os: toDesktopOs(process.platform),
  // Only a boolean crosses to the main process.
  setHotkeysEnabled: (on: boolean) => ipcRenderer.invoke(SET_HOTKEYS_CHANNEL, on === true),
  onHotkey,
  // No arguments cross to the main process; the image comes back in memory only.
  captureScreenshot: () => ipcRenderer.invoke(CAPTURE_SCREENSHOT_CHANNEL),
  // Only a string id (checked again by the shell) or a boolean crosses to the main process.
  openCompactView: (sessionId: string) =>
    ipcRenderer.invoke(OPEN_COMPACT_CHANNEL, String(sessionId)),
  closeCompactView: () => ipcRenderer.invoke(CLOSE_COMPACT_CHANNEL),
  setShareProtection: (on: boolean) => ipcRenderer.invoke(SET_PROTECTION_CHANNEL, on === true),
  // Day 6: a live call is going on (or not); only a boolean crosses.
  setCallActive: (active: boolean) => ipcRenderer.send(CALL_ACTIVE_CHANNEL, active === true),
  getShareProtection: () => ipcRenderer.invoke(GET_PROTECTION_CHANNEL),
  // ADR-0029: the overlay and the shortcuts. Only a number or a boolean crosses; the shell keeps
  // the opacity in a readable range whatever arrives.
  checkHotkeys: () => ipcRenderer.invoke(CHECK_HOTKEYS_CHANNEL),
  setOverlayOpacity: (opacity: number) =>
    ipcRenderer.invoke(OVERLAY_OPACITY_CHANNEL, Number(opacity)),
  setOverlayCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke(OVERLAY_COLLAPSE_CHANNEL, collapsed === true),
  minimizeMainWindow: () => ipcRenderer.invoke(MINIMIZE_MAIN_CHANNEL),
  // v1.0.4 (ADR-0040): the overlay's ⛶ and its menu's "Open call window".
  showCallWindow: () => ipcRenderer.invoke(SHOW_CALL_WINDOW_CHANNEL),
  // v1.0.2 (ADR-0035): presets, page-driven resizing and modes. Only a string or four plain fields
  // cross (copied here, so no page object is passed on); the shell checks each value again.
  placeOverlay: (preset: OverlayPreset) =>
    ipcRenderer.invoke(OVERLAY_PLACE_CHANNEL, String(preset)),
  getOverlayPreset: () => ipcRenderer.invoke(OVERLAY_PRESET_CHANNEL),
  resizeOverlay: (step: OverlayResizeStep) =>
    ipcRenderer.invoke(OVERLAY_RESIZE_CHANNEL, {
      phase: String(step?.phase),
      edge: String(step?.edge),
      dx: Number(step?.dx),
      dy: Number(step?.dy),
    }),
  setOverlayMode: (mode: OverlayMode) => ipcRenderer.invoke(OVERLAY_MODE_CHANNEL, String(mode)),
  // v1.1.0 (ADR-0041): only a string or three plain fields cross; the shell checks them again.
  openPagesWindow: (path: string) => ipcRenderer.invoke(OPEN_PAGES_CHANNEL, String(path)),
  windowControl: (action: WindowControlAction) =>
    ipcRenderer.invoke(WINDOW_CONTROL_CHANNEL, String(action)),
  moveOverlay: (dx: number, dy: number) =>
    ipcRenderer.invoke(OVERLAY_MOVE_CHANNEL, { dx: Number(dx), dy: Number(dy) }),
  setChatHotkey: (on: boolean) => ipcRenderer.invoke(CHAT_HOTKEY_CHANNEL, on === true),
  // 1.6.4 (ADR-0082): only a boolean crosses.
  setVoiceCancelHotkey: (on: boolean) =>
    ipcRenderer.invoke(VOICE_CANCEL_HOTKEY_CHANNEL, on === true),
  setOverlayLayout: (layout: OverlayLayout) =>
    ipcRenderer.invoke(OVERLAY_LAYOUT_CHANNEL, {
      transcript: layout?.transcript === true,
      answer: layout?.answer === true,
      popupHeight: Number(layout?.popupHeight),
      scale: Number(layout?.scale ?? 1),
      // v1.3.2: only a number crosses; absent stays absent (the shell then keeps the layout height).
      ...(layout?.contentHeight === undefined
        ? {}
        : { contentHeight: Number(layout.contentHeight) }),
    }),
  onSnapZone,
  // v1.2.0 (ADR-0045): the hand-off file. No path crosses in either direction's arguments: the shell
  // picks with its own dialog and deletes only what it picked.
  // v1.3.0 (ADR-0052): only a string goes to the page; the shell gives it once.
  consumeLinkCode: async () => {
    const code: unknown = await ipcRenderer.invoke(LINK_CODE_CHANNEL);
    return typeof code === 'string' ? code : null;
  },
  // v1.3.0 (ADR-0055): a session id (the shell checks it is a UUID) and two numbers; nothing else.
  openCallWindow: (sessionId: string) =>
    ipcRenderer.invoke(OPEN_CALL_WINDOW_CHANNEL, String(sessionId)),
  setOverlayClickThrough: (through: boolean) =>
    ipcRenderer.invoke(OVERLAY_CLICK_THROUGH_CHANNEL, through === true),
  // v1.3.2: no argument crosses; the shell checks the sender is the overlay and that it has focus.
  releaseOverlayFocus: () => ipcRenderer.invoke(OVERLAY_RELEASE_FOCUS_CHANNEL),
  // v1.3.0 (ADR-0056): only a position name crosses; the shell checks it again.
  getOverlayPosition: () => ipcRenderer.invoke(OVERLAY_POSITION_CHANNEL),
  setOverlayPosition: (preset: OverlayPreset) =>
    ipcRenderer.invoke(OVERLAY_POSITION_CHANNEL, String(preset)),
  onOverlayPosition,
  sizePanel: (size: { width: number; height: number }) =>
    ipcRenderer.invoke(SIZE_PANEL_CHANNEL, {
      width: Number(size?.width),
      height: Number(size?.height),
    }),
  // v1.0.1 (ADR-0034): accurate transcription. Nothing but a Float32Array of audio crosses (the
  // shell checks its type and length again); the text comes back in memory only.
  accurateStatus: () => ipcRenderer.invoke(ACCURATE_STATUS_CHANNEL),
  accurateDownload: () => ipcRenderer.invoke(ACCURATE_DOWNLOAD_CHANNEL),
  accurateRemove: () => ipcRenderer.invoke(ACCURATE_REMOVE_CHANNEL),
  accurateTranscribe: (samples: Float32Array) =>
    ipcRenderer.invoke(
      ACCURATE_TRANSCRIBE_CHANNEL,
      samples instanceof Float32Array ? samples : new Float32Array(0),
    ),
  // 1.5.0 (ADR-0068): meeting recording. Only plain fields, ids, a track name and the encoded bytes
  // cross (copied here, so no page object is passed on); the shell checks each value again and writes
  // only into its Recordings folder, under names it makes itself.
  recordingOpen: (request: RecordingOpenRequest) =>
    ipcRenderer.invoke(RECORDING_OPEN_CHANNEL, {
      id: String(request?.id),
      sessionId: String(request?.sessionId),
      meetingId: String(request?.meetingId),
      part: Number(request?.part),
      kind: String(request?.kind),
      startedAt: Number(request?.startedAt),
      container: String(request?.container),
      stereo: request?.stereo === true,
    }),
  recordingWrite: (id: string, track: RecordingTrack, bytes: Uint8Array) =>
    ipcRenderer.invoke(
      RECORDING_WRITE_CHANNEL,
      String(id),
      String(track),
      bytes instanceof Uint8Array ? bytes : new Uint8Array(0),
    ),
  recordingClose: (id: string) => ipcRenderer.invoke(RECORDING_CLOSE_CHANNEL, String(id)),
  recordingList: () => ipcRenderer.invoke(RECORDING_LIST_CHANNEL),
  recordingPlay: (id: string) => ipcRenderer.invoke(RECORDING_PLAY_CHANNEL, String(id)),
  recordingSaveAs: (id: string) => ipcRenderer.invoke(RECORDING_SAVE_AS_CHANNEL, String(id)),
  recordingShowInFolder: (id: string) => ipcRenderer.invoke(RECORDING_SHOW_CHANNEL, String(id)),
  recordingDelete: (id: string) => ipcRenderer.invoke(RECORDING_DELETE_CHANNEL, String(id)),
  listDisplays: () => ipcRenderer.invoke(LIST_DISPLAYS_CHANNEL),
  setRecordingDisplay: (displayId: string | null) =>
    ipcRenderer.invoke(RECORDING_DISPLAY_CHANNEL, displayId === null ? null : String(displayId)),
  deviceIdentity: () => ipcRenderer.invoke(DEVICE_IDENTITY_CHANNEL),
  renameDevice: (name: string) => ipcRenderer.invoke(RENAME_DEVICE_CHANNEL, String(name)),
  // 1.6.0 (ADR-0072): Google Drive. Only plain fields cross (copied here); the shell checks the
  // recording against its own index and sends the file only to a Google Drive upload address.
  // 1.6.2 (ADR-0074): no token (only passed on if an older page still gives one), and the offset the
  // server says Google has.
  driveUpload: (request: DriveUploadRequest) =>
    ipcRenderer.invoke(DRIVE_UPLOAD_CHANNEL, {
      recordingId: String(request?.recordingId),
      track: String(request?.track),
      uploadUrl: String(request?.uploadUrl),
      ...(typeof request?.accessToken === 'string' ? { accessToken: request.accessToken } : {}),
      ...(typeof request?.startOffset === 'number' ? { startOffset: request.startOffset } : {}),
    }),
  driveFileSize: (recordingId: string, track: RecordingTrack) =>
    ipcRenderer.invoke(DRIVE_FILE_SIZE_CHANNEL, {
      recordingId: String(recordingId),
      track: String(track),
    }),
  onDriveUploadProgress,
  showNotice: (notice: DesktopNotice) =>
    ipcRenderer.invoke(SHOW_NOTICE_CHANNEL, {
      title: String(notice?.title ?? ''),
      body: String(notice?.body ?? ''),
      ...(notice?.url !== undefined ? { url: String(notice.url) } : {}),
    }),
});

contextBridge.exposeInMainWorld('kiteDesktop', kiteDesktop);

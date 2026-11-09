/**
 * File: apps/desktop/src/preload.ts
 * Purpose: Runs inside the Kite window before the page and exposes exactly one object to it:
 *          window.kiteDesktop = { version, os, setHotkeysEnabled, onHotkey, captureScreenshot,
 *          openCompactView, closeCompactView, setShareProtection, getShareProtection,
 *          setCallActive, the overlay methods (v1.0.2: placeOverlay, getOverlayPreset,
 *          resizeOverlay, setOverlayMode; ADR-0035), the window calls (v1.1.0: openPagesWindow,
 *          windowControl, setOverlayLayout; ADR-0041), the link's one-time sign-in code (v1.3.0:
 *          consumeLinkCode; ADR-0052; the 1.2.0 hand-off file calls are gone), the icon and chat bar (v1.2.0: moveOverlay, setChatHotkey),
 *          and accurateStatus / accurateDownload /
 *          accurateRemove / accurateTranscribe (v1.0.1, ADR-0034) } (frozen). Nothing
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
  SIZE_PANEL_CHANNEL,
  OPEN_PAGES_CHANNEL,
  OVERLAY_COLLAPSE_CHANNEL,
  CHAT_HOTKEY_CHANNEL,
  OVERLAY_LAYOUT_CHANNEL,
  OVERLAY_MOVE_CHANNEL,
  OVERLAY_MODE_CHANNEL,
  OVERLAY_OPACITY_CHANNEL,
  OVERLAY_PLACE_CHANNEL,
  OVERLAY_PRESET_CHANNEL,
  OVERLAY_RESIZE_CHANNEL,
  SHOW_CALL_WINDOW_CHANNEL,
  SET_HOTKEYS_CHANNEL,
  SET_PROTECTION_CHANNEL,
  SNAP_ZONE_CHANNEL,
  WINDOW_CONTROL_CHANNEL,
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
  setOverlayLayout: (layout: OverlayLayout) =>
    ipcRenderer.invoke(OVERLAY_LAYOUT_CHANNEL, {
      transcript: layout?.transcript === true,
      answer: layout?.answer === true,
      popupHeight: Number(layout?.popupHeight),
      scale: Number(layout?.scale ?? 1),
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
});

contextBridge.exposeInMainWorld('kiteDesktop', kiteDesktop);

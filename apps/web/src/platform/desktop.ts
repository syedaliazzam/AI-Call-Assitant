/**
 * File: apps/web/src/platform/desktop.ts
 * Purpose: The Platform implementation used when Kite runs inside the desktop app (Electron).
 *          It wraps `window.kiteDesktop`, the bridge exposed by the shell's preload script.
 *          It reports the shell version and OS, opens the microphone (Day 1) and the other side as
 *          system audio (Day 2), the hotkeys (Day 4), and screenshots, the compact live window and
 *          its screen-share protection through the shell (Day 5), and the overlay's presets,
 *          page-driven resizing and modes (v1.0.2, ADR-0035).
 * Used by: src/platform/index.ts (getPlatform)
 * Depends on: @kite/shared (KiteDesktopApi), src/platform/types.ts, errors.ts, media.ts,
 *             keymap.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (desktop column), §7.3
 */
import type {
  DesktopOs,
  KiteDesktopApi,
  OverlayLayout,
  OverlayMode,
  OverlayPreset,
  OverlayResizeStep,
  ShareProtectionState,
  WindowControlAction,
} from '@kite/shared';
import { CaptureError } from './errors';
import { listenForAskKite, listenForHotkeys } from './keymap';
import {
  listMicrophones,
  openMicrophone,
  requestDisplayMedia,
  stopAllTracks,
  watchBatteryState,
  type DisplayCaptureOptions,
} from './media';
import type { Platform } from './types';

/**
 * What the desktop page asks for. The shell (apps/desktop/src/media.ts) answers for the Kite
 * origin only, with the primary screen plus system-audio loopback and no picker. Video is
 * required by getDisplayMedia.
 */
export const DESKTOP_DISPLAY_OPTIONS: DisplayCaptureOptions = { audio: true, video: true };

/**
 * Message when the OS gave no audio track (macOS 12 and earlier cannot capture system audio).
 *
 * @param os The desktop OS.
 * @returns Text for the user.
 */
function noSystemAudioMessage(os: DesktopOs): string {
  return os === 'mac'
    ? 'This version of macOS can’t share your computer’s sound with Kite (macOS 13 or later is needed). Use Kite in Chrome and share the meeting tab with its audio instead.'
    : 'Kite couldn’t capture your computer’s sound. Use Kite in Chrome and share the meeting tab with its audio instead.';
}

/**
 * Message when the audio track arrived already ended. On macOS 14.2+ that means the "System
 * Audio Recording" permission is missing or denied (Electron's desktopCapturer docs: the track
 * is created ended and never delivers sound, with no error).
 *
 * @param os The desktop OS.
 * @returns Text for the user.
 */
function endedAudioMessage(os: DesktopOs): string {
  return os === 'mac'
    ? 'Kite is not allowed to record system audio. Allow Kite under System Settings → Privacy & Security → Screen & System Audio Recording, then try again.'
    : 'Kite couldn’t capture your computer’s sound. Try again; if it keeps failing, use Kite in Chrome and share the meeting tab with its audio.';
}

/** The desktop Platform, plus details about the shell that only exist on desktop. */
export interface DesktopPlatform extends Platform {
  /** Always 'desktop'. */
  kind: 'desktop';
  /** Version of the desktop shell, for example '0.1.0' (shown in the sidebar, Stage 5). */
  version: string;
  /** Operating system the shell runs on. */
  os: DesktopOs;
}

/** Protection state reported where it cannot be applied. */
const UNSUPPORTED_PROTECTION: ShareProtectionState = { on: false, supported: false };

/** A hotkey seen twice within this many ms (global shortcut and in-page key) counts once. */
const DUPLICATE_PRESS_MS = 150;

/**
 * Turns an Electron accelerator into the label users know.
 *
 * @param accelerator For example 'CommandOrControl+Left'.
 * @param os          The desktop OS.
 * @returns For example '⌘←' on macOS or 'Ctrl+←' on Windows.
 * Called from: onHotkey() (taken shortcuts); tests
 */
export function acceleratorLabel(accelerator: string, os: DesktopOs): string {
  const keys: Record<string, string> = { Left: '←', Right: '→', Enter: 'Enter' };
  const parts = accelerator.split('+').map((part) => {
    if (part === 'CommandOrControl') return os === 'mac' ? '⌘' : 'Ctrl';
    if (part === 'Shift') return os === 'mac' ? '⇧' : 'Shift';
    return keys[part] ?? part;
  });
  return os === 'mac' ? parts.join('') : parts.join('+');
}

/**
 * Builds the desktop Platform around the bridge object from the shell.
 * A factory (instead of a module-level constant) because `window` does not exist while Next.js
 * renders on the server, so the bridge can only be read once the code runs in the page.
 *
 * @param bridge The `window.kiteDesktop` object exposed by apps/desktop/src/preload.ts.
 * @returns A DesktopPlatform backed by that bridge.
 * Called from: getPlatform() in src/platform/index.ts
 */
export function createDesktopPlatform(bridge: KiteDesktopApi): DesktopPlatform {
  return {
    kind: 'desktop',
    // Already in the desktop app: sessions open directly, without the Choose platform dialog.
    offersPlatformChoice: false,
    version: bridge.version,
    os: bridge.os,

    // The page calls getUserMedia exactly as in a browser; the shell grants the microphone
    // permission for the Kite origin only (Stage 5, security.ts). Needed on Day 1 for the
    // speech-to-text spike inside the desktop app (Stage 6).
    getMicStream: openMicrophone,
    listMicrophones,
    watchBattery: watchBatteryState,

    /**
     * The snap zone under the pointer (a shell before 1.1.0 draws no zones).
     *
     * @param handler Called with the zone.
     * @returns A function that stops listening.
     */
    onSnapZone(handler) {
      return bridge.onSnapZone?.(handler) ?? (() => undefined);
    },

    /**
     * System audio ("Them"): getDisplayMedia, answered by the shell with loopback and no picker.
     * The video track is stopped and removed at once: it is not needed (Day 5 screenshots use
     * the shell's desktopCapturer instead), and a live screen capture would only cost CPU.
     *
     * @returns The audio-only stream, with source 'system-loopback'.
     */
    async getOtherSideStream() {
      const stream = await requestDisplayMedia(DESKTOP_DISPLAY_OPTIONS, 'desktop', bridge.os);
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
      }
      const audio = stream.getAudioTracks();
      if (audio.length === 0) {
        throw new CaptureError('not-supported', noSystemAudioMessage(bridge.os));
      }
      if (audio.every((track) => track.readyState === 'ended')) {
        stopAllTracks(stream);
        throw new CaptureError('permission-denied', endedAudioMessage(bridge.os));
      }
      return { stream, source: 'system-loopback' as const };
    },

    /** Day 5: the shell captures the current display with desktopCapturer. */
    /**
     * A screenshot of the display the Kite window is on, taken by the shell already scaled to
     * ≤ 1,568 px (apps/desktop/src/screenshot.ts).
     *
     * @returns The PNG as a Blob (in memory only).
     * @throws CaptureError: 'not-supported' (a desktop app from before Day 5),
     *         'permission-denied' (macOS Screen Recording), or 'failed'.
     */
    async captureScreenshot() {
      if (!bridge.captureScreenshot) {
        throw new CaptureError(
          'not-supported',
          'This version of the Kite desktop app cannot take screenshots. Install the latest version.',
        );
      }
      const result = await bridge.captureScreenshot();
      if (result.ok) return new Blob([result.png.slice()], { type: 'image/png' });
      if (result.code === 'permission-denied') {
        throw new CaptureError(
          'permission-denied',
          'Kite needs the Screen Recording permission: System Settings → Privacy & Security → Screen Recording → turn on Kite, then reopen Kite.',
        );
      }
      throw new CaptureError('failed', 'Kite could not take a screenshot. Try again.');
    },

    /**
     * The shell opens the compact live window (frameless, always on top, shown without focus).
     *
     * @param sessionId The session to show.
     * @throws CaptureError('not-supported') in a desktop app from before Day 5.
     */
    async openCompactView(sessionId: string) {
      if (!bridge.openCompactView) {
        throw new CaptureError(
          'not-supported',
          'This version of the Kite desktop app has no compact view. Install the latest version.',
        );
      }
      await bridge.openCompactView(sessionId);
    },

    /**
     * Closes the compact live window (End).
     *
     * @returns Resolves when closed.
     */
    async closeCompactView() {
      await bridge.closeCompactView?.();
    },

    /**
     * Whether this shell can change the overlay window (older shells cannot).
     *
     * @returns True when it has the controls.
     */
    overlayWindowControls() {
      return typeof bridge.setOverlayOpacity === 'function';
    },

    /**
     * Sets the overlay window's opacity (older shells ignore it).
     *
     * @param opacity 0–1.
     */
    setOverlayOpacity(opacity: number) {
      void bridge.setOverlayOpacity?.(opacity).catch(() => undefined);
    },

    /**
     * Collapses or opens the overlay window (older shells ignore it).
     *
     * @param collapsed True to collapse.
     */
    setOverlayCollapsed(collapsed: boolean) {
      void bridge.setOverlayCollapsed?.(collapsed).catch(() => undefined);
    },

    /**
     * Whether this shell can place, resize and switch the overlay (1.0.2 and later, ADR-0035).
     *
     * @returns True when it has all four methods.
     */
    overlayPlacement() {
      return (
        typeof bridge.placeOverlay === 'function' &&
        typeof bridge.getOverlayPreset === 'function' &&
        typeof bridge.resizeOverlay === 'function' &&
        typeof bridge.setOverlayMode === 'function'
      );
    },

    /**
     * Puts the overlay at a preset place (older shells ignore it).
     *
     * @param preset Where.
     */
    placeOverlay(preset: OverlayPreset) {
      void bridge.placeOverlay?.(preset).catch(() => undefined);
    },

    /**
     * The remembered overlay preset.
     *
     * @returns The preset, or null on an older shell or when the shell does not answer.
     */
    async getOverlayPreset() {
      if (!bridge.getOverlayPreset) return null;
      return bridge.getOverlayPreset().catch(() => null);
    },

    /**
     * One step of resizing the overlay from an edge (older shells ignore it).
     *
     * @param step The step.
     */
    resizeOverlay(step: OverlayResizeStep) {
      void bridge.resizeOverlay?.(step).catch(() => undefined);
    },

    /**
     * Switches the overlay's mode. A shell before 1.0.2 has no modes: it can only collapse the
     * overlay ('collapsed') and open it again ('full'); the script bar then stays full size.
     *
     * @param mode The mode.
     */
    setOverlayMode(mode: OverlayMode) {
      if (bridge.setOverlayMode) {
        void bridge.setOverlayMode(mode).catch(() => undefined);
      } else if (mode === 'collapsed' || mode === 'full') {
        void bridge.setOverlayCollapsed?.(mode === 'collapsed').catch(() => undefined);
      }
    },

    /**
     * Whether this shell has the home panel's calls (1.1.0 and later, ADR-0041).
     *
     * @returns True when it has them.
     */
    hasHomePanel() {
      return (
        typeof bridge.openPagesWindow === 'function' && typeof bridge.windowControl === 'function'
      );
    },

    /**
     * Opens a Kite page: through the shell where it can (a page must not navigate the window running
     * a call), otherwise in this window, as a shell before 1.1.0 expects.
     *
     * @param path The page's path.
     */
    openPagesWindow(path: string) {
      if (bridge.openPagesWindow) void bridge.openPagesWindow(path).catch(() => undefined);
      else window.location.assign(path);
    },

    /**
     * Minimises or closes this window (older shells ignore it).
     *
     * @param action What to do.
     */
    windowControl(action: WindowControlAction) {
      void bridge.windowControl?.(action).catch(() => undefined);
    },

    /**
     * Whether the overlay's window fits its panels (1.1.0 and later).
     *
     * @returns True when it does.
     */
    overlayFitsPanels() {
      return typeof bridge.setOverlayLayout === 'function';
    },

    /**
     * Tells the window which panels are open (older shells ignore it).
     *
     * @param layout The open panels.
     */
    setOverlayLayout(layout: OverlayLayout) {
      void bridge.setOverlayLayout?.(layout).catch(() => undefined);
    },

    /** Minimises the main window (older shells ignore it). */
    minimizeMainWindow() {
      void bridge.minimizeMainWindow?.().catch(() => undefined);
    },

    /**
     * Brings the full call window forward (v1.0.4). A shell before 1.0.4 cannot: closing the overlay
     * brings the main window back there.
     *
     * @returns Resolves when done.
     */
    async showCallWindow() {
      if (bridge.showCallWindow) await bridge.showCallWindow();
      else await bridge.closeCompactView?.();
    },

    /**
     * Which global shortcuts another app already uses.
     *
     * @returns The statuses, or null on a shell that cannot check.
     */
    async checkHotkeys() {
      return bridge.checkHotkeys ? bridge.checkHotkeys() : null;
    },

    /**
     * The Ask Kite shortcut: from the shell, which holds it for as long as the app runs, and while
     * this window has focus. A press that reaches both is handled once. An older shell has only
     * the in-page one.
     *
     * @param handler Called each time it is pressed.
     * @returns A function that stops listening.
     */
    onAskKiteHotkey(handler) {
      let lastAt = -Infinity;
      const once = () => {
        const now = performance.now();
        if (now - lastAt < DUPLICATE_PRESS_MS) return;
        lastAt = now;
        handler();
      };
      const stopPage = listenForAskKite(window, bridge.os === 'mac', once);
      const stopGlobal = bridge.onHotkey?.((action) => {
        if (action === 'ask-kite') once();
      });
      return () => {
        stopPage();
        stopGlobal?.();
      };
    },

    /**
     * The in-page shortcuts on another window (the overlay).
     *
     * @param target  The window.
     * @param handler Called with each action.
     * @returns A function that stops listening.
     */
    listenForFocusedHotkeys(target, handler) {
      return listenForHotkeys(target, bridge.os === 'mac', handler);
    },

    /**
     * Tells the shell whether a call is live (older shells without it ignore the call).
     *
     * @param active True while connected.
     */
    setCallActive(active: boolean) {
      bridge.setCallActive?.(active);
    },

    // v1.0.1 (ADR-0034): present only when this desktop app has the four methods; a failed call
    // reads as "the engine failed", so the page keeps the live engine's line.
    accurate:
      bridge.accurateStatus &&
      bridge.accurateDownload &&
      bridge.accurateRemove &&
      bridge.accurateTranscribe
        ? {
            status: () => bridge.accurateStatus!(),
            download: () => bridge.accurateDownload!(),
            remove: () => bridge.accurateRemove!(),
            transcribe: (samples: Float32Array) =>
              bridge.accurateTranscribe!(samples).catch(() => ({
                ok: false as const,
                code: 'engine' as const,
              })),
          }
        : null,

    /**
     * The hotkeys: the shell's global shortcuts (work from any app, Stage 8) and the in-page
     * shortcuts (while the Kite window has focus; the only ones in a desktop app installed
     * before Day 4, whose bridge has no onHotkey). A key press that reaches both is handled
     * once.
     *
     * @param handler Receives each hotkey action.
     * @param onTaken Receives the shortcuts another app already uses, as labels.
     * @returns A function that stops listening and releases the global shortcuts.
     */
    onHotkey(handler, onTaken) {
      let last: { action: string; at: number } | null = null;
      const once = (action: Parameters<typeof handler>[0]) => {
        const now = performance.now();
        // The same action within 150 ms is one key press seen twice (global and in-page).
        if (last && last.action === action && now - last.at < DUPLICATE_PRESS_MS) return;
        last = { action, at: now };
        handler(action);
      };
      const stopPage = listenForHotkeys(window, bridge.os === 'mac', once);
      const stopGlobal = bridge.onHotkey?.(once);
      let active = true;
      bridge
        .setHotkeysEnabled?.(true)
        .then((statuses) => {
          const taken = statuses.filter((status) => !status.registered);
          if (active && taken.length > 0) {
            onTaken?.(taken.map((status) => acceleratorLabel(status.accelerator, bridge.os)));
          }
        })
        .catch(() => undefined);
      return () => {
        active = false;
        stopPage();
        stopGlobal?.();
        void bridge.setHotkeysEnabled?.(false).catch(() => undefined);
      };
    },

    /**
     * The hotkeys' modifier for labels.
     *
     * @returns '⌘' on macOS, 'Ctrl+' on Windows and Linux.
     */
    hotkeyModifier() {
      return bridge.os === 'mac' ? '⌘' : 'Ctrl+';
    },

    /**
     * The desktop app runs on Windows and macOS computers: live calls always work.
     *
     * @returns True.
     */
    supportsLiveCalls() {
      return true;
    },

    /**
     * setContentProtection on the compact window, through the shell (remembered there).
     *
     * @param on True to hide the compact window from screen sharing.
     * @returns The new state; unsupported in a desktop app from before Day 5.
     */
    async setShareProtection(on: boolean) {
      return bridge.setShareProtection ? bridge.setShareProtection(on) : UNSUPPORTED_PROTECTION;
    },

    /**
     * The shell's remembered protection setting.
     *
     * @returns The state; unsupported in a desktop app from before Day 5.
     */
    async getShareProtection() {
      return bridge.getShareProtection ? bridge.getShareProtection() : UNSUPPORTED_PROTECTION;
    },
  };
}

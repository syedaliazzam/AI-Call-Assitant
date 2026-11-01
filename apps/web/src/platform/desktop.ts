/**
 * File: apps/web/src/platform/desktop.ts
 * Purpose: The Platform implementation used when Kite runs inside the desktop app (Electron).
 *          It wraps `window.kiteDesktop`, the bridge exposed by the shell's preload script.
 *          It reports the shell version and OS, opens the microphone (Day 1) and the other side as
 *          system audio (Day 2), the hotkeys (Day 4), and screenshots, the compact live window and
 *          its screen-share protection through the shell (Day 5).
 * Used by: src/platform/index.ts (getPlatform)
 * Depends on: @kite/shared (KiteDesktopApi), src/platform/types.ts, errors.ts, media.ts,
 *             keymap.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (desktop column), §7.3
 */
import type { DesktopOs, KiteDesktopApi, ShareProtectionState } from '@kite/shared';
import { CaptureError } from './errors';
import { listenForHotkeys } from './keymap';
import {
  openMicrophone,
  requestDisplayMedia,
  stopAllTracks,
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

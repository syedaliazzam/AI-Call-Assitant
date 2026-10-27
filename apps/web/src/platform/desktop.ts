/**
 * File: apps/web/src/platform/desktop.ts
 * Purpose: The Platform implementation used when Kite runs inside the desktop app (Electron).
 *          It wraps `window.kiteDesktop`, the bridge exposed by the shell's preload script.
 *          It reports the shell version and OS, opens the microphone (Day 1) and the other side as
 *          system audio (Day 2); the other methods throw NotImplementedError naming the day.
 * Used by: src/platform/index.ts (getPlatform)
 * Depends on: @kite/shared (KiteDesktopApi), src/platform/types.ts, errors.ts, media.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (desktop column), §7.3
 */
import type { DesktopOs, KiteDesktopApi } from '@kite/shared';
import { CaptureError, NotImplementedError } from './errors';
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
    async captureScreenshot() {
      throw new NotImplementedError('desktop.captureScreenshot', 5);
    },

    /** Day 5: the shell opens a frameless, always-on-top live window. */
    async openCompactView(_sessionId: string) {
      throw new NotImplementedError('desktop.openCompactView', 5);
    },

    /** Day 4: global shortcuts registered by the shell and forwarded to the page. */
    onHotkey(_handler) {
      throw new NotImplementedError('desktop.onHotkey', 4);
    },

    /** Day 5: setContentProtection on the live window. */
    async setShareProtection(_on: boolean) {
      throw new NotImplementedError('desktop.setShareProtection', 5);
    },
  };
}

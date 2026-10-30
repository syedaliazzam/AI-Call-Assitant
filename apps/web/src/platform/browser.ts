/**
 * File: apps/web/src/platform/browser.ts
 * Purpose: The Platform implementation used when Kite runs in Chrome or Edge (no desktop app).
 *          The microphone (Day 1) and the other side through a shared tab with its audio
 *          (Day 2) work, and the in-page hotkeys (Day 4); the other methods throw
 *          NotImplementedError naming the day they arrive.
 * Used by: src/platform/index.ts (getPlatform)
 * Depends on: src/platform/types.ts, src/platform/errors.ts, src/platform/media.ts,
 *             src/platform/keymap.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (browser column)
 */
import { CaptureError, NotImplementedError } from './errors';
import { listenForHotkeys } from './keymap';
import {
  openMicrophone,
  requestDisplayMedia,
  stopAllTracks,
  type DisplayCaptureOptions,
} from './media';
import type { OtherSideSource, Platform } from './types';

/**
 * What the browser asks for when sharing the other side (Chrome's official screen-sharing
 * controls, checked 2026-10-27):
 * - video.displaySurface 'browser': opens the picker on the "Chrome Tab" pane, the only pane with
 *   tab audio (the meeting usually runs in a tab);
 * - audio.suppressLocalAudioPlayback false: the user keeps hearing the meeting while Kite listens;
 * - preferCurrentTab false + selfBrowserSurface 'exclude': Kite's own tab is not offered;
 * - surfaceSwitching 'include': "Share this tab instead" lets the user switch to the right tab;
 * - systemAudio 'include' and monitorTypeSurfaces 'include': on Windows, sharing the entire
 *   screen can carry system audio (for a meeting in a desktop app).
 * Video is required by getDisplayMedia; the track is kept (not shown) for Day 5 screenshots.
 */
export const BROWSER_DISPLAY_OPTIONS: DisplayCaptureOptions = {
  video: { displaySurface: 'browser' },
  audio: { suppressLocalAudioPlayback: false },
  preferCurrentTab: false,
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
  systemAudio: 'include',
  monitorTypeSurfaces: 'include',
};

/** Message when the share has no sound. */
export const NO_TAB_AUDIO_MESSAGE =
  'Kite can’t hear the meeting: the share has no sound. Click Connect again, pick the meeting tab and tick “Also share tab audio” (Chrome or Edge).';

/**
 * Where the sound of a share comes from, from the video track's displaySurface setting.
 *
 * @param stream The shared stream.
 * @returns 'tab-audio' for a tab, 'screen-audio' for a screen or window (or when unknown).
 * Called from: browserPlatform.getOtherSideStream(); tests
 */
export function shareSource(stream: MediaStream): OtherSideSource {
  const settings = stream.getVideoTracks()[0]?.getSettings() as
    { displaySurface?: string } | undefined;
  return settings?.displaySurface === 'browser' ? 'tab-audio' : 'screen-audio';
}

/**
 * Whether the browser runs on macOS (⌘ is the shortcut modifier there).
 *
 * @returns True on a Mac.
 * Called from: browserPlatform.onHotkey(), browserPlatform.hotkeyModifier()
 */
function browserIsMac(): boolean {
  // navigator.platform is deprecated but still set everywhere; the user agent is the fallback.
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Platform implementation for Chrome / Edge. */
export const browserPlatform: Platform = {
  kind: 'browser',

  // Sessions open through the Choose platform dialog (the desktop app is an alternative).
  offersPlatformChoice: true,

  /** Opens the microphone with getUserMedia (the browser asks the user for permission). */
  getMicStream: openMicrophone,

  /**
   * Opens the share picker (tab pane first). The user picks the meeting tab and ticks "Also share
   * tab audio". A share without sound is stopped and reported as 'no-audio-track'.
   *
   * @returns The shared stream and which kind of surface was shared.
   */
  async getOtherSideStream() {
    const stream = await requestDisplayMedia(BROWSER_DISPLAY_OPTIONS, 'browser');
    if (stream.getAudioTracks().length === 0) {
      // Release the share right away: without sound it is of no use.
      stopAllTracks(stream);
      throw new CaptureError('no-audio-track', NO_TAB_AUDIO_MESSAGE);
    }
    return { stream, source: shareSource(stream) };
  },

  /** Day 5: grab a frame from the screen or tab stream the user already shared. */
  async captureScreenshot() {
    throw new NotImplementedError('browser.captureScreenshot', 5);
  },

  /**
   * Day 5: Document Picture-in-Picture window.
   *
   * @param _sessionId The session to show (unused until Day 5).
   */
  async openCompactView(_sessionId: string) {
    throw new NotImplementedError('browser.openCompactView', 5);
  },

  /**
   * In-page keyboard shortcuts while the Kite tab has focus (architecture §7.3; ⌘ on macOS,
   * Ctrl elsewhere). A browser cannot have shortcuts that work from other apps. Day 5 adds the
   * picture-in-picture window.
   *
   * @param handler Receives each hotkey action. (No shortcut can be "taken" in a browser, so
   *                the second argument of the Platform method is not used.)
   * @returns A function that stops listening.
   */
  onHotkey(handler) {
    return listenForHotkeys(window, browserIsMac(), handler);
  },

  /**
   * The hotkeys' modifier for labels.
   *
   * @returns '⌘' on a Mac, 'Ctrl+' elsewhere.
   */
  hotkeyModifier() {
    return browserIsMac() ? '⌘' : 'Ctrl+';
  },

  /**
   * Day 5: returns false (browsers cannot hide a window from screen sharing) and the UI explains.
   *
   * @param _on True to hide the live window from screen sharing (unused until Day 5).
   */
  async setShareProtection(_on: boolean) {
    throw new NotImplementedError('browser.setShareProtection', 5);
  },
};

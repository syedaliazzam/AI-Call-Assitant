/**
 * File: apps/web/src/platform/media.ts
 * Purpose: Media capture code shared by both platforms: the microphone ("You"), and the
 *          getDisplayMedia call and error handling used for the other side ("Them"). Inside
 *          Electron the page uses the same browser APIs (the shell only grants or answers the
 *          requests), so the code lives here once instead of being copied into browser.ts and
 *          desktop.ts. The differences (options, messages, what happens to the video track) stay
 *          in those two files.
 * Used by: src/platform/browser.ts, src/platform/desktop.ts
 * Depends on: browser MediaDevices API; src/platform/errors.ts (CaptureError)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (getMicStream, getOtherSideStream)
 */
import { CaptureError } from './errors';

/**
 * Audio settings for the microphone ("You" channel).
 * - echoCancellation: the other person's voice coming out of the speakers leaks into the
 *   microphone; without it, "Them" would also be transcribed as "You". (Headphones avoid the
 *   leak completely; the Connect view says so.)
 * - noiseSuppression and autoGainControl: steadier levels for speech-to-text in a normal room.
 * - Mono is enough: speech-to-text resamples to 16 kHz mono anyway (core/audio).
 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
};

/**
 * Opens the default microphone with MIC_CONSTRAINTS.
 *
 * @returns A live audio-only MediaStream.
 * @throws Error if the MediaDevices API is missing (old browser, or a page not served over HTTPS).
 * @throws DOMException('NotAllowedError') if the user or the system denies the microphone.
 * Called from: browserPlatform.getMicStream(), createDesktopPlatform().getMicStream()
 */
export async function openMicrophone(): Promise<MediaStream> {
  // mediaDevices is only defined in secure contexts (HTTPS or localhost).
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not available in this browser or on this page.');
  }
  return navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
}

/**
 * getDisplayMedia options, including Chrome's screen-sharing controls that TypeScript's DOM
 * types do not all list yet (Chrome docs "Privacy-preserving screen sharing controls",
 * checked 2026-10-27). Every field is optional and ignored by browsers that do not know it.
 */
export interface DisplayCaptureOptions {
  /** Video request; `displaySurface` pre-selects a pane of Chrome's picker. */
  video: boolean | (MediaTrackConstraints & { displaySurface?: 'browser' | 'window' | 'monitor' });
  /** Audio request; `suppressLocalAudioPlayback: false` keeps the tab audible to the user. */
  audio: boolean | (MediaTrackConstraints & { suppressLocalAudioPlayback?: boolean });
  /** Chrome: offer the current tab first (Kite itself), when true. */
  preferCurrentTab?: boolean;
  /** Chrome: 'exclude' removes the current tab (Kite) from the list. */
  selfBrowserSurface?: 'include' | 'exclude';
  /** Chrome: 'include' shows "Share this tab instead" while sharing. */
  surfaceSwitching?: 'include' | 'exclude';
  /** Chrome: 'include' offers system audio when a whole screen is shared (Windows). */
  systemAudio?: 'include' | 'exclude';
  /** Chrome: 'include' keeps whole screens in the picker. */
  monitorTypeSurfaces?: 'include' | 'exclude';
}

/** Which platform is asking, so errors can be explained for it. */
export type CapturePlatform = 'desktop' | 'browser';

/**
 * Turns a getDisplayMedia failure into a CaptureError with a message for the user.
 * - NotAllowedError: in a browser, the user closed the picker (or, with "by system" in the
 *   message, the OS refused, for example macOS screen-recording privacy); in the desktop app it
 *   means the request was refused.
 * - AbortError: the desktop shell refused (for example no screen source on macOS without the
 *   Screen Recording permission).
 * - Anything else: not supported here.
 *
 * @param error    What getDisplayMedia threw.
 * @param platform Which platform asked.
 * @param os       Desktop OS ('mac' adds macOS privacy instructions), if known.
 * @returns A CaptureError (the original error is never shown to the user as is).
 * Called from: requestDisplayMedia()
 */
export function toCaptureError(
  error: unknown,
  platform: CapturePlatform,
  os?: string,
): CaptureError {
  if (error instanceof CaptureError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  const macPrivacy =
    'Allow Kite under System Settings → Privacy & Security → Screen & System Audio Recording, then try again.';
  if (platform === 'browser' && name === 'NotAllowedError' && !/system/i.test(message)) {
    return new CaptureError(
      'user-cancelled',
      'Sharing was cancelled. Click Connect again and pick the meeting tab.',
    );
  }
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return new CaptureError(
      'permission-denied',
      os === 'mac'
        ? `Kite was not allowed to capture the call's sound. ${macPrivacy}`
        : "Kite was not allowed to capture the call's sound. Check your system's privacy settings, then try again.",
    );
  }
  return new CaptureError(
    'not-supported',
    "This browser can't share a call's sound with Kite. Use the latest Chrome or Edge, or the Kite desktop app.",
  );
}

/**
 * Calls getDisplayMedia and turns every failure into a CaptureError.
 *
 * @param options  What to request.
 * @param platform Which platform asks (for the error messages).
 * @param os       Desktop OS, if known.
 * @returns The shared stream.
 * @throws CaptureError when the API is missing or the request fails.
 * Called from: browserPlatform.getOtherSideStream(), createDesktopPlatform().getOtherSideStream()
 */
export async function requestDisplayMedia(
  options: DisplayCaptureOptions,
  platform: CapturePlatform,
  os?: string,
): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    throw toCaptureError(new Error('getDisplayMedia is not available'), platform, os);
  }
  try {
    // The cast: DisplayCaptureOptions adds Chrome options the DOM types do not list yet.
    return await navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions);
  } catch (error) {
    throw toCaptureError(error, platform, os);
  }
}

/**
 * Stops every track of a stream (releases the share or the device).
 *
 * @param stream The stream.
 * Called from: browser.ts and desktop.ts when a share is unusable
 */
export function stopAllTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

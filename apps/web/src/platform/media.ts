/**
 * File: apps/web/src/platform/media.ts
 * Purpose: Media capture code shared by both platforms: the microphone ("You"), and the
 *          getDisplayMedia call and error handling used for the other side ("Them"). Inside
 *          Electron the page uses the same browser APIs (the shell only grants or answers the
 *          requests), so the code lives here once instead of being copied into browser.ts and
 *          desktop.ts. The differences (options, messages, what happens to the video track) stay
 *          in those two files. Also the frame grab for browser screenshots (Day 5).
 * Used by: src/platform/browser.ts, src/platform/desktop.ts
 * Depends on: browser MediaDevices API, HTMLVideoElement, OffscreenCanvas; @kite/shared
 *             (fitWithin); src/platform/errors.ts (CaptureError)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (getMicStream, getOtherSideStream)
 */
import { fitWithin } from '@kite/shared';
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
 * Opens a microphone with MIC_CONSTRAINTS.
 *
 * @param deviceId The device to open (v1.1.0: the overlay's device list); the system's default when
 *                 absent, or when that device has gone.
 * @returns A live audio-only MediaStream.
 * @throws Error if the MediaDevices API is missing (old browser, or a page not served over HTTPS).
 * @throws DOMException('NotAllowedError') if the user or the system denies the microphone.
 * Called from: browserPlatform.getMicStream(), createDesktopPlatform().getMicStream()
 */
export async function openMicrophone(deviceId?: string): Promise<MediaStream> {
  // mediaDevices is only defined in secure contexts (HTTPS or localhost).
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not available in this browser or on this page.');
  }
  if (!deviceId) return navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  // 'ideal': an unplugged device falls back to the default rather than failing the call.
  return navigator.mediaDevices.getUserMedia({
    ...MIC_CONSTRAINTS,
    audio: { ...(MIC_CONSTRAINTS.audio as MediaTrackConstraints), deviceId: { ideal: deviceId } },
  });
}

/** A microphone in the overlay's device list (v1.1.0). */
export interface MicDevice {
  /** The device's id. */
  id: string;
  /** Its name. */
  label: string;
}

/**
 * The microphones on this computer. Their names are available once the microphone has been allowed,
 * as it has during a call.
 *
 * @returns The microphones ([] where the browser cannot list them).
 * Called from: browserPlatform.listMicrophones(), createDesktopPlatform().listMicrophones(); tests
 */
export async function listMicrophones(): Promise<MicDevice[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audioinput' && device.deviceId !== '')
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }));
}

/**
 * Watches whether the computer is on battery (v1.1.0, ADR-0044: Accurate transcription on Auto). The
 * page's own Battery API, so it also works in a desktop app before 1.1.0.
 *
 * @param handler Called now and on every change, with true on battery, false plugged in, or null when
 *                it cannot be told (a browser without the API).
 * @returns A function that stops watching.
 * Called from: browserPlatform.watchBattery(), createDesktopPlatform().watchBattery(); tests
 */
export function watchBatteryState(handler: (onBattery: boolean | null) => void): () => void {
  const nav = navigator as Navigator & {
    /** Chromium's Battery Status API. */
    getBattery?: () => Promise<EventTarget & { charging: boolean }>;
  };
  if (!nav.getBattery) {
    handler(null);
    return () => undefined;
  }
  let stop = () => undefined as void;
  let active = true;
  nav
    .getBattery()
    .then((battery) => {
      if (!active) return;
      const report = () => handler(!battery.charging);
      report();
      battery.addEventListener('chargingchange', report);
      stop = () => battery.removeEventListener('chargingchange', report);
    })
    .catch(() => handler(null));
  return () => {
    active = false;
    stop();
  };
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

/** A share's frames, ready to be drawn at any moment. */
export interface FrameSource {
  /**
   * Draws the share's current frame as a PNG, at a size whose longest side is at most
   * 1,568 px (core/screenshot/prepare.ts then encodes the JPEG).
   *
   * @returns The frame (in memory only; never stored or logged).
   */
  grab(): Promise<Blob>;
  /** Stops playing the frames (the share itself is not stopped). */
  close(): void;
}

/**
 * Starts showing a share's video track in a muted, unattached video element, so a screenshot
 * can draw the current frame at once. (ImageCapture.grabFrame() waits for the next frame, and a
 * still tab sends new frames rarely: measured about 2.1 s per screenshot on Day 5.)
 *
 * @param track The live video track of the share (it keeps running; it is the call's share).
 * @returns The frame source.
 * Called from: browserPlatform.getOtherSideStream()
 */
export function startFrameSource(track: MediaStreamTrack): FrameSource {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  const playing = video.play().catch(() => undefined);
  return {
    async grab() {
      await playing;
      // The very first frame may still be on its way just after the share starts.
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('no frame')), 5_000);
          video.addEventListener(
            'loadeddata',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
      const size = { width: video.videoWidth, height: video.videoHeight };
      if (size.width === 0 || size.height === 0) throw new Error('empty frame');
      const fitted = fitWithin(size);
      const canvas = new OffscreenCanvas(fitted.width, fitted.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(video, 0, 0, fitted.width, fitted.height);
      return canvas.convertToBlob({ type: 'image/png' });
    },
    close() {
      video.pause();
      video.srcObject = null;
    },
  };
}

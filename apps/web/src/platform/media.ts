/**
 * File: apps/web/src/platform/media.ts
 * Purpose: Microphone capture shared by both platforms. Inside Electron the page uses the same
 *          getUserMedia call as a browser (the shell only grants the permission), so the code
 *          lives here once instead of being copied into browser.ts and desktop.ts.
 * Used by: src/platform/browser.ts, src/platform/desktop.ts
 * Depends on: browser MediaDevices API
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (getMicStream)
 */

/**
 * Audio settings for the microphone ("You" channel).
 * Echo cancellation stays on so the other person's voice coming out of the speakers is not
 * transcribed a second time as "You". Mono is enough for speech-to-text, which resamples to
 * 16 kHz mono anyway (core/audio, Day 2).
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

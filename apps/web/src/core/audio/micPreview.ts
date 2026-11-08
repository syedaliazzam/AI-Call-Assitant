/**
 * File: apps/web/src/core/audio/micPreview.ts
 * Purpose: The microphone level on the Connect card, before a call (ADR-0053): opens the chosen
 *          microphone through the platform, measures its level for one meter, and releases it. It
 *          feeds nothing to speech-to-text and keeps no audio; the level is a number only. Also
 *          tells the card whether the microphone is already allowed, so the meter can start by itself
 *          without making the browser ask.
 * Used by: src/features/live/useMicPreview.ts (the Connect card's "You" meter)
 * Depends on: src/platform (getPlatform), src/core/audio/levels.ts, src/core/audio/capture.ts (micError)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect); ADR-0053
 *
 * The preview is stopped before Connect opens the call's own capture, so the call never shares a
 * microphone stream with it. Audio never leaves the device.
 */
import { getPlatform, type Platform } from '@/platform';
import { LEVEL_INTERVAL_MS, micError, type CaptureDeps } from './capture';
import { LevelSmoother, rms, rmsToLevel } from './levels';

/**
 * Whether this page may use the microphone without asking:
 * 'granted' (allowed; the desktop app's shell always answers this for its own address),
 * 'prompt' (the browser would ask), 'denied' (blocked in the site settings),
 * 'unknown' (the browser cannot say).
 */
export type MicPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/** The parts of navigator that microphonePermission() reads (injectable for tests). */
export interface PermissionsNavigator {
  /** The Permissions API, missing in some browsers. */
  permissions?: {
    /** Asks for one permission's state ('granted', 'prompt' or 'denied'). */
    query(descriptor: { name: string }): Promise<{ state: string }>;
  };
}

/**
 * Asks the browser whether the microphone is already allowed for this page. Never throws: a browser
 * without the Permissions API, or one that does not know the 'microphone' name, gives 'unknown'.
 *
 * @param nav The navigator (default the page's).
 * @returns The permission state.
 * Called from: useMicPreview() (features/live/useMicPreview.ts); tests
 */
export async function microphonePermission(
  nav: PermissionsNavigator = globalThis.navigator as PermissionsNavigator,
): Promise<MicPermission> {
  try {
    const status = await nav.permissions?.query({ name: 'microphone' });
    const state = status?.state;
    return state === 'granted' || state === 'prompt' || state === 'denied' ? state : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Options for startMicPreview(). */
export interface MicPreviewOptions {
  /** The microphone to open; the system's default when absent or ''. */
  deviceId?: string;
  /** Receives the smoothed level (0…1) about every LEVEL_INTERVAL_MS. */
  onLevel: (level: number) => void;
  /** The platform (default getPlatform()). */
  platform?: Pick<Platform, 'getMicStream'>;
  /** Browser objects (tests only). */
  deps?: Partial<CaptureDeps>;
}

/** A running microphone preview. */
export interface MicPreview {
  /** Stops the meter and releases the microphone (idempotent). */
  stop(): void;
}

/**
 * Opens the microphone and measures its level for the Connect card's meter.
 *
 * @param options See MicPreviewOptions.
 * @returns The running preview.
 * @throws CallCaptureError on 'you' when the microphone cannot be opened (blocked, missing, busy).
 * Called from: useMicPreview() (features/live/useMicPreview.ts); tests
 */
export async function startMicPreview(options: MicPreviewOptions): Promise<MicPreview> {
  const platform = options.platform ?? getPlatform();
  const deps: CaptureDeps = {
    createAudioContext: options.deps?.createAudioContext ?? (() => new AudioContext()),
    setInterval: options.deps?.setInterval ?? ((callback, ms) => setInterval(callback, ms)),
    clearInterval: options.deps?.clearInterval ?? ((timer) => clearInterval(timer)),
  };

  let stream: MediaStream;
  try {
    stream = await (options.deviceId
      ? platform.getMicStream(options.deviceId)
      : platform.getMicStream());
  } catch (error) {
    throw micError(error);
  }

  // An analyser in a context of its own, never connected to the speakers: the meter only reads it.
  const context = deps.createAudioContext();
  const resumeIfSuspended = () => {
    // Chrome can create the context suspended (no click yet on this page); the meter would then
    // read silence. Resuming on each tick lets it start as soon as the browser allows.
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
  };
  resumeIfSuspended();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  const smoother = new LevelSmoother();
  const timer = deps.setInterval(() => {
    resumeIfSuspended();
    analyser.getFloatTimeDomainData(buffer);
    options.onLevel(smoother.update(rmsToLevel(rms(buffer))));
  }, LEVEL_INTERVAL_MS);

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      deps.clearInterval(timer);
      void context.close().catch(() => undefined);
      for (const track of stream.getTracks()) track.stop();
    },
  };
}

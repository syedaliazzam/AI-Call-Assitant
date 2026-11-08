/**
 * File: apps/web/src/core/audio/capture.ts
 * Purpose: Starts the audio of a call: asks the platform for the other side ("Them") and the
 *          microphone ("You"), attaches each to the speech-to-text engine as its own channel,
 *          measures a level per channel for the meters, and reports when a channel ends (shared
 *          tab closed, sharing stopped, microphone unplugged). "You" and "Them" stay two
 *          separate streams; they are never mixed.
 * Used by: the live page (Day 2 Stage 4: LivePage / ConnectPanel)
 * Depends on: src/platform (getPlatform, CaptureError), src/core/stt/sttEngine.ts (engine
 *             attach/detach), src/core/audio/levels.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3, §6.1 step 1, §7.1 (core/audio)
 *
 * Order matters: the other side is requested FIRST, straight from the user's click, then the
 * microphone. Since ADR-0053 the live page may open the overlay (picture-in-picture) just before
 * this in the same click; Chrome 156 still opens the share picker after that window used the
 * click (measured 8 Nov 2026). Audio never leaves the device.
 */
import {
  CaptureError,
  getPlatform,
  type CaptureErrorCode,
  type OtherSideSource,
  type Platform,
} from '@/platform';
import type { ChannelId } from '../stt/protocol';
import type { SttEngine } from '../stt/sttEngine';
import { LevelSmoother, rms, rmsToLevel } from './levels';

/** How often the meters are measured, in ms. */
export const LEVEL_INTERVAL_MS = 50;

/** A capture failure, with the channel it happened on. */
export class CallCaptureError extends Error {
  /** Which channel failed. */
  readonly channel: ChannelId;
  /** Why (the platform's CaptureError codes). */
  readonly code: CaptureErrorCode;

  /**
   * @param channel Which channel failed.
   * @param code    Why.
   * @param message What happened and what to do, for the user.
   */
  constructor(channel: ChannelId, code: CaptureErrorCode, message: string) {
    super(message);
    this.name = 'CallCaptureError';
    this.channel = channel;
    this.code = code;
  }
}

/** Something that happened to a running capture. */
export type CaptureEvent = {
  /** A channel's audio stopped (its track ended); it was detached from the engine. */
  type: 'channel-ended';
  /** Which channel. */
  channel: ChannelId;
};

/** Per-channel meter levels, 0…1. */
export type ChannelLevels = Record<ChannelId, number>;

/** Browser objects capture.ts creates (injectable for tests). */
export interface CaptureDeps {
  /** Creates the AudioContext used only for the meters. */
  createAudioContext: () => AudioContext;
  /** Starts the meter timer (setInterval). */
  setInterval: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** Stops the meter timer (clearInterval). */
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
}

/** Options for startCallCapture(). */
export interface CallCaptureOptions {
  /** The engine to attach the channels to (already created; attach waits until it is ready). */
  engine: Pick<SttEngine, 'attach' | 'detach'>;
  /** The platform (default getPlatform()). */
  platform?: Pick<Platform, 'getMicStream' | 'getOtherSideStream'>;
  /** The microphone to open (v1.1.0); the system's default when absent. */
  micDeviceId?: string;
  /** Meter levels, about every LEVEL_INTERVAL_MS. */
  onLevels?: (levels: ChannelLevels) => void;
  /** Channel events (a channel ended). */
  onEvent?: (event: CaptureEvent) => void;
  /** Browser objects (tests only). */
  deps?: Partial<CaptureDeps>;
}

/** A running capture. */
export interface CallCapture {
  /** Where "Them" comes from now (system sound, a tab, or a screen); changeOtherSide() can change it. */
  readonly themSource: OtherSideSource;
  /**
   * The current other-side ("Them") MediaStream. In a browser it carries the shared tab's video
   * track, which the split-view preview renders; on the desktop (system audio) it has no video.
   */
  otherSideStream(): MediaStream;
  /** The latest meter levels. */
  levels(): ChannelLevels;
  /**
   * Moves the capture's channels to a fresh engine, keeping the same audio streams, so the live
   * page can restart a stuck engine without re-asking for the microphone or the shared tab
   * (watchdog.ts; Day 6 Stage 4). Channels that have already ended are left detached. From now on
   * the capture detaches this new engine when it stops or a channel ends.
   *
   * @param engine The replacement engine (already created; attach waits until it is ready).
   */
  reattach(engine: Pick<SttEngine, 'attach' | 'detach'>): Promise<void>;
  /**
   * Re-picks the other side (a fresh share) without ending the call: swaps the "Them" stream on the
   * engine and the meter, stops the old one, and returns where the new share comes from. Must be
   * called straight from a user gesture (a browser needs one for getDisplayMedia).
   *
   * @returns The new other-side source.
   */
  changeOtherSide(): Promise<OtherSideSource>;
  /**
   * Switches the microphone without ending the call (v1.1.0, the overlay's device list): swaps the
   * "You" stream on the engine and the meter, and stops the old one. "Them" is not touched.
   *
   * @param deviceId The device's id ('' for the system's default).
   * @throws CallCaptureError when that microphone cannot be opened; the current one keeps running.
   */
  changeMic(deviceId: string): Promise<void>;
  /**
   * Stops listening without ending the call (v1.1.0, ADR-0044: nobody spoke for 30 minutes): the
   * speech engine gets no audio, while the streams stay open, so resume() needs no new permission and
   * no new share.
   */
  pause(): void;
  /** Listens again after pause(). */
  resume(): Promise<void>;
  /** Stops both channels, the meters and every captured track. */
  stop(): void;
}

/** The meter of one channel. */
interface Meter {
  /** The stream source feeding the analyser (replaced when the shared tab changes). */
  source: MediaStreamAudioSourceNode;
  /** Reads the channel's latest samples. */
  analyser: AnalyserNode;
  /** Sample buffer for getFloatTimeDomainData. */
  buffer: Float32Array<ArrayBuffer>;
  /** Display smoothing. */
  smoother: LevelSmoother;
}

/**
 * Turns a microphone failure into a CallCaptureError.
 *
 * @param error What getMicStream threw.
 * @returns A typed error with a message for the user.
 * Called from: startCallCapture() and changeMic() here; startMicPreview() in micPreview.ts (ADR-0053)
 */
export function micError(error: unknown): CallCaptureError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new CallCaptureError(
      'you',
      'permission-denied',
      'Paramount AI can’t use your microphone. Allow microphone access for Paramount AI, then click Connect again.',
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new CallCaptureError(
      'you',
      'not-supported',
      'No microphone was found. Plug one in (or a headset), then click Connect again.',
    );
  }
  return new CallCaptureError(
    'you',
    'not-supported',
    'The microphone could not be opened. Check that no other app is using it, then click Connect again.',
  );
}

/**
 * Starts capturing both sides of the call and transcribing them.
 *
 * @param options Engine, platform, callbacks.
 * @returns The running capture.
 * @throws CallCaptureError for 'them' (from the platform's CaptureError) or 'you' (microphone).
 *         Anything already opened is released first.
 * Called from: the Connect view's "Connect" click (Stage 4)
 */
export async function startCallCapture(options: CallCaptureOptions): Promise<CallCapture> {
  const platform = options.platform ?? getPlatform();
  const deps: CaptureDeps = {
    createAudioContext: options.deps?.createAudioContext ?? (() => new AudioContext()),
    setInterval: options.deps?.setInterval ?? ((callback, ms) => setInterval(callback, ms)),
    clearInterval: options.deps?.clearInterval ?? ((timer) => clearInterval(timer)),
  };

  // 1. The other side first (needs the click's user gesture in a browser).
  let them;
  try {
    them = await platform.getOtherSideStream();
  } catch (error) {
    if (error instanceof CaptureError)
      throw new CallCaptureError('them', error.code, error.message);
    throw error;
  }

  // 2. The microphone.
  let mic: MediaStream;
  try {
    mic = await (options.micDeviceId
      ? platform.getMicStream(options.micDeviceId)
      : platform.getMicStream());
  } catch (error) {
    for (const track of them.stream.getTracks()) track.stop();
    throw micError(error);
  }

  const streams: Record<ChannelId, MediaStream> = { you: mic, them: them.stream };
  let stopped = false;
  const ended = new Set<ChannelId>();
  // Where "Them" comes from now; the shared tab can be changed mid-call (changeOtherSide).
  let themSourceValue = them.source;
  // The engine the capture feeds. A watchdog restart swaps it (reattach); release() and the
  // channel-ended handlers always detach the current one.
  let engine = options.engine;

  // 3. Meters: an AnalyserNode per channel in an AudioContext of their own (never played back).
  const context = deps.createAudioContext();
  // Chrome can leave a new AudioContext suspended, for example when it was created while the
  // Kite tab was in the background (Chrome switches to the tab the user just shared). A
  // suspended context gives the meters only silence, while transcription (in the worker) goes
  // on: the 'Them meter stayed grey after Reconnect' report on Day 2. So it is resumed now and
  // on every meter tick until it runs.
  const resumeIfSuspended = () => {
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
  };
  resumeIfSuspended();
  const meters = {} as Record<ChannelId, Meter>;
  const current: ChannelLevels = { you: 0, them: 0 };
  for (const channel of ['you', 'them'] as const) {
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const source = context.createMediaStreamSource(streams[channel]);
    source.connect(analyser);
    meters[channel] = {
      source,
      analyser,
      buffer: new Float32Array(analyser.fftSize),
      smoother: new LevelSmoother(),
    };
  }
  const timer = deps.setInterval(() => {
    resumeIfSuspended();
    for (const channel of ['you', 'them'] as const) {
      const meter = meters[channel];
      meter.analyser.getFloatTimeDomainData(meter.buffer);
      current[channel] = ended.has(channel)
        ? 0
        : meter.smoother.update(rmsToLevel(rms(meter.buffer)));
    }
    options.onLevels?.({ ...current });
  }, LEVEL_INTERVAL_MS);

  /** Releases everything (idempotent). */
  const release = () => {
    if (stopped) return;
    stopped = true;
    deps.clearInterval(timer);
    void context.close();
    for (const channel of ['you', 'them'] as const) {
      engine.detach(channel);
      for (const track of streams[channel].getTracks()) track.stop();
    }
  };

  // 4. A channel ends when its audio track ends (for example "Stop sharing", a closed tab, an
  //    unplugged microphone): detach it and tell the UI, which offers to reconnect.
  /**
   * Watches a channel's current audio track(s) for their 'ended' event.
   *
   * @param channel Which channel.
   */
  const watchEnds = (channel: ChannelId) => {
    for (const track of streams[channel].getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (stopped || ended.has(channel)) return;
        ended.add(channel);
        engine.detach(channel);
        options.onEvent?.({ type: 'channel-ended', channel });
      });
    }
  };
  for (const channel of ['you', 'them'] as const) watchEnds(channel);

  // 5. Transcribe both, as separate channels.
  try {
    await engine.attach('them', them.stream);
    await engine.attach('you', mic);
  } catch (error) {
    release();
    throw error;
  }

  return {
    get themSource() {
      return themSourceValue;
    },
    otherSideStream: () => streams.them,
    levels: () => ({ ...current }),
    async reattach(nextEngine) {
      engine = nextEngine;
      // Re-attach only the channels that are still live; an ended one stays detached.
      for (const channel of ['them', 'you'] as const) {
        if (!stopped && !ended.has(channel)) await engine.attach(channel, streams[channel]);
      }
    },
    async changeOtherSide() {
      if (stopped) return themSourceValue;
      // A fresh user gesture is needed for getDisplayMedia, so this runs straight from the click.
      const next = await platform.getOtherSideStream();
      const old = streams.them;
      streams.them = next.stream;
      themSourceValue = next.source;
      ended.delete('them');
      // Move the "Them" meter onto the new stream.
      meters.them.source.disconnect();
      meters.them.source = context.createMediaStreamSource(next.stream);
      meters.them.source.connect(meters.them.analyser);
      meters.them.smoother = new LevelSmoother();
      watchEnds('them');
      // attach() replaces the channel's current stream in the engine.
      await engine.attach('them', next.stream);
      for (const track of old.getTracks()) track.stop();
      return next.source;
    },
    async changeMic(deviceId) {
      if (stopped) return;
      let next: MediaStream;
      try {
        next = await (deviceId ? platform.getMicStream(deviceId) : platform.getMicStream());
      } catch (error) {
        throw micError(error);
      }
      const old = streams.you;
      streams.you = next;
      ended.delete('you');
      meters.you.source.disconnect();
      meters.you.source = context.createMediaStreamSource(next);
      meters.you.source.connect(meters.you.analyser);
      meters.you.smoother = new LevelSmoother();
      watchEnds('you');
      // attach() replaces the channel's current stream in the engine.
      await engine.attach('you', next);
      for (const track of old.getTracks()) track.stop();
    },
    pause() {
      for (const channel of ['them', 'you'] as const) engine.detach(channel);
    },
    async resume() {
      for (const channel of ['them', 'you'] as const) {
        if (!stopped && !ended.has(channel)) await engine.attach(channel, streams[channel]);
      }
    },
    stop: release,
  };
}

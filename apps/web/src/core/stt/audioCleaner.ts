/**
 * File: apps/web/src/core/stt/audioCleaner.ts
 * Purpose: The audio worker's work, kept apart so it can be unit tested (ADR-0076, investigation C5): the
 *          other side's chunks ("Them") pass through and serve as the reference; each microphone chunk
 *          ("You") is cleaned in time order before it leaves the device: WebRTC AEC3 removes the other
 *          side's voice heard through the speakers, then the coupling gate silences a chunk that is still
 *          mostly that voice. Nothing is decoded here. Also turns chunks into 16-bit PCM (linear16) for
 *          Deepgram.
 * Used by: src/core/stt/audio.worker.ts; tests/unit/core/stt/audioCleaner.test.ts
 * Depends on: src/core/stt/coupling.ts (CouplingGate), src/core/stt/echoCanceller.ts (EchoCanceller)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md C1, C5; ADR-0070 (AEC3), ADR-0076
 */
import { CouplingGate } from './coupling';
import type { EchoCanceller } from './echoCanceller';
import type { ChannelId } from './protocol';

/** A cleaned chunk, ready to send. */
export interface CleanChunk {
  /** Which channel. */
  channel: ChannelId;
  /** 16 kHz mono samples after cleaning (the "Them" chunk unchanged). Never logged. */
  samples: Float32Array;
  /** Capture time of the last sample on the audio clock, seconds. */
  endTime: number;
}

/**
 * Float samples (−1…1) as 16-bit little-endian PCM, the "linear16" encoding Deepgram takes.
 *
 * @param samples The samples.
 * @returns A new buffer of samples.length × 2 bytes.
 * Called from: audio.worker.ts; tests
 */
export function toLinear16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    // Clamped, then scaled asymmetrically so −1 maps to −32768 and +1 to 32767.
    const value = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return buffer;
}

/** Cleans the microphone against the other side, in time order. */
export class AudioCleaner {
  /** Receives every chunk once it may leave (cleaned for "You"). */
  private readonly emit: (chunk: CleanChunk) => void;
  /** Makes a fresh echo canceller for a new "Them" stream, or returns null when there is none. */
  private readonly newEcho: () => EchoCanceller | null;
  /** The coupling gate (learnt again for each new "Them" stream). */
  private coupling = new CouplingGate();
  /** This "Them" stream's echo canceller, or null. */
  private echo: EchoCanceller | null = null;
  /** Whether a "Them" stream is attached (without one, "You" never waits for a reference). */
  private themAttached = false;
  /** "You" chunks waiting for the "Them" sound they may echo (one or two at most). */
  private readonly heldYou: { samples: Float32Array; endTime: number }[] = [];
  /** Set when the echo canceller failed; the audio then goes on without it. */
  private echoFailed = false;

  /**
   * @param emit    Receives cleaned chunks.
   * @param newEcho Makes an echo canceller (null: none available, the gate still runs).
   */
  constructor(emit: (chunk: CleanChunk) => void, newEcho: () => EchoCanceller | null) {
    this.emit = emit;
    this.newEcho = newEcho;
  }

  /**
   * The echo canceller's state for the statistics.
   *
   * @returns 'on', 'off' (none available) or 'failed'.
   */
  echoState(): 'on' | 'off' | 'failed' {
    if (this.echoFailed) return 'failed';
    return this.echo ? 'on' : 'off';
  }

  /**
   * Marks a channel as attached ("Them": a new stream, so the echo path is learnt again).
   *
   * @param channel Which channel.
   * Called from: audio.worker.ts ('attach')
   */
  attach(channel: ChannelId): void {
    if (channel !== 'them') return;
    this.themAttached = true;
    this.coupling = new CouplingGate();
    this.echo = null;
  }

  /**
   * Marks a channel as detached: waiting "You" chunks go out now (no more reference is coming).
   *
   * @param channel Which channel.
   * Called from: audio.worker.ts ('detach')
   */
  detach(channel: ChannelId): void {
    if (channel === 'them') this.themAttached = false;
    this.release(true);
  }

  /**
   * Takes one chunk of a channel.
   *
   * @param channel Which channel.
   * @param samples 16 kHz samples.
   * @param endTime Capture time of the last sample (audio clock, seconds).
   * Called from: audio.worker.ts (each worklet chunk)
   */
  push(channel: ChannelId, samples: Float32Array, endTime: number): void {
    if (channel === 'them') {
      if (!this.echo && !this.echoFailed) this.echo = this.safeNewEcho();
      this.withEcho((canceller) => {
        canceller.addReference(samples);
        return samples;
      }, samples);
      this.coupling.pushThem(samples, endTime);
      this.emit({ channel, samples, endTime });
      this.release(false);
      return;
    }
    this.heldYou.push({ samples, endTime });
    this.release(false);
  }

  /**
   * Sends the "You" chunks that can be decided now: their reference has arrived, no "Them" stream is
   * attached, or they have waited long enough (more than two waiting, or forced).
   *
   * @param force True to send every waiting chunk.
   */
  private release(force: boolean): void {
    while (this.heldYou.length > 0) {
      const next = this.heldYou[0]!;
      const waiting =
        !force &&
        this.themAttached &&
        this.heldYou.length <= 2 &&
        !this.coupling.hasReferenceFor(next.samples, next.endTime);
      if (waiting) return;
      this.heldYou.shift();
      const cancelled = this.withEcho((canceller) => canceller.cancel(next.samples), next.samples);
      const cleaned = this.coupling.processYou(cancelled, next.endTime);
      this.emit({ channel: 'you', samples: cleaned, endTime: next.endTime });
    }
  }

  /**
   * A new echo canceller, or null when making one fails.
   *
   * @returns The canceller or null.
   */
  private safeNewEcho(): EchoCanceller | null {
    try {
      return this.newEcho();
    } catch {
      this.echoFailed = true;
      return null;
    }
  }

  /**
   * Runs one echo canceller step; a failure turns echo cancelling off for the rest of the call and hands
   * the audio back unchanged (the audio never stops for it).
   *
   * @param step     The step.
   * @param fallback The audio to use without it.
   * @returns The step's result, or the fallback.
   */
  private withEcho(
    step: (canceller: EchoCanceller) => Float32Array,
    fallback: Float32Array,
  ): Float32Array {
    if (!this.echo) return fallback;
    try {
      return step(this.echo);
    } catch {
      this.echo = null;
      this.echoFailed = true;
      return fallback;
    }
  }
}

/**
 * File: apps/web/src/core/stt/channel.ts
 * Purpose: Decodes one call channel ("you" or "them") on the shared recognizer: feeds ~100 ms
 *          chunks to the channel's own sherpa-onnx stream, posts partial text, decides when an
 *          utterance ends, and keeps that channel's timing statistics. Kept apart from the
 *          worker's message handling so it can be unit tested with a fake recognizer.
 * Used by: src/core/stt/stt.worker.ts (one ChannelDecoder per attached channel)
 * Depends on: src/core/stt/metrics.ts (OnsetDetector, realTimeFactor), src/core/stt/gate.ts
 *             (SilenceGate, lastLoudSampleEnd), src/core/stt/protocol.ts (types),
 *             src/core/audio/resample.ts (TARGET_SAMPLE_RATE)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2, §6.2; ADR-0020
 *
 * How an utterance ends (a "final" line), whichever comes first:
 * 1. the recognizer's endpoint rule 2: about 1 s of decoded silence after some text;
 * 2. the pause rule (safety net): no new words for 1.2 s of audio while text is showing. On
 *    Day 1 the model's rule did not fire with one live microphone; this rule did. It watches
 *    the text, not the microphone level: a loudness threshold cut sentences in the middle when
 *    the voice was quiet (measured on Day 1). Silero VAD was tried and rejected (ADR-0020).
 * Both rules run separately for each channel.
 *
 * Silence is not decoded: each channel has an energy gate (gate.ts) that holds back chunks while
 * the channel is idle, so a silent channel costs almost no CPU and cannot produce phantom words.
 */
import { TARGET_SAMPLE_RATE } from '../audio/resample';
import { lastLoudSampleEnd, SilenceGate, type GateChunk } from './gate';
import { OnsetDetector, realTimeFactor } from './metrics';
import type { ChannelId, ChannelStats, EndpointReason, FromWorker } from './protocol';

/** Pause rule: audio (ms) with no new words, while text is showing, that ends an utterance. */
export const PAUSE_END_MS = 1_200;

/** How many recent lag values each channel keeps. */
const MAX_LAGS = 50;

/** Loudness that counts as speech for the end of speech when there is no gate (tests). */
const DEFAULT_SPEECH_RMS = 0.004;

/** The parts of a sherpa-onnx OnlineStream (sherpa-onnx-asr.js) a channel uses. */
export interface StreamLike {
  /** Adds samples (16 kHz, -1…1). */
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  /** Marks the end of input, so the decoder emits the words it was holding back. */
  inputFinished(): void;
  /** Releases the stream's WebAssembly memory. */
  free(): void;
}

/** The parts of a sherpa-onnx OnlineRecognizer a channel uses. */
export interface RecognizerLike {
  /** New stream with its own decoder state. */
  createStream(): StreamLike;
  /** True when the stream has enough audio for another decoding step. */
  isReady(stream: StreamLike): boolean;
  /** One decoding step. */
  decode(stream: StreamLike): void;
  /** True when the recognizer's endpoint rules say the utterance ended. */
  isEndpoint(stream: StreamLike): boolean;
  /** Starts a new utterance on the same stream. */
  reset(stream: StreamLike): void;
  /** The stream's current text. */
  getResult(stream: StreamLike): { text: string };
}

/** Messages a channel produces (a subset of the worker's FromWorker). */
export type ChannelEvent = Extract<FromWorker, { type: 'partial' } | { type: 'final' }>;

/** Clocks the channel uses (injectable for tests). */
export interface ChannelClock {
  /** The worker's performance.now(), in ms. */
  now: () => number;
  /** performance.timeOrigin: Unix ms at performance.now() = 0. */
  timeOrigin: number;
}

/** Options for ChannelDecoder. */
export interface ChannelOptions {
  /** Clocks (default: the worker's own performance clock). */
  clock?: ChannelClock;
  /** Rate of the AudioContext feeding this channel (statistics only; default 16000). */
  inputSampleRate?: number;
  /** Energy gate (default: a new SilenceGate; null = decode every chunk, for tests). */
  gate?: SilenceGate | null;
}

/** One channel's decoder. */
export class ChannelDecoder {
  /** Which channel. */
  readonly id: ChannelId;
  /** The shared recognizer (replaced when hotwords change). */
  private recognizer: RecognizerLike;
  /** This channel's stream. */
  private stream: StreamLike;
  /** Where partial and final messages go. */
  private readonly emit: (event: ChannelEvent) => void;
  /** Clocks. */
  private readonly clock: ChannelClock;
  /** Speech-onset detector (for the lag measurement). */
  private readonly onsets = new OnsetDetector({ sampleRate: TARGET_SAMPLE_RATE });
  /** Text currently showing ('' = none). */
  private lastText = '';
  /** Audio received (ms) since the text last changed: the pause rule's clock. */
  private msSinceTextChange = 0;
  /**
   * Worker time of the LATEST detected speech onset still waiting for its first partial text.
   * The latest, not the first: background speech that produces no text must not count as the
   * start of the next utterance (that inflated the lag on Day 2 in a room with distant talking).
   */
  private pendingOnsetAt: number | null = null;
  /** Capture time (worker clock) of the end of the chunk in which that onset was detected. */
  private pendingOnsetChunkEndAt: number | null = null;
  /** Capture time (worker clock) of the chunk in which the gate last opened. */
  private gateOpenedAt = 0;
  /** Worker time the current utterance started (onset, or first text), or null. */
  private utteranceStartAt: number | null = null;
  /** Worker time (capture) of the chunk in which the text last changed. */
  private lastChangeAt = 0;
  /**
   * Offset from the sender's audio clock (ms) to the worker's clock. The smallest
   * (arrival − capture) seen is used: that chunk waited least in transit, so the offset is
   * closest to the true clock difference, and queueing delays then show up as lag.
   */
  private clockOffsetMs: number | null = null;
  /** The energy gate, or null to decode every chunk. */
  private readonly gate: SilenceGate | null;
  /** Statistics since the channel was attached. */
  private readonly stats: ChannelStats;
  /** Worker time (capture) where the last loud 10 ms frame of this utterance ended, or null. */
  private lastLoudAt: number | null = null;

  /**
   * @param id         Which channel.
   * @param recognizer The shared recognizer.
   * @param emit       Receives partial and final messages.
   * @param options    Clocks, input rate, energy gate (see ChannelOptions).
   */
  constructor(
    id: ChannelId,
    recognizer: RecognizerLike,
    emit: (event: ChannelEvent) => void,
    options: ChannelOptions = {},
  ) {
    this.id = id;
    this.recognizer = recognizer;
    this.stream = recognizer.createStream();
    this.emit = emit;
    this.clock = options.clock ?? {
      now: () => performance.now(),
      timeOrigin: performance.timeOrigin,
    };
    this.gate = options.gate === undefined ? new SilenceGate() : options.gate;
    const inputSampleRate = options.inputSampleRate ?? TARGET_SAMPLE_RATE;
    this.stats = {
      audioMs: 0,
      decodeMs: 0,
      rtf: 0,
      chunks: 0,
      chunkMsAvg: 0,
      chunkMsMax: 0,
      skippedMs: 0,
      lagsMs: [],
      gateDelaysMs: [],
      endpoints: { model: 0, pause: 0, flush: 0 },
      inputSampleRate,
    };
  }

  /**
   * Takes one chunk: the energy gate decides whether it (plus held-back pre-roll) is decoded.
   * Decoded chunks post new partial text and a final line when the utterance ends; every chunk
   * updates the statistics.
   * Onset time = capture time of the chunk's end (sender's clock mapped to the worker's clock)
   * minus the audio after the onset inside the chunk. Lag = first partial text − onset time.
   *
   * @param samples 16 kHz mono samples (~100 ms).
   * @param endTime Capture time of the chunk's last sample, on the sender's audio clock (s).
   * Called from: stt.worker.ts (port messages and 'accept')
   */
  accept(samples: Float32Array, endTime: number): void {
    const arrivedAt = this.clock.now();
    const offset = arrivedAt - endTime * 1000;
    this.clockOffsetMs =
      this.clockOffsetMs === null ? offset : Math.min(this.clockOffsetMs, offset);
    const chunkAudioMs = (samples.length / TARGET_SAMPLE_RATE) * 1000;
    const onsetIndex = this.onsets.push(samples);
    if (onsetIndex >= 0 && this.lastText === '') {
      this.pendingOnsetAt =
        this.capturedAt(endTime) - ((samples.length - onsetIndex) / TARGET_SAMPLE_RATE) * 1000;
      this.pendingOnsetChunkEndAt = this.capturedAt(endTime);
    }

    const chunk: GateChunk = { samples, endTime };
    const wasOpen = this.gate?.isOpen ?? true;
    const toDecode = this.gate
      ? this.gate.push(chunk, chunkAudioMs, this.lastText !== '')
      : [chunk];
    if (!wasOpen && this.gate?.isOpen) this.gateOpenedAt = this.capturedAt(endTime);
    if (toDecode.length === 0) this.stats.skippedMs += chunkAudioMs;
    for (const next of toDecode) this.decodeChunk(next);

    // Decoding time includes the end-of-utterance work, which is part of the real cost.
    const chunkMs = this.clock.now() - arrivedAt;
    this.stats.chunks += 1;
    this.stats.audioMs += chunkAudioMs;
    this.stats.decodeMs += chunkMs;
    this.stats.rtf = realTimeFactor(this.stats.decodeMs, this.stats.audioMs);
    this.stats.chunkMsAvg = this.stats.decodeMs / this.stats.chunks;
    this.stats.chunkMsMax = Math.max(this.stats.chunkMsMax, chunkMs);
  }

  /**
   * Feeds one chunk to the recognizer, posts changed text, and applies both end rules.
   *
   * @param chunk The chunk (live, or held back by the gate as pre-roll).
   * Called from: accept()
   */
  private decodeChunk(chunk: GateChunk): void {
    const capturedEndAt = this.capturedAt(chunk.endTime);
    const chunkAudioMs = (chunk.samples.length / TARGET_SAMPLE_RATE) * 1000;
    this.stream.acceptWaveform(TARGET_SAMPLE_RATE, chunk.samples);
    const loudEnd = lastLoudSampleEnd(chunk.samples, this.gate?.threshold ?? DEFAULT_SPEECH_RMS);
    if (loudEnd >= 0) {
      this.lastLoudAt =
        capturedEndAt - ((chunk.samples.length - loudEnd) / TARGET_SAMPLE_RATE) * 1000;
    }
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream);
    const text = this.recognizer.getResult(this.stream).text.trim();

    // Audio time, not wall-clock time: a slow chunk must not look like a pause.
    this.msSinceTextChange += chunkAudioMs;
    if (text !== this.lastText) {
      this.msSinceTextChange = 0;
      this.lastChangeAt = capturedEndAt;
      if (this.lastText === '' && text !== '') {
        this.utteranceStartAt = this.pendingOnsetAt ?? capturedEndAt - chunkAudioMs;
        if (this.pendingOnsetAt !== null) {
          this.pushLag(Math.round(this.clock.now() - this.pendingOnsetAt));
          // How much later than the onset's chunk the gate let audio through (0 = no delay).
          const gateDelay = Math.max(0, this.gateOpenedAt - (this.pendingOnsetChunkEndAt ?? 0));
          this.pushRecent(this.stats.gateDelaysMs, Math.round(gateDelay));
          this.pendingOnsetAt = null;
          this.pendingOnsetChunkEndAt = null;
        }
      }
      this.lastText = text;
      this.emit({
        type: 'partial',
        channel: this.id,
        text,
        tStart: text === '' ? null : this.toUnix(this.utteranceStartAt ?? capturedEndAt),
      });
    }
    if (this.recognizer.isEndpoint(this.stream)) this.endUtterance('model');
    else if (this.lastText !== '' && this.msSinceTextChange >= PAUSE_END_MS) {
      this.endUtterance('pause');
    }
  }

  /**
   * Capture time of a chunk end on the worker's clock.
   *
   * @param endTime Sender's audio clock, seconds.
   * @returns Worker time, ms.
   */
  private capturedAt(endTime: number): number {
    return endTime * 1000 + (this.clockOffsetMs ?? 0);
  }

  /**
   * Ends the current utterance and posts its final line (if there is text).
   * For the pause rule and flushes, the stream is first told that input has finished, so the
   * decoder emits the last words it was holding back; then a new stream replaces it (a finished
   * stream cannot take more audio). After the model's own rule, reset() is enough.
   *
   * @param reason Which rule ended the utterance.
   * Called from: accept(); flush()
   */
  private endUtterance(reason: EndpointReason): void {
    let text: string;
    if (reason === 'model') {
      text = this.recognizer.getResult(this.stream).text.trim();
      this.recognizer.reset(this.stream);
    } else {
      this.stream.inputFinished();
      while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream);
      text = this.recognizer.getResult(this.stream).text.trim();
      this.stream.free();
      this.stream = this.recognizer.createStream();
    }
    if (text !== '') {
      this.stats.endpoints[reason] += 1;
      const start = this.utteranceStartAt ?? this.lastChangeAt;
      const end = Math.max(start, this.lastChangeAt);
      // End of speech: the last loud frame, but never after the last word changed (noise after
      // speech must not count) and never before the start.
      const speechEndAt = Math.max(start, Math.min(this.lastLoudAt ?? end, end));
      this.emit({
        type: 'final',
        channel: this.id,
        text,
        reason,
        tStart: this.toUnix(start),
        tEnd: this.toUnix(end),
        speechEnd: this.toUnix(speechEndAt),
      });
    }
    this.clearUtterance();
    this.emit({ type: 'partial', channel: this.id, text: '', tStart: null });
  }

  /**
   * Posts the current text as a final line (reason 'flush'), for detach and stop.
   *
   * Called from: stt.worker.ts ('detach', 'stop')
   */
  flush(): void {
    if (this.lastText !== '') this.endUtterance('flush');
  }

  /**
   * Drops the current utterance without a final line and starts a fresh stream.
   *
   * Called from: stt.worker.ts ('reset')
   */
  reset(): void {
    this.stream.free();
    this.stream = this.recognizer.createStream();
    const hadText = this.lastText !== '';
    this.clearUtterance();
    if (hadText) this.emit({ type: 'partial', channel: this.id, text: '', tStart: null });
  }

  /**
   * Moves the channel to a new recognizer (after the hotwords changed). The current utterance
   * is dropped (its stream belonged to the old recognizer, which is freed next).
   *
   * @param recognizer The new recognizer.
   * Called from: stt.worker.ts ('set-hotwords')
   */
  useRecognizer(recognizer: RecognizerLike): void {
    this.stream.free();
    this.recognizer = recognizer;
    this.stream = recognizer.createStream();
    const hadText = this.lastText !== '';
    this.clearUtterance();
    if (hadText) this.emit({ type: 'partial', channel: this.id, text: '', tStart: null });
  }

  /**
   * A copy of this channel's statistics.
   *
   * @returns The statistics.
   * Called from: stt.worker.ts (the once-a-second stats message)
   */
  snapshot(): ChannelStats {
    return {
      ...this.stats,
      lagsMs: [...this.stats.lagsMs],
      gateDelaysMs: [...this.stats.gateDelaysMs],
      endpoints: { ...this.stats.endpoints },
    };
  }

  /**
   * Releases the stream. The decoder must not be used afterwards.
   *
   * Called from: stt.worker.ts ('detach', 'stop', before the recognizer is freed)
   */
  free(): void {
    this.stream.free();
  }

  /** Forgets the current utterance's state (text, timers, onset). */
  private clearUtterance(): void {
    this.lastLoudAt = null;
    this.lastText = '';
    this.msSinceTextChange = 0;
    this.pendingOnsetAt = null;
    this.pendingOnsetChunkEndAt = null;
    this.utteranceStartAt = null;
  }

  /** Keeps the latest MAX_LAGS lag values. */
  private pushLag(ms: number): void {
    this.pushRecent(this.stats.lagsMs, ms);
  }

  /** Appends to a list, keeping only the latest MAX_LAGS values. */
  private pushRecent(list: number[], value: number): void {
    list.push(value);
    if (list.length > MAX_LAGS) list.shift();
  }

  /** Worker time → Unix ms. */
  private toUnix(workerMs: number): number {
    return Math.round(this.clock.timeOrigin + workerMs);
  }
}

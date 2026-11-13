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
import { chunkRms, lastLoudSampleEnd, SilenceGate, type GateChunk } from './gate';
import { isNoiseLine } from './noiseLine';
import { looksUnfinished } from '../transcript/complete';
import { isQuestionLike } from '../transcript/question';
import { ACCURATE_MAX_SECONDS } from '@kite/shared';
import { OnsetDetector, realTimeFactor } from './metrics';
import {
  LOW_TOKEN_LOG_PROB,
  type ChannelId,
  type ChannelStats,
  type EndpointReason,
  type FromWorker,
  type LineConfidence,
} from './protocol';

/** Pause rule: audio (ms) with no new words, while text is showing, that ends an utterance. */
export const PAUSE_END_MS = 1_200;

/** v1.4 (ADR-0065): seconds of recent audio a final line carries for the end-of-turn model. */
export const RECENT_AUDIO_SECONDS = 8;

/** v1.4 (ADR-0065): silence after speech before the end-of-turn model is asked, ms (Pipecat uses about 200). */
export const PAUSE_JUDGE_MS = 300;

/** v1.4: how far past the end of speech that audio goes, ms (the model is asked after a short pause). */
export const RECENT_AFTER_SPEECH_MS = 200;

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
  /**
   * The stream's current text, and (v1.4) the log probability of each word piece in it when the
   * runtime gives them (sherpa-onnx's JSON result field ys_probs).
   */
  getResult(stream: StreamLike): { text: string; ys_probs?: number[] };
}

/** Messages a channel produces (a subset of the worker's FromWorker). */
export type ChannelEvent = Extract<
  FromWorker,
  { type: 'partial' } | { type: 'final' } | { type: 'pause' } | { type: 'resume' }
>;

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
  /** v1.0.1 (ADR-0034): attach each final line's audio (for the accurate engine). */
  keepAudio?: boolean;
  /**
   * v1.4 (ADR-0065): attach the last RECENT_AUDIO_SECONDS of the channel (heard or not), up to just after
   * the end of speech, to each final line, for the end-of-turn model. Only for "them".
   */
  keepRecent?: boolean;
}

/**
 * Sums up how sure the model was of a line (v1.4, ADR-0062).
 *
 * @param logProbs The log probability of each word piece (sherpa-onnx ys_probs), if given.
 * @returns The line's confidence, or undefined when there are no numbers to go by.
 * Called from: ChannelDecoder.endUtterance(); tests
 */
export function lineConfidence(
  logProbs: readonly number[] | undefined,
): LineConfidence | undefined {
  const values = (logProbs ?? []).filter((value) => Number.isFinite(value));
  if (values.length === 0) return undefined;
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    tokens: values.length,
    meanLogProb: sum / values.length,
    lowShare: values.filter((value) => value < LOW_TOKEN_LOG_PROB).length / values.length,
  };
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
  /** v1.0.1: whether final lines carry their audio. */
  private readonly keepAudio: boolean;
  /** v1.4: whether final lines carry the recent audio. */
  private readonly keepRecent: boolean;
  /** v1.4: the channel's recent chunks, every one (decoded or held back), with their capture end. */
  private recent: { samples: Float32Array; endAt: number }[] = [];
  /** The audio decoded since the last final line (only with keepAudio). */
  private utteranceAudio: Float32Array[] = [];
  /** Samples in utteranceAudio. */
  private utteranceSamples = 0;
  /** The loudest chunk (RMS) decoded in this utterance, for the lone-word noise rule. */
  private utterancePeakRms = 0;
  /** Worker time where this channel's previous final line ended, or null before the first. */
  private lastFinalEndAt: number | null = null;
  /** v1.4: audio (ms) since the last loud frame (audio time, like the pause rule). */
  private quietMs = 0;
  /** v1.4: whether this pause was already posted (one message per pause). */
  private pausePosted = false;
  /** ADR-0076: true once the call's capture clock was given (pinClock): the offset no longer changes. */
  private clockPinned = false;

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
    this.keepAudio = options.keepAudio === true;
    this.keepRecent = options.keepRecent === true;
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
    // ADR-0076: a pinned clock (the call's capture clock) is never replaced by this channel's estimate.
    if (!this.clockPinned) {
      this.clockOffsetMs =
        this.clockOffsetMs === null ? offset : Math.min(this.clockOffsetMs, offset);
    }
    const chunkAudioMs = (samples.length / TARGET_SAMPLE_RATE) * 1000;
    const onsetIndex = this.onsets.push(samples);
    if (onsetIndex >= 0 && this.lastText === '') {
      this.pendingOnsetAt =
        this.capturedAt(endTime) - ((samples.length - onsetIndex) / TARGET_SAMPLE_RATE) * 1000;
      this.pendingOnsetChunkEndAt = this.capturedAt(endTime);
    }

    if (this.keepRecent) this.rememberRecent(samples, this.capturedAt(endTime));
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
    this.utterancePeakRms = Math.max(this.utterancePeakRms, chunkRms(chunk.samples));
    // Kept only up to the accurate engine's limit; a longer utterance keeps the live text only.
    if (this.keepAudio && this.utteranceSamples <= ACCURATE_MAX_SECONDS * TARGET_SAMPLE_RATE) {
      this.utteranceAudio.push(chunk.samples);
      this.utteranceSamples += chunk.samples.length;
    }
    const loudEnd = lastLoudSampleEnd(chunk.samples, this.gate?.threshold ?? DEFAULT_SPEECH_RMS);
    if (loudEnd >= 0) {
      this.lastLoudAt =
        capturedEndAt - ((chunk.samples.length - loudEnd) / TARGET_SAMPLE_RATE) * 1000;
      // v1.4: audio time since the last loud frame (for the pause message), and a new pause may come.
      this.quietMs = ((chunk.samples.length - loudEnd) / TARGET_SAMPLE_RATE) * 1000;
      // 1.5.2 (ADR-0070): the voice is back after a posted pause: the speaker went on.
      if (this.pausePosted) this.emit({ type: 'resume', channel: this.id });
      this.pausePosted = false;
    } else {
      this.quietMs += chunkAudioMs;
    }
    // v1.4 (ADR-0065): once the speaker has been quiet for PAUSE_JUDGE_MS while their words show, post
    // the recent audio so the end-of-turn model can judge before the line is even final.
    if (
      this.keepRecent &&
      this.lastText !== '' &&
      // Only words that look cut off are judged (ADR-0065: the model may only shorten that wait), so
      // the model runs a few times a call, not at every pause (measured: at every pause it slowed
      // the speech worker on the test laptop). 1.5.2 (ADR-0070): and words that read as a question, so
      // auto-answer can answer at the pause instead of a second later at the final line (the real call of
      // 11 Nov 2026 had 3 pauses judged in 8 minutes; questions are a few a minute).
      // Then (the same day): every grey line of three words or more, because live words without marks
      // rarely look like a question ("next question have you done anything with fraud detection").
      (looksUnfinished(this.lastText) ||
        isQuestionLike(this.lastText) ||
        this.lastText.split(/\s+/).filter(Boolean).length >= 3) &&
      this.lastLoudAt !== null &&
      !this.pausePosted &&
      this.quietMs >= PAUSE_JUDGE_MS
    ) {
      this.pausePosted = true;
      this.emit({
        type: 'pause',
        channel: this.id,
        speechEnd: this.toUnix(this.lastLoudAt),
        recent: this.recentAudio(this.lastLoudAt + RECENT_AFTER_SPEECH_MS),
      });
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
        // ADR-0076 (one clock): when the words changed, as a capture time.
        ...(text === '' ? {} : { tEnd: this.toUnix(capturedEndAt) }),
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
    let result: { text: string; ys_probs?: number[] };
    if (reason === 'model') {
      result = this.recognizer.getResult(this.stream);
      this.recognizer.reset(this.stream);
    } else {
      this.stream.inputFinished();
      while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream);
      result = this.recognizer.getResult(this.stream);
      this.stream.free();
      this.stream = this.recognizer.createStream();
    }
    const text = result.text.trim();
    const confidence = lineConfidence(result.ys_probs);
    const start = this.utteranceStartAt ?? this.lastChangeAt;
    const end = Math.max(start, this.lastChangeAt);
    // A lone, quiet word is noise the model turned into a word (v1.0.1: "Tree", "Um" at the start
    // of a call, before the gate knows the room). Real short answers and louder speech are kept.
    const noise =
      text !== '' &&
      isNoiseLine({
        text,
        peakRms: this.utterancePeakRms,
        threshold: this.gate?.threshold ?? DEFAULT_SPEECH_RMS,
        msSincePrevious:
          this.lastFinalEndAt === null ? Number.POSITIVE_INFINITY : start - this.lastFinalEndAt,
      });
    if (text !== '' && !noise) {
      this.stats.endpoints[reason] += 1;
      this.lastFinalEndAt = end;
      // End of speech: the last loud frame, but never after the last word changed (noise after
      // speech must not count) and never before the start.
      const speechEndAt = Math.max(start, Math.min(this.lastLoudAt ?? end, end));
      this.emit({
        type: 'final',
        channel: this.id,
        text,
        reason,
        ...(this.utteranceAudioIfKept() ?? {}),
        tStart: this.toUnix(start),
        tEnd: this.toUnix(end),
        speechEnd: this.toUnix(speechEndAt),
        ...(confidence ? { confidence } : {}),
        ...(this.keepRecent && looksUnfinished(text)
          ? { recent: this.recentAudio(speechEndAt + RECENT_AFTER_SPEECH_MS) }
          : {}),
      });
    }
    this.clearUtterance();
    this.emit({ type: 'partial', channel: this.id, text: '', tStart: null });
  }

  /**
   * ADR-0076 (one clock): uses the call's capture clock from now on. The offset is between the sender's
   * audio clock and this worker's performance clock, so it is the same for every channel.
   *
   * @param offsetMs Worker ms minus audio-clock ms.
   * Called from: stt.worker.ts ('clock', and new decoders after it)
   */
  pinClock(offsetMs: number): void {
    this.clockOffsetMs = offsetMs;
    this.clockPinned = true;
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

  /**
   * The current utterance's audio as one array, when this channel keeps audio and the utterance
   * is within the accurate engine's limit.
   *
   * @returns { audio } to spread into the final message, or null.
   * Called from: endUtterance()
   */
  private utteranceAudioIfKept(): { audio: Float32Array } | null {
    if (!this.keepAudio || this.utteranceSamples === 0) return null;
    if (this.utteranceSamples > ACCURATE_MAX_SECONDS * TARGET_SAMPLE_RATE) return null;
    const audio = new Float32Array(this.utteranceSamples);
    let at = 0;
    for (const piece of this.utteranceAudio) {
      audio.set(piece, at);
      at += piece.length;
    }
    return { audio };
  }

  /**
   * Keeps a chunk in the recent audio, dropping what is older than RECENT_AUDIO_SECONDS plus a second.
   *
   * @param samples The chunk.
   * @param endAt   Its capture end (worker clock, ms).
   */
  private rememberRecent(samples: Float32Array, endAt: number): void {
    this.recent.push({ samples, endAt });
    const keepFrom = endAt - (RECENT_AUDIO_SECONDS + 1) * 1000;
    while (this.recent.length > 0 && this.recent[0]!.endAt < keepFrom) this.recent.shift();
  }

  /**
   * The recent audio up to a moment, at most RECENT_AUDIO_SECONDS long.
   *
   * @param untilAt The moment (worker clock, ms).
   * @returns The samples (a new array).
   */
  private recentAudio(untilAt: number): Float32Array {
    const chunks = this.recent.filter((chunk) => chunk.endAt <= untilAt + 100);
    const total = chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0);
    const all = new Float32Array(total);
    let at = 0;
    for (const chunk of chunks) {
      all.set(chunk.samples, at);
      at += chunk.samples.length;
    }
    const max = RECENT_AUDIO_SECONDS * TARGET_SAMPLE_RATE;
    return all.length > max ? all.slice(all.length - max) : all;
  }

  /** Forgets the current utterance's state (text, timers, onset). */
  private clearUtterance(): void {
    this.lastLoudAt = null;
    this.utterancePeakRms = 0;
    this.utteranceAudio = [];
    this.utteranceSamples = 0;
    this.lastText = '';
    this.msSinceTextChange = 0;
    this.pendingOnsetAt = null;
    this.pendingOnsetChunkEndAt = null;
    this.utteranceStartAt = null;
  }

  /**
   * Records one utterance's lag, keeping the latest MAX_LAGS values.
   *
   * @param ms Speech onset → first text, in ms.
   */
  private pushLag(ms: number): void {
    this.pushRecent(this.stats.lagsMs, ms);
  }

  /**
   * Appends to a statistics list, keeping only the latest MAX_LAGS values (bounded memory).
   *
   * @param list  The list (changed in place).
   * @param value The new value.
   */
  private pushRecent(list: number[], value: number): void {
    list.push(value);
    if (list.length > MAX_LAGS) list.shift();
  }

  /**
   * Converts a worker clock time to Unix ms, so the page can compare it with its own clock.
   *
   * @param workerMs Time on the worker's performance.now() clock, in ms.
   * @returns The same moment as Unix ms.
   */
  private toUnix(workerMs: number): number {
    return Math.round(this.clock.timeOrigin + workerMs);
  }
}

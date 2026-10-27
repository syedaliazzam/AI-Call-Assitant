/**
 * File: apps/web/src/core/stt/secondPass.ts
 * Purpose: The pure logic of the second pass (Day 2 Stage 5), kept apart from the worker so it
 *          can be unit tested: the Silero VAD settings, how VAD speech segments become the
 *          pieces that are decoded (one span for the transducer; pieces of 8 s or less for
 *          Moonshine, cut at pauses), the job queue that drops work which waited too long, and
 *          the recognizer config for each model family.
 * Used by: src/core/stt/secondPass.worker.ts
 * Depends on: src/core/stt/models.ts (model types), src/core/stt/protocol.ts (SecondPassJob)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2, §7.1 (core/stt); ADR-0020
 */
import type { SecondPassModel } from './models';
import type { SecondPassJob } from './protocol';

/** Sample rate of all second-pass audio, in Hz. */
export const SECOND_PASS_SAMPLE_RATE = 16_000;

/**
 * Silero VAD settings for trimming an utterance before it is decoded again.
 * - threshold 0.5: sherpa-onnx's default;
 * - minSilenceDuration 0.25 s: a shorter pause than the default 0.5 s splits segments, so
 *   Moonshine pieces can be cut at the natural pauses between phrases;
 * - minSpeechDuration 0.1 s: keeps short replies ("yes"), which the default 0.25 s can drop;
 * - maxSpeechDuration 30 s: an utterance is never longer (channel.ts keeps at most 30 s);
 * - windowSize 512 samples (32 ms): what Silero expects at 16 kHz.
 */
export const VAD_SETTINGS = {
  threshold: 0.5,
  minSilenceDuration: 0.25,
  minSpeechDuration: 0.1,
  maxSpeechDuration: 30,
  windowSize: 512,
} as const;

/** Audio kept around the speech the VAD found, in ms (so the first and last sounds are not cut). */
export const SPEECH_PAD_MS = 200;

/**
 * Longest piece given to Moonshine v2, in ms. This build throws on input longer than about 9 s
 * (checked in Node on Day 2: 9 s works, 9.5 s fails), so 8 s leaves a margin.
 */
export const MOONSHINE_MAX_PIECE_MS = 8_000;

/** A job that waited longer than this in the queue is dropped (its first-pass text stays), ms. */
export const MAX_QUEUE_WAIT_MS = 6_000;

/** Most jobs waiting at once; older ones are dropped first. */
export const MAX_QUEUED_JOBS = 8;

/** One speech segment from the VAD, in samples. */
export interface SpeechSegment {
  /** First sample. */
  start: number;
  /** Number of samples. */
  length: number;
}

/** A piece of the job audio to decode: samples [from, to). */
export interface AudioPiece {
  /** First sample. */
  from: number;
  /** One past the last sample. */
  to: number;
}

/**
 * Turns the VAD's speech segments into the pieces to decode.
 * Without a limit: one span from the first speech to the last (pauses inside are kept, so a
 * word the VAD missed is still decoded). With a limit: neighbouring segments are grouped while
 * the group fits, so pieces are cut at pauses; a single segment longer than the limit is cut
 * into equal parts. Each piece gets SPEECH_PAD_MS on both sides, without overlapping the next.
 *
 * @param segments  VAD segments in time order (sample indices into the job audio).
 * @param total     Number of samples in the job audio.
 * @param maxPiece  Longest piece in samples (padding included), or null for no limit.
 * @param pad       Padding in samples (default SPEECH_PAD_MS).
 * @returns The pieces in order ([] when there is no speech).
 * Called from: secondPass.worker.ts; tests
 */
export function speechPieces(
  segments: readonly SpeechSegment[],
  total: number,
  maxPiece: number | null,
  pad: number = Math.round((SPEECH_PAD_MS / 1000) * SECOND_PASS_SAMPLE_RATE),
): AudioPiece[] {
  const clamped = segments
    .map((segment) => ({
      from: Math.max(0, Math.min(total, segment.start)),
      to: Math.max(0, Math.min(total, segment.start + segment.length)),
    }))
    .filter((span) => span.to > span.from);
  if (clamped.length === 0) return [];
  if (maxPiece === null) {
    return [
      { from: Math.max(0, clamped[0]!.from - pad), to: Math.min(total, clamped.at(-1)!.to + pad) },
    ];
  }

  // Group at pauses: the speech in a group must fit in the limit minus both paddings.
  const room = Math.max(1, maxPiece - 2 * pad);
  const groups: AudioPiece[] = [];
  for (const span of clamped) {
    const last = groups.at(-1);
    if (last && span.to - last.from <= room) last.to = span.to;
    else groups.push({ ...span });
  }
  // A group that is still too long (one long segment) is cut into equal parts.
  const parts: AudioPiece[] = [];
  for (const group of groups) {
    const count = Math.ceil((group.to - group.from) / room);
    const size = Math.ceil((group.to - group.from) / count);
    for (let from = group.from; from < group.to; from += size) {
      parts.push({ from, to: Math.min(group.to, from + size) });
    }
  }
  // Padding, never reaching into the neighbouring pieces.
  return parts.map((part, i) => ({
    from: Math.max(i === 0 ? 0 : parts[i - 1]!.to, part.from - pad),
    to: Math.min(i === parts.length - 1 ? total : parts[i + 1]!.from, part.to + pad),
  }));
}

/**
 * Joins the texts of the pieces of one utterance.
 *
 * @param texts Text per piece (may be empty).
 * @returns One line: single spaces, trimmed.
 * Called from: secondPass.worker.ts; tests
 */
export function joinPieces(texts: readonly string[]): string {
  return texts
    .map((text) => text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** First-in, first-out queue of second-pass jobs that drops jobs which waited too long. */
export class JobQueue {
  /** Waiting jobs, oldest first. */
  private jobs: SecondPassJob[] = [];

  /**
   * @param maxWaitMs Longest wait before a job is dropped.
   * @param maxJobs   Most jobs waiting at once.
   */
  constructor(
    private readonly maxWaitMs: number = MAX_QUEUE_WAIT_MS,
    private readonly maxJobs: number = MAX_QUEUED_JOBS,
  ) {}

  /**
   * Adds a job.
   *
   * @param job The job.
   * @returns Jobs dropped to make room (oldest first), usually none.
   */
  push(job: SecondPassJob): SecondPassJob[] {
    this.jobs.push(job);
    const dropped: SecondPassJob[] = [];
    while (this.jobs.length > this.maxJobs) dropped.push(this.jobs.shift()!);
    return dropped;
  }

  /**
   * Takes the next job that has not waited too long.
   *
   * @param now Unix ms.
   * @returns The job (or null when none is left) and the jobs dropped for waiting too long.
   */
  take(now: number): { job: SecondPassJob | null; dropped: SecondPassJob[] } {
    const dropped: SecondPassJob[] = [];
    while (this.jobs.length > 0 && now - this.jobs[0]!.sentAt > this.maxWaitMs) {
      dropped.push(this.jobs.shift()!);
    }
    return { job: this.jobs.shift() ?? null, dropped };
  }

  /**
   * Removes every job (on stop).
   *
   * @returns How many were removed.
   */
  clear(): number {
    const count = this.jobs.length;
    this.jobs = [];
    return count;
  }

  /** Number of waiting jobs. */
  get size(): number {
    return this.jobs.length;
  }
}

/** Paths of the model files inside the WebAssembly file system. */
export type ModelPaths = Record<string, string>;

/**
 * The sherpa-onnx OfflineRecognizer config for a second-pass model (sherpa-onnx-asr.js v1.13.2).
 * - Moonshine v2: encoder + mergedDecoder, greedy search (it has no hotwords).
 * - Transducer: modelType 'transducer', modified_beam_search with 4 paths (hotwords need beam
 *   search) and the hotwords FILE: the offline config has no hotwords buffer, so the worker
 *   writes the formatted hotwords into the WebAssembly file system first. bpe.vocab encodes them.
 * One sherpa-onnx thread: two threads were at most about 10% faster in Node (Day 2).
 *
 * @param model        The model.
 * @param paths        File paths by the model's file keys (plus 'bpeVocab' for a transducer).
 * @param hotwordsFile Path of the hotwords file, or '' for none.
 * @returns The config object for `new OfflineRecognizer(config, Module)`.
 * Called from: secondPass.worker.ts; tests
 */
export function recognizerConfig(
  model: SecondPassModel,
  paths: ModelPaths,
  hotwordsFile: string,
): Record<string, unknown> {
  const common = { tokens: paths.tokens, numThreads: 1, provider: 'cpu', debug: 0 };
  if (model.kind === 'moonshine-v2') {
    return {
      modelConfig: {
        ...common,
        moonshine: { encoder: paths.encoder, mergedDecoder: paths.mergedDecoder },
      },
      decodingMethod: 'greedy_search',
    };
  }
  return {
    modelConfig: {
      ...common,
      transducer: { encoder: paths.encoder, decoder: paths.decoder, joiner: paths.joiner },
      modelType: 'transducer',
      modelingUnit: 'bpe',
      bpeVocab: paths.bpeVocab,
    },
    decodingMethod: 'modified_beam_search',
    maxActivePaths: 4,
    hotwordsFile,
    // Default boost for lines without their own score (formatHotwords always writes one).
    hotwordsScore: 1.5,
  };
}

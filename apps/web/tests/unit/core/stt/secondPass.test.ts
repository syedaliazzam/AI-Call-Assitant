/**
 * Tests for apps/web/src/core/stt/secondPass.ts (the second pass's pure logic):
 * speechPieces() gives one padded span from the first to the last speech without a limit;
 * with a limit (Moonshine, 8 s) it groups segments at pauses, cuts a long segment into equal
 * parts, never exceeds the limit and never overlaps pieces; no speech gives no pieces;
 * joinPieces() joins and trims; JobQueue keeps order, drops jobs that waited more than 6 s and
 * the oldest beyond 8; recognizerConfig() builds the Moonshine v2 (greedy, merged decoder) and
 * transducer (modified beam search, hotwords file, bpe.vocab) configs.
 */
import { describe, expect, it } from 'vitest';
import { MOONSHINE_V2_TINY_EN, ZIPFORMER_GIGASPEECH_EN } from '@/core/stt/models';
import type { SecondPassJob } from '@/core/stt/protocol';
import {
  JobQueue,
  joinPieces,
  MAX_QUEUE_WAIT_MS,
  MAX_QUEUED_JOBS,
  recognizerConfig,
  speechPieces,
} from '@/core/stt/secondPass';

/** Samples per second. */
const S = 16_000;

describe('speechPieces', () => {
  it('without a limit, is one padded span from the first to the last speech', () => {
    const pieces = speechPieces(
      [
        { start: S, length: S },
        { start: 4 * S, length: S },
      ],
      10 * S,
      null,
      800,
    );
    expect(pieces).toEqual([{ from: S - 800, to: 5 * S + 800 }]);
  });

  it('clamps the padding to the audio', () => {
    expect(speechPieces([{ start: 100, length: 1_000 }], 1_200, null, 800)).toEqual([
      { from: 0, to: 1_200 },
    ]);
  });

  it('gives no pieces when there is no speech', () => {
    expect(speechPieces([], 10 * S, null)).toEqual([]);
    expect(speechPieces([{ start: 5, length: 0 }], 10 * S, 8 * S)).toEqual([]);
  });

  it('with a limit, cuts at pauses, never exceeds it, and does not overlap', () => {
    // Three 3 s phrases with 0.5 s pauses: 0–3, 3.5–6.5, 7–10 s; limit 8 s.
    const segments = [0, 3.5, 7].map((t) => ({ start: t * S, length: 3 * S }));
    const pieces = speechPieces(segments, 11 * S, 8 * S, 0.2 * S);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.to).toBeLessThanOrEqual(pieces[1]!.from);
    for (const piece of pieces) expect(piece.to - piece.from).toBeLessThanOrEqual(8 * S);
    // The cut is in the pause between the second and the third phrase.
    expect(pieces[0]!.to).toBeGreaterThan(6.5 * S);
    expect(pieces[1]!.from).toBeLessThan(7 * S);
  });

  it('cuts one long segment (20 s, no pause) into equal parts within the limit', () => {
    const pieces = speechPieces([{ start: 0, length: 20 * S }], 20 * S, 8 * S, 0.2 * S);
    expect(pieces.length).toBe(3);
    for (const piece of pieces) expect(piece.to - piece.from).toBeLessThanOrEqual(8 * S);
    expect(pieces[0]!.from).toBe(0);
    expect(pieces.at(-1)!.to).toBe(20 * S);
  });
});

describe('joinPieces', () => {
  it('joins with single spaces and drops empty pieces', () => {
    expect(joinPieces([' After early nightfall, ', '', 'the lamps  lit.'])).toBe(
      'After early nightfall, the lamps lit.',
    );
  });
});

describe('JobQueue', () => {
  /** A job sent at `sentAt`. */
  const job = (id: string, sentAt: number): SecondPassJob => ({
    segmentId: id,
    channel: 'you',
    samples: new Float32Array(1),
    speechEnd: sentAt,
    sentAt,
  });

  it('hands out jobs in order', () => {
    const queue = new JobQueue();
    queue.push(job('a', 0));
    queue.push(job('b', 0));
    expect(queue.take(10).job?.segmentId).toBe('a');
    expect(queue.take(10).job?.segmentId).toBe('b');
    expect(queue.take(10).job).toBeNull();
  });

  it('drops jobs that waited too long, and the oldest beyond the limit', () => {
    const queue = new JobQueue();
    queue.push(job('old', 0));
    queue.push(job('new', 5_000));
    const { job: next, dropped } = queue.take(MAX_QUEUE_WAIT_MS + 1);
    expect(dropped.map((d) => d.segmentId)).toEqual(['old']);
    expect(next?.segmentId).toBe('new');

    const full = new JobQueue();
    const overflow = Array.from({ length: MAX_QUEUED_JOBS + 1 }, (_, i) =>
      full.push(job(`j${i}`, 0)),
    ).flat();
    expect(overflow.map((d) => d.segmentId)).toEqual(['j0']);
    expect(full.size).toBe(MAX_QUEUED_JOBS);
    expect(full.clear()).toBe(MAX_QUEUED_JOBS);
  });
});

describe('recognizerConfig', () => {
  it('uses the merged decoder and greedy search for Moonshine v2', () => {
    const config = recognizerConfig(
      MOONSHINE_V2_TINY_EN,
      { encoder: '/m/e.ort', mergedDecoder: '/m/d.ort', tokens: '/m/t.txt' },
      '',
    );
    expect(config).toMatchObject({
      decodingMethod: 'greedy_search',
      modelConfig: {
        moonshine: { encoder: '/m/e.ort', mergedDecoder: '/m/d.ort' },
        tokens: '/m/t.txt',
        numThreads: 1,
      },
    });
  });

  it('uses beam search, the hotwords file and bpe.vocab for the transducer', () => {
    const config = recognizerConfig(
      ZIPFORMER_GIGASPEECH_EN,
      {
        encoder: '/m/e',
        decoder: '/m/d',
        joiner: '/m/j',
        tokens: '/m/t',
        bpeVocab: '/m/bpe.vocab',
      },
      '/m/hotwords-1.txt',
    );
    expect(config).toMatchObject({
      decodingMethod: 'modified_beam_search',
      maxActivePaths: 4,
      hotwordsFile: '/m/hotwords-1.txt',
      modelConfig: {
        transducer: { encoder: '/m/e', decoder: '/m/d', joiner: '/m/j' },
        modelType: 'transducer',
        modelingUnit: 'bpe',
        bpeVocab: '/m/bpe.vocab',
      },
    });
  });
});

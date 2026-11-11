/**
 * Tests apps/web/src/core/transcript/refineQueue.ts (1.5.1, ADR-0069): Accurate rewrites one line at a
 * time with at most one waiting (a newer line replaces it), never a line older than 3 s when its rewrite
 * would start, and nothing while the live engine is behind; every skipped line is reported.
 * 1.5.2 (ADR-0070): offerIdle() starts a "You" line only when nothing runs or waits and the live engine
 * keeps up, and never queues it.
 */
import { describe, expect, it } from 'vitest';
import {
  createRefineQueue,
  MAX_REFINE_AGE_MS,
  type RefineJob,
} from '@/core/transcript/refineQueue';

/**
 * A queue whose rewrites the test finishes by hand.
 *
 * @param canRun Whether a rewrite may start (default: always).
 * @returns The queue, what started and was skipped, and controls for time and finishing.
 */
function setup(canRun = () => true) {
  let now = 0;
  const started: string[] = [];
  const skipped: [string, string][] = [];
  const finish: (() => void)[] = [];
  const queue = createRefineQueue<RefineJob>({
    run: (job) =>
      new Promise<void>((resolve) => {
        started.push(job.lineId);
        finish.push(resolve);
      }),
    onSkip: (job, why) => skipped.push([job.lineId, why]),
    canRun,
    now: () => now,
  });
  return {
    queue,
    started,
    skipped,
    finish: async () => {
      finish.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    at: (ms: number) => {
      now = ms;
    },
  };
}

describe('createRefineQueue', () => {
  it('runs one rewrite at a time and keeps only the newest waiting line', async () => {
    const t = setup();
    t.queue.push({ lineId: 'u1', finalAt: 0 });
    t.queue.push({ lineId: 'u2', finalAt: 0 });
    t.queue.push({ lineId: 'u3', finalAt: 0 });
    expect(t.started).toEqual(['u1']);
    expect(t.skipped).toEqual([['u2', 'replaced']]);
    await t.finish();
    expect(t.started).toEqual(['u1', 'u3']);
    expect(t.queue.busy()).toBe(true);
    await t.finish();
    expect(t.queue.busy()).toBe(false);
  });

  it('skips a line whose rewrite would start more than 3 s after it became final', async () => {
    const t = setup();
    t.queue.push({ lineId: 'u1', finalAt: 0 });
    t.queue.push({ lineId: 'u2', finalAt: 0 });
    t.at(MAX_REFINE_AGE_MS + 1);
    await t.finish();
    expect(t.skipped).toEqual([['u2', 'stale']]);
    expect(t.started).toEqual(['u1']);
  });

  it('starts nothing while the live engine is behind', () => {
    let behind = true;
    const t = setup(() => !behind);
    t.queue.push({ lineId: 'u1', finalAt: 0 });
    expect(t.skipped).toEqual([['u1', 'busy']]);
    behind = false;
    t.queue.push({ lineId: 'u2', finalAt: 0 });
    expect(t.started).toEqual(['u2']);
  });

  it('skips the waiting line at End', () => {
    const t = setup();
    t.queue.push({ lineId: 'u1', finalAt: 0 });
    t.queue.push({ lineId: 'u2', finalAt: 0 });
    t.queue.clear();
    expect(t.skipped).toEqual([['u2', 'replaced']]);
  });
});

describe('offerIdle (1.5.2, ADR-0070)', () => {
  it('starts only when idle, and never queues', async () => {
    let release: () => void = () => undefined;
    const ran: string[] = [];
    const skipped: string[] = [];
    let canRun = true;
    const queue = createRefineQueue<RefineJob>({
      run: (job) => {
        ran.push(job.lineId);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      onSkip: (job) => skipped.push(job.lineId),
      canRun: () => canRun,
      now: () => 1_000,
    });
    expect(queue.offerIdle({ lineId: 'you1', finalAt: 1_000 })).toBe(true);
    expect(queue.offerIdle({ lineId: 'you2', finalAt: 1_000 })).toBe(false);
    queue.push({ lineId: 'them1', finalAt: 1_000 });
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(ran).toEqual(['you1', 'them1']);
    expect(skipped).toEqual([]);
    release();
    await Promise.resolve();
    await Promise.resolve();
    canRun = false;
    expect(queue.offerIdle({ lineId: 'you3', finalAt: 1_000 })).toBe(false);
    expect(ran).toEqual(['you1', 'them1']);
  });
});

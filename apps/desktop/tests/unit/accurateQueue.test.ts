/**
 * Tests apps/desktop/src/accurate/host.ts createDecodeQueue() (desktop 1.5.1, ADR-0069): decodes run one at
 * a time; at most one line waits, and a newer line makes the waiting one answer 'busy' at once (its live
 * words stay); a decode that throws answers 'engine'.
 */
import { describe, expect, it } from 'vitest';
import type { AccurateResult } from '@kite/shared';
import { createDecodeQueue } from '../../src/accurate/host';

/**
 * A decode the test finishes by hand.
 *
 * @param log Where the decode's name is written when it starts.
 * @param name Its name.
 * @returns The decode function and its finish function.
 */
function manual(log: string[], name: string) {
  let finish: (result: AccurateResult) => void = () => undefined;
  const decode = () =>
    new Promise<AccurateResult>((resolve) => {
      log.push(name);
      finish = resolve;
    });
  return { decode, finish: (result: AccurateResult) => finish(result) };
}

describe('createDecodeQueue', () => {
  it('runs one at a time, lets only the newest line wait, and answers the replaced one busy', async () => {
    const enqueue = createDecodeQueue();
    const started: string[] = [];
    const a = manual(started, 'a');
    const b = manual(started, 'b');
    const c = manual(started, 'c');
    const first = enqueue(a.decode);
    const second = enqueue(b.decode);
    const third = enqueue(c.decode);
    expect(await second).toEqual({ ok: false, code: 'busy' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['a']);
    a.finish({ ok: true, text: 'x', ms: 1 });
    expect(await first).toEqual({ ok: true, text: 'x', ms: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['a', 'c']);
    c.finish({ ok: true, text: 'y', ms: 2 });
    expect(await third).toEqual({ ok: true, text: 'y', ms: 2 });
  });

  it('answers engine when a decode throws, and keeps going', async () => {
    const enqueue = createDecodeQueue();
    expect(await enqueue(() => Promise.reject(new Error('crash')))).toEqual({
      ok: false,
      code: 'engine',
    });
    expect(await enqueue(async () => ({ ok: true, text: 'z', ms: 3 }))).toEqual({
      ok: true,
      text: 'z',
      ms: 3,
    });
  });
});

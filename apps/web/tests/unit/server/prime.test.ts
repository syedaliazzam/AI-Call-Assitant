/**
 * Tests apps/web/src/server/prime.ts (Batch C, P1-2): the source's first read starts at once (before anyone
 * reads), the primed source then gives the same items and result; a discarded source is ended and its
 * rejection is never unhandled; a reader that stops early ends the original too.
 */
import { describe, expect, it, vi } from 'vitest';
import { prime } from '@/server/prime';

describe('prime', () => {
  it('starts the first read at once and replays everything', async () => {
    const started = vi.fn();
    async function* source(): AsyncGenerator<string, number, undefined> {
      started();
      yield 'a';
      yield 'b';
      return 7;
    }
    const primed = prime(source());
    expect(started).toHaveBeenCalledTimes(1);
    const items: string[] = [];
    let result: IteratorResult<string, number>;
    while (!(result = await primed.source.next()).done) items.push(result.value);
    expect(items).toEqual(['a', 'b']);
    expect(result.value).toBe(7);
  });

  it('discards a source stopped before anyone reads it, with no unhandled rejection', async () => {
    const cleaned = vi.fn();
    const controller = new AbortController();
    async function* source(): AsyncGenerator<string, number, undefined> {
      try {
        await new Promise((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
        yield 'never';
        return 0;
      } finally {
        cleaned();
      }
    }
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const primed = prime(source());
    controller.abort();
    primed.discard();
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(cleaned).toHaveBeenCalled();
  });

  it('ends the original when the reader stops early', async () => {
    const cleaned = vi.fn();
    async function* source(): AsyncGenerator<string, number, undefined> {
      try {
        yield 'a';
        yield 'b';
        return 1;
      } finally {
        cleaned();
      }
    }
    const primed = prime(source());
    expect((await primed.source.next()).value).toBe('a');
    await primed.source.return(0);
    expect(cleaned).toHaveBeenCalled();
  });
});

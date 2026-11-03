/**
 * Tests apps/web/src/server/answer-meta.ts and splitMetaLine() in @kite/shared: removing the hidden
 * first line from a streaming reply wherever the network pieces happen to break, passing a reply
 * without one through whole, and stopping the reply when the reader stops.
 */
import { splitMetaLine } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import { withAnswerMeta, type ReplyItem } from '@/server/answer-meta';

vi.mock('server-only', () => ({}));

/**
 * A reply made of the given pieces.
 *
 * @param pieces Its text pieces.
 * @returns A generator of them, finishing with 'result'.
 */
async function* reply(pieces: string[]): AsyncGenerator<string, string, undefined> {
  for (const piece of pieces) yield piece;
  return 'result';
}

/**
 * Reads a wrapped reply to its end.
 *
 * @param pieces The reply's pieces.
 * @returns Its items and its result.
 */
async function read(pieces: string[]): Promise<{ items: ReplyItem[]; result: string }> {
  const source = withAnswerMeta(reply(pieces));
  const items: ReplyItem[] = [];
  let next = await source.next();
  for (; !next.done; next = await source.next()) items.push(next.value);
  return { items, result: next.value };
}

const META = { meta: { type: 'coding', target: 'call', source: 'docs' } };

describe('withAnswerMeta', () => {
  it('moves the line out of the text', async () => {
    const { items, result } = await read(['[[coding|call|docs]]\nHello', ' there']);
    expect(items).toEqual([META, 'Hello', ' there']);
    expect(result).toBe('result');
  });

  it('copes with the line split across pieces', async () => {
    const { items } = await read(['[', '[coding|ca', 'll|docs]', ']', '\n', '\n', 'Hello']);
    expect(items).toEqual([META, 'Hello']);
  });

  it('passes a reply with no line through whole', async () => {
    const { items } = await read(['Hello', ' there']);
    expect(items).toEqual(['Hello', ' there']);
  });

  it('passes through text that only looks like the line', async () => {
    const { items } = await read(['[[not a line, just text\n', 'more']);
    expect(items).toEqual(['[[not a line, just text\n', 'more']);
  });

  it('releases an unclosed line once it is too long to be one, without waiting for the end', async () => {
    // Fail safe (v1.0.0 review): a model that starts "[[" and never closes it must not hold the
    // answer back. Read piece by piece: text arrives before the reply ends.
    const long = `[[coding|call|${'x'.repeat(80)}`;
    const source = withAnswerMeta(reply([long, ' and the rest']));
    const first = await source.next();
    expect(first).toEqual({ done: false, value: long });
    await source.return('result');
  });

  it('keeps a reply that ended while it could still have been the line', async () => {
    const { items } = await read(['[[cod']);
    expect(items).toEqual(['[[cod']);
  });

  it('gives nothing but the meta for a reply with no words', async () => {
    const { items } = await read(['[[coding|call|docs]]\n']);
    expect(items).toEqual([META]);
  });

  it('stops the reply when the reader stops', async () => {
    const stopped = vi.fn();
    async function* endless(): AsyncGenerator<string, string, undefined> {
      try {
        yield 'Hello';
        yield 'more';
        return 'result';
      } finally {
        stopped();
      }
    }
    const source = withAnswerMeta(endless());
    await source.next();
    await source.return('stopped');
    expect(stopped).toHaveBeenCalled();
  });
});

describe('splitMetaLine', () => {
  it('falls back on each odd value by itself', () => {
    expect(splitMetaLine('[[weird|odd|strange]] Hi')).toEqual({
      state: 'found',
      meta: { type: 'unclear', target: 'call', source: 'general' },
      rest: 'Hi',
    });
  });

  it('waits while the line may still be arriving', () => {
    expect(splitMetaLine('  ').state).toBe('waiting');
    expect(splitMetaLine('[').state).toBe('waiting');
    expect(splitMetaLine('[[coding|ca').state).toBe('waiting');
  });

  it('gives up on anything else', () => {
    expect(splitMetaLine('Hello').state).toBe('none');
    expect(splitMetaLine(`[[${'x'.repeat(80)}`).state).toBe('none');
  });
});

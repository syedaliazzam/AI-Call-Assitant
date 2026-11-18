/**
 * Tests apps/web/src/server/answer-meta.ts and splitMetaLine() in @kite/shared: removing the hidden
 * first line from a streaming reply wherever the network pieces happen to break, hiding it whatever
 * it says (an unknown type reads "Other"), passing a reply without one through whole, and stopping
 * the reply when the reader stops.
 */
import {
  ANSWER_TYPE_LABELS,
  ANSWER_TYPES,
  PICKABLE_ANSWER_TYPES,
  splitMetaLine,
} from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import { MAX_LEADING_CHARS, withAnswerMeta, type ReplyItem } from '@/server/answer-meta';

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
    // ADR-0103: its first line is held until it ends (it could be stray text before the hidden line).
    const { items } = await read(['Hello', ' there']);
    expect(items.join('')).toBe('Hello there');
  });

  it('passes through text that only looks like the line', async () => {
    const { items } = await read(['[[not a line, just text\n', 'more']);
    expect(items.join('')).toBe('[[not a line, just text\nmore');
  });

  it('releases an unclosed line once it is too long to be one, without waiting for the end', async () => {
    // Fail safe (v1.0.0 review): a model that starts "[[" and never closes it must not hold the
    // answer back. Read piece by piece: text arrives before the reply ends.
    // ADR-0103: the first line is held up to MAX_LEADING_CHARS, then released.
    const long = `[[coding|call|${'x'.repeat(MAX_LEADING_CHARS)}`;
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

  it('hides a line with an unknown type and an extra value, and keeps what it says', async () => {
    // The line a real reply wrote (k-maths, v1.2.0 evaluation), which used to reach the reader.
    const { items } = await read(['[[calculation|for|kite|general]]\nAbout 40 a day.']);
    expect(items).toEqual([
      { meta: { type: 'other', target: 'kite', source: 'general' } },
      'About 40 a day.',
    ]);
  });

  it('hides such a line wherever the network pieces break', async () => {
    const { items } = await read(['[', '[calcul', 'ation|for|ki', 'te|general]', ']', '\n', 'Hi']);
    expect(items).toEqual([{ meta: { type: 'other', target: 'kite', source: 'general' } }, 'Hi']);
  });

  it('keeps the question when a reply opens with the hidden question line', async () => {
    const { items } = await read(['[[question|What is the rate?]]\nAbout 40.']);
    // ADR-0103: the leading question line is taken out first, then the answer follows.
    expect(items).toEqual([{ question: 'What is the rate?' }, 'About 40.']);
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
      meta: { type: 'other', target: 'call', source: 'general' },
      rest: 'Hi',
    });
  });

  it.each([
    ['[[calculation]]', { type: 'other', target: 'call', source: 'general' }],
    ['[[Coding|Call|Docs]]', { type: 'coding', target: 'call', source: 'docs' }],
    ['[[code review|kite]]', { type: 'other', target: 'kite', source: 'general' }],
    ['[[coding|call|docs|extra|more]]', { type: 'coding', target: 'call', source: 'docs' }],
  ])('hides %s, whatever its shape', (line, meta) => {
    expect(splitMetaLine(`${line}\nHi`)).toEqual({ state: 'found', meta, rest: 'Hi' });
  });

  it.each(['[[1, 2, 3]]', '[[1, 2], [3, 4]]', '[[a, b]]', '[["a"]]'])(
    'leaves %s in the answer, because it is not a hidden line',
    (text) => {
      expect(splitMetaLine(`${text}\nis the list`).state).toBe('none');
    },
  );

  it('has a label for "other", which the answer menu does not offer', () => {
    expect(ANSWER_TYPES).toContain('other');
    expect(PICKABLE_ANSWER_TYPES).not.toContain('other');
    expect(ANSWER_TYPE_LABELS.other).toBe('Other');
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

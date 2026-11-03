/**
 * Tests the hidden LAST line (v1.0.2, ADR-0037): createQuestionLineFilter() in @kite/shared and its
 * use in withAnswerMeta() (apps/web/src/server/answer-meta.ts). The cleaned question becomes its
 * own item after the answer's words; the answer is never held back by it; a broken or over-long
 * hidden line is dropped, never shown; text that only looks like it (code, links) passes through;
 * and a reply from the v-previous rules (first line only, no last line) is unchanged.
 */
import { createQuestionLineFilter, MAX_QUESTION_LINE_CHARS } from '@kite/shared';
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
 * @returns Its items.
 */
async function read(pieces: string[]): Promise<ReplyItem[]> {
  const source = withAnswerMeta(reply(pieces));
  const items: ReplyItem[] = [];
  for (let next = await source.next(); !next.done; next = await source.next()) {
    items.push(next.value);
  }
  return items;
}

/**
 * The text items joined, and the question items, of a read reply.
 *
 * @param items The items.
 * @returns The shown text and the questions.
 */
function split(items: ReplyItem[]): { text: string; questions: string[] } {
  return {
    text: items.filter((item): item is string => typeof item === 'string').join(''),
    questions: items.flatMap((item) =>
      typeof item === 'object' && 'question' in item ? [item.question] : [],
    ),
  };
}

const ANSWER = 'DNS, connection, request, render.\n- Resolve the host.\n- Open a TLS connection.';
const LINE = '[[question|What happens when I type a URL into the browser?]]';

/**
 * Every way to cut a text into two pieces, plus one-character pieces.
 *
 * @param text The text.
 * @returns The piece lists.
 */
function cuts(text: string): string[][] {
  const all: string[][] = [[text], [...text]];
  for (let i = 1; i < text.length; i += 1) all.push([text.slice(0, i), text.slice(i)]);
  return all;
}

describe('withAnswerMeta: the hidden last line', () => {
  it('moves the question out of the text, wherever the pieces break', async () => {
    for (const pieces of cuts(`[[concept|call|general]]\n${ANSWER}\n${LINE}`)) {
      const items = await read(pieces);
      const { text, questions } = split(items);
      expect(text.trim()).toBe(ANSWER);
      expect(questions).toEqual(['What happens when I type a URL into the browser?']);
      // The meta comes first and the question after every word.
      expect(items[0]).toEqual({ meta: { type: 'concept', target: 'call', source: 'general' } });
      const last = items.at(-1);
      expect(typeof last === 'object' && 'question' in last).toBe(true);
    }
  });

  it('never holds the answer back: text without "[" goes out in the same piece', async () => {
    const filter = createQuestionLineFilter();
    expect(filter.push('Hello there.\n- One')).toEqual({ text: 'Hello there.\n- One' });
    // Only from a "[" that could start the line is anything held.
    expect(filter.push('\n[[ques')).toEqual({ text: '\n' });
    expect(filter.push('tion|Is it?]]')).toEqual({ text: '', question: 'Is it?' });
    expect(filter.end()).toEqual({ text: '' });
  });

  it('passes text that only looks like the line (code, links) through unchanged', async () => {
    const code = '```python\ngrid = [[1, 2], [3, 4]]\n[[0]]\n```\nSee [the docs](https://x.y).';
    for (const pieces of cuts(code)) {
      expect(split(await read(pieces)).text).toBe(code);
    }
  });

  it('drops a broken hidden line (a line break before "]]") and keeps what follows', async () => {
    const { text, questions } = split(await read([`${ANSWER}\n[[question|What is`, '\nTip: x']));
    expect(text).toBe(`${ANSWER}\nTip: x`);
    expect(questions).toEqual([]);
  });

  it('drops a hidden line that never closes, at the end of the reply (fail-safe)', async () => {
    const { text, questions } = split(await read([`${ANSWER}\n[[question|What is DNS`]));
    expect(text).toBe(`${ANSWER}\n`);
    expect(questions).toEqual([]);
    expect(text).not.toContain('[[');
  });

  it('drops an over-long hidden line up to its line break', async () => {
    const long = `[[question|${'x'.repeat(MAX_QUESTION_LINE_CHARS)}`;
    const { text } = split(await read([`${ANSWER}\n`, long, 'yyy\nAfter']));
    expect(text).toBe(`${ANSWER}\nAfter`);
  });

  it('releases a lone "[" at the end of the reply as text', async () => {
    expect(split(await read(['Pick option [', ''])).text).toBe('Pick option [');
  });

  it('a v-previous reply (no last line) is unchanged', async () => {
    const items = await read(['[[sales|call|docs]]\n', ANSWER]);
    expect(split(items)).toEqual({ text: ANSWER, questions: [] });
  });

  it('accepts white space inside the prefix and trims the question', async () => {
    const { questions } = split(
      await read([`${ANSWER}\n[[ Question |  Is it   priced per seat? ]]`]),
    );
    expect(questions).toEqual(['Is it priced per seat?']);
  });
});

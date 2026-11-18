/**
 * Tests for ADR-0089's contract fallback in apps/web/src/server/answer-meta.ts:
 * - createTagFilter() takes complete hidden-line tags ("[[word|…]]") out of streamed text, even split
 *   across pieces, and leaves everything else alone (code such as "[[1, 2], [3, 4]]", a lone "[");
 * - withContractFallback() sends the default meta before the first words when the hidden first line is
 *   missing, keeps a real meta, and counts what was missing;
 * - ADR-0103, withAnswerMeta(): text written before the hidden first line is never shown, a leading
 *   "[[question|…]]" line is taken out, a malformed "[[question|for|source]]" never becomes the
 *   question, and a reply that opens with its hidden line gets no added wait.
 */
import type { AnswerMeta } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import {
  createTagFilter,
  MAX_LEADING_CHARS,
  withAnswerMeta,
  withContractFallback,
  type ContractStats,
  type ReplyItem,
} from '@/server/answer-meta';

/**
 * Runs pieces through a tag filter.
 *
 * @param pieces The pieces.
 * @returns The text shown and the tags removed.
 */
function filter(pieces: string[]): { text: string; removed: number } {
  const tags = createTagFilter();
  let text = '';
  let removed = 0;
  for (const piece of pieces) {
    const out = tags.push(piece);
    text += out.text;
    removed += out.removed;
  }
  const end = tags.end();
  return { text: text + end.text, removed: removed + end.removed };
}

/**
 * A reply source from pieces.
 *
 * @param pieces The pieces.
 * @yields Each piece.
 * @returns A fake result.
 */
async function* source(pieces: string[]): AsyncGenerator<string, { done: true }, undefined> {
  for (const piece of pieces) yield piece;
  return { done: true };
}

/** The default meta. */
const FALLBACK: AnswerMeta = { type: 'other', target: 'call', source: 'general' };

/**
 * Collects the items of a wrapped reply.
 *
 * @param pieces The model's pieces.
 * @returns The items and the stats.
 */
async function collect(pieces: string[]): Promise<{ items: ReplyItem[]; stats: ContractStats }> {
  const stats: ContractStats = { missingMeta: false, missingQuestion: false, strippedTags: 0 };
  const items: ReplyItem[] = [];
  for await (const item of withContractFallback(withAnswerMeta(source(pieces)), FALLBACK, stats)) {
    items.push(item);
  }
  return { items, stats };
}

describe('createTagFilter', () => {
  it('removes hidden-line tags, even split across pieces', () => {
    expect(filter(['Ship in two days. [[sales|call|docs]] Thanks.'])).toEqual({
      text: 'Ship in two days.  Thanks.',
      removed: 1,
    });
    expect(filter(['A [', '[sal', 'es|call|', 'docs]] B'])).toEqual({ text: 'A  B', removed: 1 });
  });

  it('leaves code, single brackets and unfinished text alone', () => {
    expect(filter(['m = [[1, 2], [3, 4]]'])).toEqual({ text: 'm = [[1, 2], [3, 4]]', removed: 0 });
    expect(filter(['a[0] and [b]'])).toEqual({ text: 'a[0] and [b]', removed: 0 });
    expect(filter(['ends with ['])).toEqual({ text: 'ends with [', removed: 0 });
    expect(filter(['[[note|no end'])).toEqual({ text: '[[note|no end', removed: 0 });
  });
});

describe('withContractFallback', () => {
  it('sends the default meta before the first words when the hidden line is missing', async () => {
    const { items, stats } = await collect(['We ship in two days.']);
    expect(items[0]).toEqual({ meta: FALLBACK });
    expect(items.slice(1).join('')).toBe('We ship in two days.');
    expect(stats).toEqual({ missingMeta: true, missingQuestion: true, strippedTags: 0 });
  });

  it('keeps a reply that follows the contract as it is', async () => {
    const { items, stats } = await collect([
      '[[sales|call|docs]]\nWe ship in two days.\n[[question|How fast do you ship?]]',
    ]);
    expect(items[0]).toEqual({ meta: { type: 'sales', target: 'call', source: 'docs' } });
    expect(items).toContainEqual({ question: 'How fast do you ship?' });
    expect(items.filter((item) => typeof item === 'string').join('')).not.toContain('[[');
    expect(stats).toEqual({ missingMeta: false, missingQuestion: false, strippedTags: 0 });
  });

  it('sends nothing for an empty reply (garbled or none)', async () => {
    const { items, stats } = await collect(['[[none|call|call]]\n[[question|Can you hear me?]]']);
    expect(items.filter((item) => typeof item === 'string')).toEqual([]);
    expect(stats.missingMeta).toBe(false);
  });
});

/**
 * The text items of a reply, joined.
 *
 * @param items The items.
 * @returns The shown text.
 */
function shownText(items: ReplyItem[]): string {
  return items.filter((item): item is string => typeof item === 'string').join('');
}

/**
 * Collects a reply through withAnswerMeta() (with its stats) and withContractFallback().
 *
 * @param pieces The model's pieces.
 * @returns The items and the stats.
 */
async function collectWithLeading(
  pieces: string[],
): Promise<{ items: ReplyItem[]; stats: ContractStats }> {
  const stats: ContractStats = { missingMeta: false, missingQuestion: false, strippedTags: 0 };
  const items: ReplyItem[] = [];
  for await (const item of withContractFallback(
    withAnswerMeta(source(pieces), stats),
    FALLBACK,
    stats,
  )) {
    items.push(item);
  }
  return { items, stats };
}

describe('text before the hidden first line (ADR-0103)', () => {
  it('drops a stray line before the hidden line and keeps the real meta', async () => {
    const { items, stats } = await collectWithLeading([
      'Hmm, the answer line needs to come first. Let me ',
      'correct that.\n',
      '[[concept|call|docs]]\n',
      'It re-routes live.\n- One detail.\n[[question|How does it work?]]',
    ]);
    expect(items[0]).toEqual({ meta: { type: 'concept', target: 'call', source: 'docs' } });
    expect(shownText(items)).toBe('It re-routes live.\n- One detail.\n');
    expect(items).toContainEqual({ question: 'How does it work?' });
    expect(stats.missingMeta).toBe(false);
    expect(stats.droppedLeadingText).toBe(true);
  });

  it('drops a one-word line before the hidden line, even split across pieces', async () => {
    const { items } = await collectWithLeading([
      'Re-routing',
      '\n[[con',
      'cept|call|docs]]\nIt re-routes live.',
    ]);
    expect(items[0]).toEqual({ meta: { type: 'concept', target: 'call', source: 'docs' } });
    expect(shownText(items)).toBe('It re-routes live.');
  });

  it('takes out a leading question line and still finds the hidden line after it', async () => {
    const { items, stats } = await collectWithLeading([
      '[[question|What happened to late deliveries?]]\n',
      '[[sales|call|docs]]\nThey dropped by a third.\n[[question|What happened to late deliveries?]]',
    ]);
    expect(items[0]).toEqual({ question: 'What happened to late deliveries?' });
    expect(items[1]).toEqual({ meta: { type: 'sales', target: 'call', source: 'docs' } });
    expect(shownText(items)).toBe('They dropped by a third.\n');
    expect(stats.missingMeta).toBe(false);
  });

  it('shows the answer after a leading question line with no hidden line at all', async () => {
    const { items, stats } = await collectWithLeading([
      '[[question|What happened to late deliveries?]]\nThey dropped by a third.\n- In the pilot.',
    ]);
    expect(items).toContainEqual({ question: 'What happened to late deliveries?' });
    expect(items).toContainEqual({ meta: FALLBACK });
    expect(shownText(items)).toBe('They dropped by a third.\n- In the pilot.');
    expect(stats.missingMeta).toBe(true);
  });

  it('never turns a malformed "[[question|for|source]]" line into the question', async () => {
    const { items } = await collectWithLeading([
      '[[question|for|source]]\n',
      "I'll confirm the fee after the call.\nNote: check the onboarding fee.",
    ]);
    expect(items.some((item) => typeof item !== 'string' && 'question' in item)).toBe(false);
    expect(items[0]).toEqual({ meta: FALLBACK });
    expect(shownText(items)).toBe(
      "I'll confirm the fee after the call.\nNote: check the onboarding fee.",
    );
  });

  it('still shows a reply with no hidden lines in full', async () => {
    const { items, stats } = await collectWithLeading(['We ship in two days.\n- From Leeds.']);
    expect(items[0]).toEqual({ meta: FALLBACK });
    expect(shownText(items)).toBe('We ship in two days.\n- From Leeds.');
    expect(stats.droppedLeadingText).toBeUndefined();
  });

  it('releases a long first line with no hidden line before the reply ends', async () => {
    const long = 'word '.repeat(MAX_LEADING_CHARS / 5 + 1);
    const order: string[] = [];
    /**
     * A reply that records when each piece is read.
     *
     * @yields Each piece.
     * @returns A fake result.
     */
    async function* tracked(): AsyncGenerator<string, number, undefined> {
      order.push('piece 1');
      yield long;
      order.push('piece 2');
      yield 'end.';
      return 0;
    }
    for await (const item of withAnswerMeta(tracked())) {
      if (typeof item === 'string') order.push('text');
    }
    expect(order.indexOf('text')).toBeLessThan(order.indexOf('piece 2'));
  });

  it('adds no wait to a reply that opens with its hidden line', async () => {
    const order: string[] = [];
    /**
     * A compliant reply that records when each piece is read.
     *
     * @yields Each piece.
     * @returns A fake result.
     */
    async function* tracked(): AsyncGenerator<string, number, undefined> {
      order.push('piece 1');
      yield '[[sales|call|docs]]\nWe';
      order.push('piece 2');
      yield ' ship in two days.';
      return 0;
    }
    for await (const item of withAnswerMeta(tracked())) {
      if (typeof item === 'string') order.push(`text:${item}`);
    }
    expect(order).toEqual(['piece 1', 'text:We', 'piece 2', 'text: ship in two days.']);
  });
});

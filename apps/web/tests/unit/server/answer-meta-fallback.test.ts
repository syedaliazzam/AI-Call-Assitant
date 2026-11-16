/**
 * Tests for ADR-0089's contract fallback in apps/web/src/server/answer-meta.ts:
 * - createTagFilter() takes complete hidden-line tags ("[[word|…]]") out of streamed text, even split
 *   across pieces, and leaves everything else alone (code such as "[[1, 2], [3, 4]]", a lone "[");
 * - withContractFallback() sends the default meta before the first words when the hidden first line is
 *   missing, keeps a real meta, and counts what was missing.
 */
import type { AnswerMeta } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import {
  createTagFilter,
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

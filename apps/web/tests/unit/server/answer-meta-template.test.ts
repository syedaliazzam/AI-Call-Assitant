/**
 * Tests ADR-0112's "never show a broken reply" in apps/web/src/server/answer-meta.ts (withAnswerMeta()
 * with stopOnTemplate, as the live answers route calls it) and apps/web/src/core/answer/finishedReply.ts
 * (finishedReplyAction(), the page's decision when a reply ends):
 * - a reply that opens with a copied template line ("[[type|for|source]]", "[[question|…]]", or one after
 *   a line of self-talk) is stopped at once: nothing is sent, the model's stream is stopped, the flag is
 *   set, and the page asks again once;
 * - an empty reply (only its hidden lines) is asked again once too;
 * - a retry that answers is shown; one that is still empty or templated gives up with the notice;
 * - without stopOnTemplate (the Ask AI page) the template is dropped and the real line used, as before;
 * - a placeholder last line ("[[question|…]]") never becomes the card's question.
 */
import { describe, expect, it, vi } from 'vitest';
import { finishedReplyAction } from '@/core/answer/finishedReply';
import {
  withAnswerMeta,
  withContractFallback,
  type ContractStats,
  type ReplyItem,
} from '@/server/answer-meta';

/** The result a stopped live reply returns (the route's NO_USAGE). */
const STOPPED = { stopped: true } as const;

/** What one reply looked like after the route's pipeline. */
interface Piped {
  /** Every item sent to the browser. */
  items: ReplyItem[];
  /** The answer text the browser shows. */
  text: string;
  /** The flags the route logs. */
  stats: ContractStats;
  /** What the pipeline returned. */
  result: unknown;
  /** True when the model's stream was stopped before its last piece. */
  stoppedEarly: boolean;
}

/**
 * Runs model pieces through the live route's pipeline (withAnswerMeta with stopOnTemplate, then the
 * contract fallback), recording whether the model's own stream was stopped early.
 *
 * @param pieces The model's pieces.
 * @param live   False for the Ask AI page (no stopOnTemplate).
 * @returns What the browser would receive.
 */
async function pipe(pieces: string[], live = true): Promise<Piped> {
  let finished = false;
  const stoppedSpy = vi.fn();
  /**
   * The model's stream.
   *
   * @yields Each piece.
   * @returns The model's result.
   */
  async function* model(): AsyncGenerator<string, { stopped: false }, undefined> {
    try {
      for (const piece of pieces) yield piece;
      finished = true;
      return { stopped: false };
    } finally {
      if (!finished) stoppedSpy();
    }
  }
  const stats: ContractStats = { missingMeta: false, missingQuestion: false, strippedTags: 0 };
  const wrapped = withContractFallback<unknown>(
    withAnswerMeta<unknown>(model(), stats, live ? { stopOnTemplate: () => STOPPED } : {}),
    { type: 'other', target: 'call', source: 'general' },
    stats,
  );
  const items: ReplyItem[] = [];
  let next = await wrapped.next();
  for (; !next.done; next = await wrapped.next()) items.push(next.value);
  const text = items.filter((item): item is string => typeof item === 'string').join('');
  return { items, text, stats, result: next.value, stoppedEarly: stoppedSpy.mock.calls.length > 0 };
}

describe('a templated first line (live answers)', () => {
  it('stops "[[type|for|source]]" at once: nothing sent, stream stopped, flagged', async () => {
    const reply = await pipe([
      '[[type|for|source]]\n',
      'Hmm, the first line has to be the hidden type line. Correct version:\n\n',
      '[[concept|call|docs]]\nThe notice period is 30 days.',
    ]);
    expect(reply.items).toEqual([]);
    expect(reply.text).toBe('');
    expect(reply.result).toBe(STOPPED);
    expect(reply.stoppedEarly).toBe(true);
    expect(reply.stats.templatedReply).toBe(true);
    // No default meta either: the card never gets an "Other" label from a broken reply.
    expect(reply.stats.missingMeta).toBe(false);
    expect(finishedReplyAction(reply.text, { templated: true }, false)).toBe('retry');
  });

  it('stops the same slots under a real type, and a copied question template first', async () => {
    for (const first of [
      '[[concept|for|source]]\n',
      '[[question|…]]\n',
      '[[question|for|source]]\n',
    ]) {
      const reply = await pipe([first, '[[concept|call|general]]\nAnswer.']);
      expect(reply.items).toEqual([]);
      expect(reply.stats.templatedReply).toBe(true);
    }
  });

  it('stops a template that comes after a line of self-talk, split across pieces', async () => {
    const reply = await pipe(['Correct output:\n', '[[ty', 'pe|for|sou', 'rce]]', '\nAnswer.']);
    expect(reply.items).toEqual([]);
    expect(reply.stats.templatedReply).toBe(true);
  });

  it('leaves a compliant reply exactly as before, with no stop and no flag', async () => {
    const reply = await pipe(['[[concept|call|general]]\nCaching keeps', ' recent data close.']);
    expect(reply.items[0]).toEqual({
      meta: { type: 'concept', target: 'call', source: 'general' },
    });
    expect(reply.text).toBe('Caching keeps recent data close.');
    expect(reply.stats.templatedReply).toBeUndefined();
    expect(reply.stoppedEarly).toBe(false);
  });

  it('on the Ask AI page (no retry there) drops the template and uses the real line, as before', async () => {
    const reply = await pipe(
      ['[[type|kite|source]]\n', '[[concept|kite|general]]\nDNS maps names.'],
      false,
    );
    expect(reply.items[0]).toEqual({
      meta: { type: 'concept', target: 'kite', source: 'general' },
    });
    expect(reply.text).toBe('DNS maps names.');
    expect(reply.stats.templatedReply).toBeUndefined();
  });
});

describe('an empty reply', () => {
  it('has no answer text, so the page asks again once', async () => {
    const reply = await pipe(['[[concept|call|general]]\n', '[[question|How does caching work?]]']);
    expect(reply.text).toBe('');
    expect(reply.stats.templatedReply).toBeUndefined();
    expect(finishedReplyAction(reply.text, {}, false)).toBe('retry');
    expect(finishedReplyAction('  \n ', {}, false)).toBe('retry');
  });
});

describe('the silent retry', () => {
  it('shows the retry when it answers', async () => {
    const first = await pipe(['[[type|for|source]]\nAnswer.']);
    expect(finishedReplyAction(first.text, { templated: true }, false)).toBe('retry');
    const second = await pipe(['[[concept|call|general]]\nCaching keeps recent data close.']);
    expect(second.text).toBe('Caching keeps recent data close.');
    expect(finishedReplyAction(second.text, {}, true)).toBe('show');
  });

  it('gives up after one retry that is still empty or templated (no third request)', () => {
    expect(finishedReplyAction('', {}, true)).toBe('give-up');
    expect(finishedReplyAction('', { templated: true }, true)).toBe('give-up');
  });

  it('shows an ordinary answer on the first request (nothing to retry)', () => {
    expect(finishedReplyAction('The notice period is 30 days.', {}, false)).toBe('show');
  });
});

describe('a placeholder last line', () => {
  it('is taken out and never becomes the question', async () => {
    const reply = await pipe(['[[concept|call|general]]\nAnswer.\n', '[[question|…]]']);
    expect(reply.text.trim()).toBe('Answer.');
    expect(reply.items.some((item) => typeof item === 'object' && 'question' in item)).toBe(false);
    expect(reply.stats.missingQuestion).toBe(true);
  });
});

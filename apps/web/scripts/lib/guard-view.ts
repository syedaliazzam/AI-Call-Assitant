/**
 * File: apps/web/scripts/lib/guard-view.ts
 * Purpose: ADR-0112, the evaluation's --guard check: what the USER would see for a reply, not what the
 *          model wrote. A raw reply goes through the live route's pipeline (withAnswerMeta with the
 *          template stop, then withContractFallback) and the page's retry rule (finishedReplyAction());
 *          when the page would ask again, the caller's second request goes through the same way.
 * Used by: scripts/eval-answers.ts (--guard)
 * Depends on: src/server/answer-meta.ts, src/core/answer/finishedReply.ts, @kite/shared
 * Architecture: docs/decisions/ADR-0112-silent-retry-for-broken-replies.md
 */
import { containsTemplateLine, type AnswerMeta } from '@kite/shared';
import { finishedReplyAction } from '@/core/answer/finishedReply';
import { withAnswerMeta, withContractFallback, type ContractStats } from '@/server/answer-meta';
import type { GuardCheck } from './eval-results';

/** What the page receives for one reply after the route's pipeline. */
export interface PipedReply {
  /** The answer text shown on the card. */
  text: string;
  /** The meta the page got (the reply's own, or the default when it had none), or null for none. */
  meta: AnswerMeta | null;
  /** The server stopped the reply on a copied template (done.templated). */
  templated: boolean;
  /** No hidden first line of its own: the default meta was sent. */
  missingMeta: boolean;
}

/**
 * Runs a whole raw reply through the live route's pipeline, as app/api/answer/route.ts does for a live
 * answer (the meta fallback is the route's: type other, the call, general).
 *
 * @param raw The model's whole reply.
 * @returns What the page receives.
 * Called from: guardCheck(); tests
 */
export async function pipeReply(raw: string): Promise<PipedReply> {
  /**
   * The reply as one piece.
   *
   * @yields The reply.
   * @returns Nothing.
   */
  async function* source(): AsyncGenerator<string, null, undefined> {
    yield raw;
    return null;
  }
  const stats: ContractStats = { missingMeta: false, missingQuestion: false, strippedTags: 0 };
  const items = withContractFallback<null>(
    withAnswerMeta<null>(source(), stats, { stopOnTemplate: () => null }),
    { type: 'other', target: 'call', source: 'general' },
    stats,
  );
  let text = '';
  let meta: AnswerMeta | null = null;
  for await (const item of items) {
    if (typeof item === 'string') text += item;
    else if ('meta' in item && meta === null) meta = item.meta;
  }
  return {
    text,
    meta,
    templated: stats.templatedReply === true,
    missingMeta: stats.missingMeta,
  };
}

/**
 * What the user sees for a reply: an answer card, the notice, or nothing by design (garbled or none).
 * The second request is made only when the page would ask again.
 *
 * @param firstRaw The first reply.
 * @param askAgain Makes the second request and returns its raw reply.
 * @returns The check.
 * Called from: answerScenario() in scripts/eval-answers.ts (--guard); tests
 */
export async function guardCheck(
  firstRaw: string,
  askAgain: () => Promise<string>,
): Promise<GuardCheck> {
  const first = await pipeReply(firstRaw);
  const firstEmpty = first.text.trim() === '';
  /**
   * The check for a reply the page keeps or drops.
   *
   * @param piped   The reply.
   * @param retried Whether it was the retry.
   * @returns The check.
   */
  const outcome = (piped: PipedReply, retried: boolean): GuardCheck => {
    const base = { firstTemplated: first.templated, firstEmpty, retried };
    // The page removes a garbled or none reply's card before the guard (useLiveAnswers.ts onMeta).
    if (piped.meta?.type === 'garbled' || piped.meta?.type === 'none') {
      return { ...base, outcome: 'dropped', cardWithoutMeta: false, templateVisible: false };
    }
    const action = finishedReplyAction(
      piped.text,
      { ...(piped.templated ? { templated: true } : {}) },
      retried,
    );
    if (action !== 'show') {
      return { ...base, outcome: 'notice', cardWithoutMeta: false, templateVisible: false };
    }
    return {
      ...base,
      outcome: 'card',
      cardWithoutMeta: piped.missingMeta,
      templateVisible: containsTemplateLine(piped.text) || /\[\[\s*type\s*\|/i.test(piped.text),
    };
  };
  const firstAction = finishedReplyAction(
    first.text,
    { ...(first.templated ? { templated: true } : {}) },
    false,
  );
  if (first.meta?.type === 'garbled' || first.meta?.type === 'none' || firstAction === 'show') {
    return outcome(first, false);
  }
  return outcome(await pipeReply(await askAgain()), true);
}

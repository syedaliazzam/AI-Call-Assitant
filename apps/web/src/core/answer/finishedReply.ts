/**
 * File: apps/web/src/core/answer/finishedReply.ts
 * Purpose: Decides what the live answers page does with a reply when it finishes: show it, ask again
 *          once silently (no answer text, or a reply the server stopped on a copied template), or give
 *          up with a short notice. One rule for every kind of question: typed, spoken, screenshot, auto.
 * Used by: src/features/live/useLiveAnswers.ts (onDone)
 * Depends on: ./answerClient.ts (AnswerDone)
 * Architecture: docs/decisions/ADR-0112-silent-retry-for-broken-replies.md
 *               (extends ADR-0107's "a card never stays empty")
 */
import type { AnswerDone } from './answerClient';

/**
 * What to do with a finished reply:
 * - `show`: it has answer text; keep the card.
 * - `retry`: nothing to show; ask once more, silently, with no card on screen meanwhile.
 * - `give-up`: still nothing after that retry; remove the card and show the notice.
 */
export type FinishedReplyAction = 'show' | 'retry' | 'give-up';

/**
 * Decides what to do with a finished reply. A reply needs another try when it has no answer text (only
 * its hidden lines, or nothing) or when the server stopped it on a copied template line
 * (`done.templated`, which also arrives with no text). The second request never asks a third time.
 *
 * @param text    The answer text the page received (hidden lines already taken out by the server).
 * @param done    The reply's end event (its `templated` flag).
 * @param retried True when this reply was already the silent retry.
 * @returns See FinishedReplyAction.
 * Called from: onDone in useLiveAnswers() (src/features/live/useLiveAnswers.ts); tests
 */
export function finishedReplyAction(
  text: string,
  done: Pick<AnswerDone, 'templated'>,
  retried: boolean,
): FinishedReplyAction {
  if (text.trim() !== '' && done.templated !== true) return 'show';
  return retried ? 'give-up' : 'retry';
}

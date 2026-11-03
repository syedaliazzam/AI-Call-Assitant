/**
 * File: apps/web/src/server/answer-meta.ts
 * Purpose: Removes the hidden first line ("[[coding|call|docs]]") from a streaming Claude reply and
 *          hands it on as one item of its own, so the browser never sees it as answer text and the
 *          time to the first word counts from the first word the user can read. Since v1.0.2 it
 *          also removes the hidden last line ("[[question|…]]", ADR-0037) the same way.
 * Used by: app/api/answer/route.ts; scripts/eval-answers.ts, scripts/measure-first-word.ts
 * Depends on: @kite/shared (splitMetaLine, AnswerMeta)
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 *
 * Nothing is held back once the line has passed: every later piece goes out as it arrives.
 */
import 'server-only';
import { createQuestionLineFilter, splitMetaLine, type AnswerMeta } from '@kite/shared';

/** What the hidden first line said, as one item of a reply. */
export interface ReplyMeta {
  /** Its contents. */
  meta: AnswerMeta;
}

/** What the hidden last line said (v1.0.2, ADR-0037), as one item of a reply. */
export interface ReplyQuestion {
  /** The question the answer is for, cleaned up by Claude. Never logged. */
  question: string;
}

/** A reply's item: a piece of answer text, or what a hidden line said. */
export type ReplyItem = string | ReplyMeta | ReplyQuestion;

/**
 * Wraps a reply, moving its hidden first line and its hidden last line out of the text. A reply
 * without them is passed through whole, so an odd reply is never lost; a hidden line that breaks
 * is dropped rather than shown (createQuestionLineFilter()).
 *
 * @param source The reply's text pieces, finishing with its result.
 * @returns The same reply, with `{ meta }` as an item before the first word and `{ question }`
 *          where the last line completes.
 * Called from: POST handler in app/api/answer/route.ts; scripts; tests
 */
export async function* withAnswerMeta<R>(
  source: AsyncGenerator<string, R, undefined>,
): AsyncGenerator<ReplyItem, R, undefined> {
  // 'looking' for the line; 'trimming' the white space after it, which can arrive in later
  // pieces; 'passing' everything else on as it comes.
  let state: 'looking' | 'trimming' | 'passing' = 'looking';
  let held = '';
  // Every piece of answer text goes through this, so the hidden last line never reaches the
  // browser; text without "[" passes straight through, so nothing is delayed.
  const lastLine = createQuestionLineFilter();
  /**
   * The items for one piece of answer text, after the last-line filter.
   *
   * @param piece The text.
   * @returns Zero, one or two items (text, then the question).
   */
  const filtered = (piece: string): ReplyItem[] => {
    const { text, question } = lastLine.push(piece);
    return [...(text ? [text] : []), ...(question ? [{ question }] : [])];
  };
  // try/finally: when the browser disconnects, the wrapped reply must stop too, or Claude keeps
  // writing (and billing) an answer nobody reads.
  try {
    for (;;) {
      const next = await source.next();
      if (next.done) {
        // The reply ended while it could still have been the line: what was held is the answer.
        if (state === 'looking' && held.trim() !== '') yield* filtered(held.trim());
        const { text, question } = lastLine.end();
        if (text) yield text;
        if (question) yield { question };
        return next.value;
      }
      if (state === 'passing') {
        yield* filtered(next.value);
        continue;
      }
      held += next.value;
      if (state === 'looking') {
        const split = splitMetaLine(held);
        if (split.state === 'waiting') continue;
        if (split.state === 'found') {
          yield { meta: split.meta };
          held = split.rest;
        }
        state = 'trimming';
      }
      held = held.trimStart();
      if (held === '') continue;
      state = 'passing';
      yield* filtered(held);
    }
  } finally {
    await source.return(undefined as R);
  }
}

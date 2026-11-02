/**
 * File: apps/web/src/server/answer-meta.ts
 * Purpose: Removes the hidden first line ("[[coding|call|docs]]") from a streaming Claude reply and
 *          hands it on as one item of its own, so the browser never sees it as answer text and the
 *          time to the first word counts from the first word the user can read.
 * Used by: app/api/answer/route.ts; scripts/eval-answers.ts, scripts/measure-first-word.ts
 * Depends on: @kite/shared (splitMetaLine, AnswerMeta)
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 *
 * Nothing is held back once the line has passed: every later piece goes out as it arrives.
 */
import 'server-only';
import { splitMetaLine, type AnswerMeta } from '@kite/shared';

/** What the hidden first line said, as one item of a reply. */
export interface ReplyMeta {
  /** Its contents. */
  meta: AnswerMeta;
}

/** A reply's item: a piece of answer text, or what the hidden first line said. */
export type ReplyItem = string | ReplyMeta;

/**
 * Wraps a reply, moving its hidden first line out of the text. A reply without one is passed
 * through whole, so an odd reply is never lost.
 *
 * @param source The reply's text pieces, finishing with its result.
 * @returns The same reply, with `{ meta }` as an item before the first word.
 * Called from: POST handler in app/api/answer/route.ts; scripts; tests
 */
export async function* withAnswerMeta<R>(
  source: AsyncGenerator<string, R, undefined>,
): AsyncGenerator<ReplyItem, R, undefined> {
  // 'looking' for the line; 'trimming' the white space after it, which can arrive in later
  // pieces; 'passing' everything else on as it comes.
  let state: 'looking' | 'trimming' | 'passing' = 'looking';
  let held = '';
  // try/finally: when the browser disconnects, the wrapped reply must stop too, or Claude keeps
  // writing (and billing) an answer nobody reads.
  try {
    for (;;) {
      const next = await source.next();
      if (next.done) {
        // The reply ended while it could still have been the line: what was held is the answer.
        if (state === 'looking' && held.trim() !== '') yield held.trim();
        return next.value;
      }
      if (state === 'passing') {
        yield next.value;
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
      yield held;
    }
  } finally {
    await source.return(undefined as R);
  }
}

/**
 * File: apps/web/src/server/answer-meta.ts
 * Purpose: Removes the hidden first line ("[[coding|call|docs]]") from a streaming Claude reply and
 *          hands it on as one item of its own, so the browser never sees it as answer text and the
 *          time to the first word counts from the first word the user can read. Since v1.0.2 it
 *          also removes the hidden last line ("[[question|…]]", ADR-0037) the same way. ADR-0089: a reply
 *          that breaks the app contract (no hidden first line, stray tags) is still shown cleanly.
 * Used by: app/api/answer/route.ts; scripts/eval-answers.ts, scripts/measure-first-word.ts
 * Depends on: @kite/shared (splitMetaLine, AnswerMeta)
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md,
 *               docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
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

/** ADR-0089: what the contract fallback saw in one reply (counts and flags only, for the log). */
export interface ContractStats {
  /** True when the reply had no hidden first line (the default meta was sent instead). */
  missingMeta: boolean;
  /** True when the reply had no hidden last line (the page uses the transcript's question). */
  missingQuestion: boolean;
  /** How many stray [[…]] tags were taken out of the answer text. */
  strippedTags: number;
}

/** Longest stray tag held back while looking for its end ("[[" … "]]"). */
const MAX_TAG_CHARS = 300;

/** The start of a hidden line: "[[", a word, then "|". */
const TAG_START = /^\[\[[a-z]{1,20}\|/i;

/** Text that could still become TAG_START once more arrives ("[[", "[[cod", …). */
const TAG_PREFIX = /^\[\[[a-z]{0,20}$/i;

/**
 * Takes complete "[[…]]" tags out of streamed text, so a hidden line the model put in the wrong place
 * never shows. Text without "[[" passes straight through; a "[[" is held until its "]]", a line break or
 * MAX_TAG_CHARS, whichever comes first (then it was not a tag and is passed on as it is).
 *
 * @returns push() for each piece and end() for what is held at the end; both return the text to show
 *          and how many tags were removed.
 * Called from: withContractFallback(); tests
 */
export function createTagFilter(): {
  push: (piece: string) => { text: string; removed: number };
  end: () => { text: string; removed: number };
} {
  let held = '';
  const run = (input: string, ended: boolean) => {
    let text = input;
    let out = '';
    let removed = 0;
    for (;;) {
      const start = text.indexOf('[[');
      if (start === -1) {
        // A single "[" at the very end may be the start of a tag: hold it for the next piece.
        if (!ended && text.endsWith('[')) {
          out += text.slice(0, -1);
          held = '[';
        } else out += text;
        break;
      }
      out += text.slice(0, start);
      const rest = text.slice(start);
      // Only the hidden lines' shape is a tag ("[[type|…]]", "[[question|…]]"): code such as
      // "[[1, 2], [3, 4]]" must pass untouched. Too short to tell yet: hold it for the next piece.
      if (!TAG_START.test(rest)) {
        if (!ended && TAG_PREFIX.test(rest)) {
          held = rest;
          break;
        }
        out += '[[';
        text = rest.slice(2);
        continue;
      }
      const close = rest.indexOf(']]');
      const lineBreak = rest.indexOf('\n');
      if (close !== -1 && (lineBreak === -1 || close < lineBreak) && close <= MAX_TAG_CHARS) {
        removed += 1;
        text = rest.slice(close + 2);
        continue;
      }
      if (!ended && close === -1 && lineBreak === -1 && rest.length <= MAX_TAG_CHARS) {
        held = rest;
        break;
      }
      // Not a tag: pass the brackets on and keep looking after them.
      out += '[[';
      text = rest.slice(2);
    }
    return { text: out, removed };
  };
  return {
    push(piece) {
      const input = held + piece;
      held = '';
      return run(input, false);
    },
    end() {
      const input = held;
      held = '';
      return run(input, true);
    },
  };
}

/**
 * ADR-0089's server fallback, around withAnswerMeta(): a reply that breaks the app contract is still
 * shown cleanly. When no hidden first line came before the first words, `fallback` is sent as the meta
 * (the page then shows the default type); stray "[[…]]" tags are taken out of the text; a missing hidden
 * last line is only counted (the page already falls back to the transcript's question). Nothing is
 * logged here: `stats` is filled for the route's own log line.
 *
 * @param source   The reply from withAnswerMeta().
 * @param fallback The meta to send when the reply has none.
 * @param stats    Filled with what was missing (the caller logs it).
 * @returns The same reply, cleaned.
 * Called from: POST handler in app/api/answer/route.ts; tests
 */
export async function* withContractFallback<R>(
  source: AsyncGenerator<ReplyItem, R, undefined>,
  fallback: AnswerMeta,
  stats: ContractStats,
): AsyncGenerator<ReplyItem, R, undefined> {
  const tags = createTagFilter();
  let sawMeta = false;
  let sawQuestion = false;
  /**
   * The items for a piece of shown text: the fallback meta first when none came yet.
   *
   * @param text The cleaned text.
   * @returns The items to send.
   */
  const shown = (text: string): ReplyItem[] => {
    if (text === '') return [];
    if (sawMeta) return [text];
    sawMeta = true;
    stats.missingMeta = true;
    return [{ meta: fallback }, text];
  };
  try {
    for (;;) {
      const next = await source.next();
      if (next.done) {
        const rest = tags.end();
        stats.strippedTags += rest.removed;
        yield* shown(rest.text);
        if (!sawQuestion) stats.missingQuestion = true;
        return next.value;
      }
      const item = next.value;
      if (typeof item !== 'string') {
        if ('meta' in item) {
          // A real meta that arrives after the fallback was sent is dropped (the card shows one).
          if (sawMeta) continue;
          sawMeta = true;
        } else sawQuestion = true;
        yield item;
        continue;
      }
      const cleaned = tags.push(item);
      stats.strippedTags += cleaned.removed;
      yield* shown(cleaned.text);
    }
  } finally {
    await source.return(undefined as R);
  }
}

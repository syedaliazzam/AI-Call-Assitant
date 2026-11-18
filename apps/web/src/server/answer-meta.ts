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
import {
  createQuestionLineFilter,
  MAX_QUESTION_LINE_CHARS,
  splitMetaLine,
  type AnswerMeta,
} from '@kite/shared';

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
 * ADR-0103: the most text held while a reply that did not open with its hidden line might still put
 * it on the next line. Measured stray openings were one line: a single word, a sentence of
 * self-correction, and 64 words of reasoning (about 380 characters). A longer first line is released
 * as answer text, so a reply with no hidden line at all is never held for long.
 */
export const MAX_LEADING_CHARS = 500;

/** A complete hidden question line at the very start of the text, with the line break after it. */
const LEADING_QUESTION_LINE = /^\[\[\s*question\s*\|([^[\]\n]*)\]\][ \t]*(?:\n|$)/i;

/** What leadingText() decides about text that did not open with the hidden first line. */
type LeadingDecision =
  | {
      /** Not enough text yet to tell: keep holding. */
      kind: 'wait';
    }
  | {
      /** No hidden first line is coming next: show the text as the answer (today's fallback). */
      kind: 'release';
    }
  | {
      /** A leading hidden question line: taken out; keep looking after it. */
      kind: 'question';
      /** The question, or null when the line was malformed ("[[question|for|source]]"). */
      question: string | null;
      /** The text after the line. */
      rest: string;
    }
  | {
      /** Stray text, then the hidden first line on the next line: the stray text is dropped. */
      kind: 'drop';
      /** The text from the hidden first line on. */
      rest: string;
    };

/**
 * ADR-0103: decides what to do with the start of a reply that did not open with its hidden first line
 * (splitMetaLine() said 'none'). A leading "[[question|…]]" line is taken out (the model sometimes
 * writes the last hidden line first); a first line of stray text (a word, a self-correction, reasoning)
 * is dropped when the hidden first line follows on the next line. Anything else is the answer.
 *
 * @param text The reply so far (white space at the start already removed).
 * @param ended True when no more text will come.
 * @returns See LeadingDecision.
 * Called from: withAnswerMeta()
 */
function leadingText(text: string, ended: boolean): LeadingDecision {
  if (/^\[\[\s*question\s*\|/i.test(text)) {
    const line = LEADING_QUESTION_LINE.exec(text);
    if (line) {
      const value = line[1]!.replace(/\s+/g, ' ').trim();
      // A "|" means the model filled the first line's slots into the question line
      // ("[[question|for|source]]"): not a question, never shown.
      return {
        kind: 'question',
        question: value === '' || value.includes('|') ? null : value,
        rest: text.slice(line[0].length).trimStart(),
      };
    }
    // Still arriving: hold it, within the question line's own limit.
    const open = !text.includes('\n') && !ended && text.length <= MAX_QUESTION_LINE_CHARS;
    return open ? { kind: 'wait' } : { kind: 'release' };
  }
  const lineBreak = text.indexOf('\n');
  if (lineBreak === -1) {
    return !ended && text.length <= MAX_LEADING_CHARS ? { kind: 'wait' } : { kind: 'release' };
  }
  const next = text.slice(lineBreak + 1).trimStart();
  if (next === '') return ended ? { kind: 'release' } : { kind: 'wait' };
  const split = splitMetaLine(next);
  if (split.state === 'found') return { kind: 'drop', rest: next };
  return split.state === 'waiting' && !ended ? { kind: 'wait' } : { kind: 'release' };
}

/**
 * Wraps a reply, moving its hidden first line and its hidden last line out of the text. A reply
 * without them is passed through whole, so an odd reply is never lost; a hidden line that breaks
 * is dropped rather than shown (createQuestionLineFilter()).
 *
 * ADR-0103: nothing written before the hidden first line is shown. A reply that opens with it is
 * passed on exactly as before (no added wait). One that does not is held for its first line only
 * (at most MAX_LEADING_CHARS): when the hidden first line follows, the stray line is dropped and the
 * real meta is used; a leading "[[question|…]]" line is taken out (a malformed one,
 * "[[question|for|source]]", never becomes the card's question); otherwise the text is the answer.
 *
 * @param source The reply's text pieces, finishing with its result.
 * @param stats  Optional: `droppedLeadingText` is set when stray text before the hidden line was
 *               dropped (the route logs it; a flag only, never the text).
 * @returns The same reply, with `{ meta }` as an item before the first word and `{ question }`
 *          where the last line completes.
 * Called from: POST handler in app/api/answer/route.ts; scripts; tests
 */
export async function* withAnswerMeta<R>(
  source: AsyncGenerator<string, R, undefined>,
  stats?: Pick<ContractStats, 'droppedLeadingText'>,
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
  /**
   * ADR-0103: the 'looking' step. Finds the hidden first line, or decides what the text before it is.
   *
   * @param ended True when no more text will come.
   * @returns The items to send now, and whether to keep looking.
   */
  const look = (ended: boolean): { items: ReplyItem[]; looking: boolean } => {
    const items: ReplyItem[] = [];
    for (;;) {
      held = held.trimStart();
      const split = splitMetaLine(held);
      if (split.state === 'found') {
        items.push({ meta: split.meta });
        held = split.rest;
        return { items, looking: false };
      }
      if (split.state === 'waiting' && !ended) return { items, looking: true };
      if (held === '') return { items, looking: !ended };
      const decision = leadingText(held, ended);
      if (decision.kind === 'wait') return { items, looking: true };
      if (decision.kind === 'release') return { items, looking: false };
      if (decision.kind === 'question' && decision.question) {
        items.push({ question: decision.question });
      }
      if (decision.kind === 'drop' && stats) stats.droppedLeadingText = true;
      held = decision.rest;
    }
  };
  try {
    for (;;) {
      const next = await source.next();
      if (next.done) {
        // The reply ended while it could still have been the line: what was held is the answer.
        if (state === 'looking') {
          const { items } = look(true);
          yield* items;
          if (held.trim() !== '') yield* filtered(held.trim());
        }
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
        const { items, looking } = look(false);
        yield* items;
        if (looking) continue;
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
  /**
   * ADR-0103: true when text the model wrote before its hidden first line was dropped (set by
   * withAnswerMeta(); absent otherwise).
   */
  droppedLeadingText?: boolean;
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

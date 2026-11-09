/**
 * File: apps/web/src/core/transcript/complete.ts
 * Purpose: Whether a line sounds finished (v1.4, ADR-0062). A line that ends on "and", "the", "about",
 *          "how", a comma and the like is cut in the middle: the speaker paused to think. Then the next
 *          line of the same speaker is joined to it after a longer pause (transcript.ts), and auto-answer
 *          waits longer before it answers (autoAnswer.ts). A line with no clue counts as finished, so a
 *          normal question is answered as quickly as before.
 * Used by: src/core/transcript/transcript.ts, src/core/answer/autoAnswer.ts
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 steps 2–3; ADR-0062
 *
 * Works on the live engine's capitals without punctuation and on punctuated text alike. Never logs text.
 */

/**
 * Words a finished sentence rarely ends on: joining words, articles, most prepositions, question words,
 * modal verbs and hesitation sounds. Words that often do end a question ("you", "that", "this", "more",
 * "do", "on", "in") are left out on purpose: a line that wrongly looks unfinished only waits 1.8 s longer.
 */
const UNFINISHED_LAST_WORDS = new Set([
  'and',
  'or',
  'but',
  'so',
  'because',
  'if',
  'then',
  'which',
  'who',
  'whose',
  'whether',
  'than',
  'the',
  'a',
  'an',
  'your',
  'my',
  'our',
  'their',
  'his',
  'her',
  'its',
  'of',
  'to',
  'for',
  'with',
  'about',
  'what',
  'how',
  'why',
  'when',
  'where',
  'is',
  'are',
  'was',
  'were',
  'can',
  'could',
  'would',
  'will',
  'should',
  'um',
  'umm',
  'uh',
  'er',
  'erm',
  'also',
  'very',
  'each',
  'every',
]);

/** Marks that leave a sentence open: a comma, a colon, a dash or an ellipsis at the very end. */
const OPEN_END = /[,;:\-–—…]\s*$/;

/**
 * Whether a line sounds cut off in the middle.
 *
 * @param text The line (capitals without punctuation, or punctuated).
 * @returns True when it ends on an open mark or on a word a sentence does not end on.
 * Called from: transcript.ts (the longer join), autoAnswer.ts (the longer wait); tests
 */
export function looksUnfinished(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  if (OPEN_END.test(trimmed)) return true;
  // A full stop or question mark from the punctuation model or the accurate engine closes it, unless the
  // last word itself is one a sentence cannot end on ("…tell me about the.").
  const words = trimmed.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const last = words.at(-1);
  return last !== undefined && UNFINISHED_LAST_WORDS.has(last);
}

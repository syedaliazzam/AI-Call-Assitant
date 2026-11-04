/**
 * File: apps/web/src/core/transcript/keyTermFix.ts
 * Purpose: Puts the session's key terms back into the accurate engine's text when it mishears them
 *          ("the Cabernet's rollout" for Kubernetes) (v1.1.0, item 22, ADR-0044). The accurate engine
 *          has nothing like the live engine's key-term boost that works: measured on 4 Nov 2026, its
 *          boost fixed 1 of 5 terms at a safe strength and broke the text at a stronger one. So words
 *          are compared by how they sound, after the engine has finished.
 * Used by: src/core/transcript/refine.ts; tests
 * Depends on: nothing (pure)
 * Architecture: docs/decisions/ADR-0044-transcript-auto-punctuation-cleanup.md
 *
 * The worse mistake is changing a word the person really said, so this is strict: a short sound pattern
 * must match exactly, and only a long one may differ a little ("harder" never becomes "Harbor"). Terms
 * with digits are left to display.ts, which knows their spoken forms. Text is never logged.
 */

/** A term whose sound pattern is shorter than this is never corrected: too many words sound alike. */
const MIN_PATTERN = 5;

/**
 * How far from the term a sound pattern may be.
 *
 * @param length The pattern's length.
 * @returns The largest edit distance allowed.
 */
const allowedDistance = (length: number): number => (length >= 10 ? 2 : length >= 8 ? 1 : 0);

/**
 * How a word sounds, roughly: letters that sound alike are one letter, and every run of vowels is one
 * vowel, because vowels are what speech recognition most often gets wrong.
 *
 * @param text A word or words.
 * @returns The sound pattern.
 * Called from: correctTerms(); tests
 */
export function soundPattern(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/qu/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/[cq]/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'f')
    .replace(/[aeiouy]+/g, 'a')
    .replace(/(.)\1+/g, '$1');
}

/**
 * A sound pattern's consonants: what stays the same when the engine cuts a word in two or runs two
 * together, as that adds or removes a vowel where they meet.
 *
 * @param pattern A sound pattern.
 * @returns Its consonants.
 * Called from: correctTerms()
 */
const consonants = (pattern: string): string => pattern.replace(/a/g, '');

/**
 * The edit distance between two strings, stopping once it is over a limit.
 *
 * @param a     One string.
 * @param b     The other.
 * @param limit The largest distance that matters.
 * @returns The distance, or limit + 1 when it is over.
 * Called from: correctTerms(); tests
 */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    if (Math.min(...current) > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length]!;
}

/** A word of the text, with the marks around it. */
interface TextWord {
  /** Marks before the word. */
  before: string;
  /** The word. */
  core: string;
  /** Marks after the word. */
  after: string;
}

/**
 * Splits a word from the marks around it.
 *
 * @param word A word as written.
 * @returns Its parts.
 * Called from: correctTerms()
 */
function parts(word: string): TextWord {
  const match = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(word);
  return { before: match?.[1] ?? '', core: match?.[2] ?? word, after: match?.[3] ?? '' };
}

/**
 * Replaces words that sound like a key term with the term as the user wrote it.
 *
 * @param text  The engine's text.
 * @param terms The session's key terms and company.
 * @returns The text, with the terms in place.
 * Called from: refineLine() in refine.ts; tests
 */
export function correctTerms(text: string, terms: readonly string[]): string {
  const usable = terms
    .filter((term) => !/\d/.test(term))
    .map((term) => ({
      term,
      pattern: soundPattern(term),
      words: term.split(/\s+/).length,
    }))
    .filter(({ pattern }) => pattern.length >= MIN_PATTERN)
    // The longest first, so "Bluefin Route" wins over "Route".
    .sort((a, b) => b.pattern.length - a.pattern.length);
  if (usable.length === 0) return text;

  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let at = 0; at < words.length;) {
    let replaced = 0;
    for (const { term, pattern, words: size } of usable) {
      // The engine may run a term together ("Preyurao") or split it ("Zane Pak"): one word more or
      // fewer than the term has, as far as the text has them. That is a bigger step from what was
      // written, so it must match exactly ("North wins" is not "Northwind").
      for (const span of [size, size + 1, size - 1]) {
        if (span < 1 || at + span > words.length) continue;
        const chosen = words.slice(at, at + span).map(parts);
        // Marks inside the words looked at mean a sentence ends there: never join across it.
        if (chosen.slice(0, -1).some((word) => /[,.?!;:]/.test(word.after))) continue;
        const heard = soundPattern(chosen.map((word) => word.core).join(''));
        const limit = allowedDistance(pattern.length);
        const matches =
          span === size
            ? heard[0] === pattern[0] && editDistance(heard, pattern, limit) <= limit
            : consonants(heard) === consonants(pattern);
        if (!matches) continue;
        out.push(`${chosen[0]!.before}${term}${chosen.at(-1)!.after}`);
        replaced = span;
        break;
      }
      if (replaced > 0) break;
    }
    if (replaced > 0) {
      at += replaced;
    } else {
      out.push(words[at]!);
      at += 1;
    }
  }
  return out.join(' ');
}

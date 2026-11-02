/**
 * File: apps/web/src/core/answer/claimCheck.ts
 * Purpose: After an answer finishes, finds the numbers, prices, percentages, dates and names in it
 *          that appear nowhere in the session's documents or the call, so the card can underline
 *          them with a private "check before saying" note. Plain text matching: no model call, so it
 *          costs nothing and adds no delay.
 * Used by: src/features/live/useLiveAnswers.ts; scripts/eval-answers.ts (the bait group's gate)
 * Depends on: @kite/shared (AnswerMeta type)
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 *
 * It errs towards flagging: a total Kite worked out correctly (40 seats × 52 dollars) is not in the
 * documents either, and is worth a look before saying it. Answer and document text is never logged.
 */

import type { AnswerMeta } from '@kite/shared';

/** Words for small numbers. Longer forms ("two thousand and eighty") are built from these. */
const UNITS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** Words that multiply what came before. */
const SCALES: Readonly<Record<string, number>> = {
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

/** Number words in a row, joined by spaces, hyphens or "and". */
const NUMBER_WORDS = new RegExp(
  `\\b(?:${[...Object.keys(UNITS), ...Object.keys(SCALES)].join('|')})(?:(?:\\s+and\\s+|[\\s-]+)(?:${[...Object.keys(UNITS), ...Object.keys(SCALES)].join('|')}))*\\b`,
  'gi',
);

/** Figures: "$1,200", "1,200", "2.5", "12%", "120k", "2.5 million", with an optional money sign. */
const FIGURE =
  /[$€£]?\s?\b\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s?(?:k|m|bn|million|billion|thousand)\b)?%?|[$€£]?\s?\b\d+(?:\.\d+)?(?:\s?(?:k|m|bn|million|billion|thousand)\b)?%?/gi;

/** Words that make a small spelled number a claim ("three years") and not a figure of speech. */
const COUNTED_UNITS =
  /^\s+(?:percent|per cent|years?|months?|weeks?|days?|hours?|minutes?|people|engineers?|developers?|customers?|clients?|users?|seats?|dollars?|euros?|pounds?|projects?|teams?|times?)\b/i;

/** A date written with a month name: "March 12", "12 March 2026", "March 2026". */
const MONTH_DATE =
  /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{1,2}(?:st|nd|rd|th)?(?=\b))?(?:,?\s+\d{4})?\b/gi;

/** A capitalised word: part of a name (with its inner capitals and marks, for "O'Neil" or "AWS"). */
const NAME = /\b[A-Z][\p{L}\p{N}'’.-]*[\p{L}\p{N}](?:\s+[A-Z][\p{L}\p{N}'’.-]*[\p{L}\p{N}])*/gu;

/**
 * Capitalised words that are not claims about anyone: sentence openers, days and months, and common
 * technical names, which appear in any technical answer and would only add noise.
 */
const NOT_NAMES = new Set(
  (
    "i i'd i'll i'm i've as at but by for from he her his if in it its my no not of on or our she so " +
    'that the their then there these they this to we what when where which who why with yes you your ' +
    'first second third next last also and after before during once while because however since ' +
    'tip note say complexity edge cases steps step approach result situation assumptions ' +
    'monday tuesday wednesday thursday friday saturday sunday ' +
    'january february march april may june july august september october november december ' +
    'python javascript typescript java go golang rust ruby php swift kotlin scala sql nosql html css ' +
    'react angular vue node nodejs next django flask spring express fastapi rails laravel ' +
    'aws azure gcp google cloud docker kubernetes terraform linux windows macos git github gitlab jenkins ' +
    'postgres postgresql mysql redis kafka rabbitmq mongodb elasticsearch dynamodb s3 ec2 lambda ' +
    'graphql rest api apis http https json xml ci cd ai ml llm etl oauth sso jwt tcp udp ' +
    'lru fifo bfs dfs oop mvc dns cdn crud sla slas kpi kpis roi crm saas o ' +
    'none null true false nil id ids url urls ui ux dom websocket websockets crdt crdts ot b-tree explain'
  ).split(' '),
);

/**
 * Whether an answer's claims are worth checking. A private answer is not said. A screenshot's
 * figures are on the screen, which the check cannot read. A case answer's figures are its stated
 * assumptions, so every one of them would be underlined.
 *
 * @param meta What the hidden line said.
 * @param mode How the answer was asked.
 * @returns True to check it.
 * Called from: useLiveAnswers.ts; scripts/eval-answers.ts; tests
 */
export function needsClaimCheck(
  meta: Pick<AnswerMeta, 'type' | 'target'> | null | undefined,
  mode: string,
): boolean {
  return meta?.target !== 'kite' && meta?.type !== 'case' && mode !== 'screenshot';
}

/** A claim found in an answer. */
export interface Claim {
  /** Its exact words in the answer, so the card can underline them. */
  text: string;
  /** What kind of thing it is. */
  kind: 'number' | 'date' | 'name';
}

/**
 * Lower-cases text and closes up what varies, so "Bluefin-Route" finds "bluefin route".
 *
 * @param text Any text.
 * @returns The text for comparing names.
 * Called from: buildClaimCorpus(), checkClaims()
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The value of a figure as a plain number: "$1,200" is 1200, "120k" is 120000, "12%" is 12.
 *
 * @param figure A match of FIGURE.
 * @returns The value, or null when it has none.
 * Called from: numbersIn(), checkClaims()
 */
function figureValue(figure: string): number | null {
  const match = /(\d[\d,]*(?:\.\d+)?)\s?(k|m|bn|million|billion|thousand)?/i.exec(figure);
  if (!match) return null;
  const base = Number(match[1]!.replaceAll(',', ''));
  const scale = (match[2] ?? '').toLowerCase();
  const multiplier =
    scale === 'k' || scale === 'thousand'
      ? 1_000
      : scale === 'm' || scale === 'million'
        ? 1_000_000
        : scale === 'bn' || scale === 'billion'
          ? 1_000_000_000
          : 1;
  return Number.isFinite(base) ? base * multiplier : null;
}

/**
 * The value of spelled-out number words: "two thousand and eighty" is 2080.
 *
 * @param words A match of NUMBER_WORDS.
 * @returns The value.
 * Called from: numbersIn(), checkClaims()
 */
function wordsValue(words: string): number {
  let total = 0;
  let current = 0;
  for (const word of words.toLowerCase().split(/[\s-]+/)) {
    if (word === 'and') continue;
    const unit = UNITS[word];
    if (unit !== undefined) {
      current += unit;
      continue;
    }
    const scale = SCALES[word] ?? 1;
    if (scale === 100) {
      current = (current || 1) * 100;
    } else {
      total += (current || 1) * scale;
      current = 0;
    }
  }
  return total + current;
}

/**
 * Every number a text mentions, in figures or words.
 *
 * @param text The text.
 * @returns The values.
 * Called from: buildClaimCorpus()
 */
function numbersIn(text: string): Set<number> {
  const values = new Set<number>();
  for (const match of text.matchAll(FIGURE)) {
    const value = figureValue(match[0]);
    if (value !== null) values.add(value);
  }
  for (const match of text.matchAll(NUMBER_WORDS)) values.add(wordsValue(match[0]));
  return values;
}

/** Everything an answer's claims are checked against. */
export interface ClaimCorpus {
  /** The text, normalised, for names and dates. */
  text: string;
  /** Every number it mentions. */
  numbers: ReadonlySet<number>;
}

/**
 * Prepares the source texts: the documents, the session's details and the call.
 *
 * @param sources The texts.
 * @returns The corpus.
 * Called from: useLiveAnswers.ts; scripts/eval-answers.ts; tests
 */
export function buildClaimCorpus(sources: readonly string[]): ClaimCorpus {
  const joined = sources.join('\n');
  return { text: ` ${normalise(joined)} `, numbers: numbersIn(joined) };
}

/**
 * The part of an answer a claim can be in: not the code (its numbers are code), not the complexity
 * notation "O(1)", and not the private note (not to be said).
 *
 * @param answer The answer text.
 * @returns The rest, with those parts blanked out.
 * Called from: checkClaims()
 */
function spokenPart(answer: string): string {
  return answer
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\bO\([^)]*\)/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*(?:[-*•]\s+)?(?:private\s+)?note\s*:/i.test(line.replace(/\*\*/g, '')))
    .join('\n');
}

/**
 * Finds the claims in an answer that its sources do not back up.
 *
 * @param answer The finished answer (for the call).
 * @param corpus What to check against (buildClaimCorpus()).
 * @returns The claims, each once, in the order they appear.
 * Called from: useLiveAnswers.ts; scripts/eval-answers.ts; tests
 */
export function checkClaims(answer: string, corpus: ClaimCorpus): Claim[] {
  const text = spokenPart(answer);
  const found: { at: number; claim: Claim }[] = [];
  /** Spans already taken: the "12" of "March 12" is the date's, not a number of its own. */
  const taken: [number, number][] = [];
  const overlaps = (start: number, end: number) =>
    taken.some(([from, to]) => start < to && from < end);
  const add = (at: number, words: string, kind: Claim['kind']) => {
    const trimmed = words.trim();
    const start = at + words.indexOf(trimmed);
    taken.push([start, start + trimmed.length]);
    found.push({ at: start, claim: { text: trimmed, kind } });
  };

  for (const match of text.matchAll(MONTH_DATE)) {
    const value = match[0];
    // "may" is usually the verb; a date needs a capital or a day or year next to it.
    if (/^may$/i.test(value)) continue;
    if (/^[a-z]/.test(value) && !/\d/.test(value)) continue;
    taken.push([match.index, match.index + value.length]);
    if (!corpus.text.includes(` ${normalise(value)} `)) add(match.index, value, 'date');
  }
  for (const match of text.matchAll(FIGURE)) {
    const value = match[0];
    if (overlaps(match.index, match.index + value.length)) continue;
    // A bare number that opens a list line ("1. Do this") is a mark, not a claim.
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    if (
      /^\s*$/.test(text.slice(lineStart, match.index)) &&
      /^\d+[.)]\s/.test(text.slice(match.index))
    ) {
      continue;
    }
    const number = figureValue(value);
    // Small bare numbers are ordinary speech ("appears once", "count is 1") unless they count
    // something or are money or a percentage.
    const counted = COUNTED_UNITS.test(text.slice(match.index + value.length));
    if (number !== null && number <= 10 && !/[$€£%]/.test(value) && !counted) continue;
    if (number !== null && !corpus.numbers.has(number)) add(match.index, value, 'number');
  }
  for (const match of text.matchAll(NUMBER_WORDS)) {
    const value = match[0];
    if (overlaps(match.index, match.index + value.length)) continue;
    const number = wordsValue(value);
    // Small numbers are ordinary speech ("one thing", "two options") unless they count something.
    const counted = COUNTED_UNITS.test(text.slice(match.index + value.length));
    if (number <= 10 && !counted) continue;
    if (!corpus.numbers.has(number)) add(match.index, value, 'number');
  }
  for (const match of text.matchAll(NAME)) {
    if (overlaps(match.index, match.index + match[0].length)) continue;
    const words = match[0].split(/\s+/);
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const before = text.slice(lineStart, match.index);
    // The first word of a sentence is capitalised anyway: it is a name only if it is known not to
    // be an ordinary word, which plain text cannot tell, so a lone one is left alone.
    const startsSentence = /^(?:\s*(?:[-*•]|\d+[.)])?\s*)$|[.!?:]["”)]?\s+$/.test(before);
    const kept = words.filter((word) => !NOT_NAMES.has(word.toLowerCase().replace(/[.'’]+$/, '')));
    if (kept.length === 0) continue;
    if (startsSentence && words.length === 1) continue;
    // Drop an ordinary opening word ("The Acme team" keeps "Acme").
    const name = startsSentence && kept[0] === words[0] && words.length > 1 ? words.slice(1) : kept;
    const phrase = name.filter((word) => !NOT_NAMES.has(word.toLowerCase())).join(' ');
    if (phrase === '' || !match[0].includes(phrase)) continue;
    if (!corpus.text.includes(` ${normalise(phrase)} `)) {
      add(match.index + match[0].indexOf(phrase), phrase, 'name');
    }
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.claim)
    .filter((claim) => {
      const key = claim.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** One piece of a line of text: plain, or a claim to underline. */
export interface ClaimSegment {
  /** The words. */
  text: string;
  /** True when these words are a claim to check. */
  claim: boolean;
}

/**
 * Splits a line of an answer at its claims, for underlining.
 *
 * @param line   The line as shown.
 * @param claims The claims' exact words.
 * @returns The pieces, in order; joined, they are the line.
 * Called from: src/features/answers/AnswerBody.tsx; tests
 */
export function claimSegments(line: string, claims: readonly string[]): ClaimSegment[] {
  if (claims.length === 0) return [{ text: line, claim: false }];
  const escaped = [...claims]
    // The longest first, so "$1,200" is found before "1,200".
    .sort((a, b) => b.length - a.length)
    .map((claim) => claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g');
  return line
    .split(pattern)
    .map((text, index) => ({ text, claim: index % 2 === 1 }))
    .filter((segment) => segment.text !== '');
}

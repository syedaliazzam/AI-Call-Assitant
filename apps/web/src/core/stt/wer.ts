/**
 * File: apps/web/src/core/stt/wer.ts
 * Purpose: Rough word error rate (WER) for the accuracy test: compares what was said (the
 *          reference sentence) with what the model heard, word by word. A word heard split in
 *          two or two words heard joined ("TO DAY" for "today", "NORTH WIND" for "Northwind") is
 *          counted as correct: the letters are right, only the spacing differs (Day 2 decision).
 *          Numbers written as digits ("$52", "9:30") are spelled out first, so models that write
 *          digits are not penalised against the spelled-out test sentences (Day 2 Stage 5).
 * Used by: src/features/dev/SttTest.tsx
 * Depends on: nothing (pure)
 * Architecture: ADR-0020 (accuracy check)
 */

/** One step of the word alignment. */
export type AlignmentStep =
  | {
      /** The word matches (also when it was heard split or joined). */
      type: 'ok';
      /** The word (or two words, space-separated, when they were heard joined). */
      ref: string;
      /** The same word as heard (two words, space-separated, when it was heard split). */
      hyp: string;
    }
  | {
      /** A different word was heard. */
      type: 'sub';
      /** The word that was said. */
      ref: string;
      /** The word that was heard instead. */
      hyp: string;
    }
  | {
      /** A word was missed. */
      type: 'del';
      /** The word that was said. */
      ref: string;
    }
  | {
      /** An extra word was heard. */
      type: 'ins';
      /** The extra word. */
      hyp: string;
    };

/** Result of wordErrorRate(). */
export interface WerResult {
  /** (substitutions + deletions + insertions) ÷ reference words; 0 is perfect. */
  wer: number;
  /** Words heard as a different word. */
  substitutions: number;
  /** Words missed. */
  deletions: number;
  /** Extra words heard. */
  insertions: number;
  /** Number of words in the reference. */
  referenceWords: number;
  /** Word-by-word alignment, in reading order. */
  alignment: AlignmentStep[];
}

/** Number words below twenty. */
const SMALL_NUMBERS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

/** Tens words (index = tens digit). */
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/**
 * Spells a whole number the way it is spoken ("one hundred and fifty", as in the test
 * sentences).
 *
 * @param n A whole number, 0 … 999,999,999.
 * @returns The words.
 * Called from: spellNumbers(); tests
 */
export function numberWords(n: number): string {
  if (n < 20) return SMALL_NUMBERS[n]!;
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${SMALL_NUMBERS[n % 10]}` : ''}`;
  if (n < 1000) {
    const rest = n % 100;
    return `${SMALL_NUMBERS[Math.floor(n / 100)]} hundred${rest ? ` and ${numberWords(rest)}` : ''}`;
  }
  for (const [size, name] of [
    [1_000_000, 'million'],
    [1_000, 'thousand'],
  ] as const) {
    if (n >= size) {
      const rest = n % size;
      const tail =
        rest === 0 ? '' : rest < 100 ? ` and ${numberWords(rest)}` : ` ${numberWords(rest)}`;
      return `${numberWords(Math.floor(n / size))} ${name}${tail}`;
    }
  }
  return String(n);
}

/**
 * Writes digits as spoken words, so a model that writes "$52" or "9:30" is compared
 * fairly with one that writes "fifty two dollars" or "nine thirty" (Zipformer, and the test
 * sentences). Handles times (9:30), money ($52, $1,500), percentages, decimals and whole numbers
 * with thousands separators; anything else is left as it is.
 *
 * @param text Any text.
 * @returns The text with those numbers spelled out.
 * Called from: normalizeWords(); tests
 */
export function spellNumbers(text: string): string {
  return text
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h: string, m: string) => {
      const minutes = Number(m);
      const tail =
        minutes === 0
          ? ''
          : minutes < 10
            ? ` oh ${numberWords(minutes)}`
            : ` ${numberWords(minutes)}`;
      return ` ${numberWords(Number(h))}${tail} `;
    })
    .replace(/\$\s?(\d[\d,]*)(?:\.(\d{2}))?/g, (_, whole: string, cents?: string) => {
      const dollars = Number(whole.replace(/,/g, ''));
      const centsPart =
        cents && Number(cents) > 0 ? ` and ${numberWords(Number(cents))} cents` : '';
      return ` ${numberWords(dollars)} ${dollars === 1 ? 'dollar' : 'dollars'}${centsPart} `;
    })
    .replace(/\b(\d+)\.(\d+)\b/g, (_, whole: string, fraction: string) => {
      const digits = fraction
        .split('')
        .map((digit) => SMALL_NUMBERS[Number(digit)])
        .join(' ');
      return ` ${numberWords(Number(whole))} point ${digits} `;
    })
    .replace(/\b\d{1,3}(?:,\d{3})+\b|\b\d+\b/g, (digits: string) => {
      const value = Number(digits.replace(/,/g, ''));
      return value < 1_000_000_000 ? ` ${numberWords(value)} ` : digits;
    })
    .replace(/%/g, ' percent ');
}

/**
 * Normalises text for comparison: numbers spelled out (spellNumbers), lower case, apostrophes
 * kept inside words, every other punctuation mark and hyphen turned into a space.
 *
 * @param text Any text.
 * @returns The words.
 * Called from: wordErrorRate(); echo.ts
 */
export function normalizeWords(text: string): string[] {
  return spellNumbers(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .replace(/(^|\s)'+|'+(?=\s|$)/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Computes the word error rate with a minimum-edit alignment (Levenshtein over words), plus
 * two free steps: one reference word = two heard words joined ("today" / "to day"), and two
 * reference words joined = one heard word ("north wind" / "northwind").
 *
 * @param reference  What was said.
 * @param hypothesis What the model produced.
 * @returns Counts, the rate and the alignment.
 * Called from: SttTest.tsx (accuracy panel)
 */
export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  // cost[i][j] = edits to turn the first i reference words into the first j heard words.
  const cost: number[][] = Array.from({ length: ref.length + 1 }, (_, i) =>
    Array.from({ length: hyp.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  /** Reference word i-1 was heard split as heard words j-2 and j-1. */
  const split = (i: number, j: number) =>
    i >= 1 && j >= 2 && ref[i - 1] === `${hyp[j - 2]}${hyp[j - 1]}`;
  /** Reference words i-2 and i-1 were heard joined as heard word j-1. */
  const joined = (i: number, j: number) =>
    i >= 2 && j >= 1 && `${ref[i - 2]}${ref[i - 1]}` === hyp[j - 1];
  for (let i = 1; i <= ref.length; i += 1) {
    for (let j = 1; j <= hyp.length; j += 1) {
      const same = ref[i - 1] === hyp[j - 1];
      let best = Math.min(
        cost[i - 1]![j - 1]! + (same ? 0 : 1),
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
      );
      if (split(i, j)) best = Math.min(best, cost[i - 1]![j - 2]!);
      if (joined(i, j)) best = Math.min(best, cost[i - 2]![j - 1]!);
      cost[i]![j] = best;
    }
  }

  // Walk back from the end to recover which edit was made at each step.
  const alignment: AlignmentStep[] = [];
  let i = ref.length;
  let j = hyp.length;
  while (i > 0 || j > 0) {
    if (split(i, j) && cost[i]![j] === cost[i - 1]![j - 2]) {
      alignment.push({ type: 'ok', ref: ref[i - 1]!, hyp: `${hyp[j - 2]} ${hyp[j - 1]}` });
      i -= 1;
      j -= 2;
    } else if (joined(i, j) && cost[i]![j] === cost[i - 2]![j - 1]) {
      alignment.push({ type: 'ok', ref: `${ref[i - 2]} ${ref[i - 1]}`, hyp: hyp[j - 1]! });
      i -= 2;
      j -= 1;
    } else if (
      i > 0 &&
      j > 0 &&
      cost[i]![j] === cost[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)
    ) {
      const type = ref[i - 1] === hyp[j - 1] ? 'ok' : 'sub';
      alignment.push({ type, ref: ref[i - 1]!, hyp: hyp[j - 1]! });
      i -= 1;
      j -= 1;
    } else if (i > 0 && cost[i]![j] === cost[i - 1]![j]! + 1) {
      alignment.push({ type: 'del', ref: ref[i - 1]! });
      i -= 1;
    } else {
      alignment.push({ type: 'ins', hyp: hyp[j - 1]! });
      j -= 1;
    }
  }
  alignment.reverse();

  const count = (type: AlignmentStep['type']) => alignment.filter((s) => s.type === type).length;
  const substitutions = count('sub');
  const deletions = count('del');
  const insertions = count('ins');
  return {
    wer: ref.length > 0 ? (substitutions + deletions + insertions) / ref.length : 0,
    substitutions,
    deletions,
    insertions,
    referenceWords: ref.length,
    alignment,
  };
}

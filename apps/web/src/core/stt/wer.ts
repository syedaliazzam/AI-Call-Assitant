/**
 * File: apps/web/src/core/stt/wer.ts
 * Purpose: Rough word error rate (WER) for the accuracy test: compares what was said (the
 *          reference sentence) with what the model heard, word by word. A word heard split in
 *          two or two words heard joined ("TO DAY" for "today", "NORTH WIND" for "Northwind") is
 *          counted as correct: the letters are right, only the spacing differs (Day 2 decision).
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

/**
 * Normalises text for comparison: lower case, apostrophes kept inside words, every other
 * punctuation mark and hyphen turned into a space.
 *
 * @param text Any text.
 * @returns The words.
 * Called from: wordErrorRate()
 */
export function normalizeWords(text: string): string[] {
  return text
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

/**
 * File: apps/web/src/core/punctuation/restore.ts
 * Purpose: Turns a line in the live engine's style ("WHAT DOES THE PLAN COST") into written text with
 *          marks and capitals, given a model that predicts them (v1.1.0, ADR-0044): reads the model's
 *          vocabulary, splits words into its tokens, cuts a long line into pieces the model takes, and
 *          writes its predictions back on the words. No word is ever added, dropped or changed: only
 *          marks and capitals.
 * Used by: src/core/punctuation/punct.worker.ts; tests
 * Depends on: nothing (pure)
 * Architecture: docs/decisions/ADR-0044-transcript-auto-punctuation-cleanup.md
 *
 * Transcript text is never logged.
 */

/** The longest token list the model takes, including the start and end tokens. */
export const MAX_TOKENS = 200;

/** The model's start and end tokens. */
const START_TOKEN = 1;
const END_TOKEN = 2;

/** The vocabulary's mark for "a word starts here". */
const WORD_START = '▁';

/** What a character the vocabulary lacks costs, so it is used only when nothing else fits. */
const UNKNOWN_COST = 100;

/** The marks the model predicts, by index: none, comma, full stop, question mark. */
const MARKS = ['', ',', '.', '?'] as const;

/** The model's vocabulary. */
export interface PieceTable {
  /** Each piece's id and score. */
  pieces: ReadonlyMap<string, { id: number; score: number }>;
  /** The longest piece's length, in characters. */
  longest: number;
}

/** What the model is given for one piece of a line. */
export interface ModelInput {
  /** The token ids, with the start and end tokens. */
  tokens: number[];
  /** 1 for the start token, the end token and each word's first token; otherwise 0. */
  valids: number[];
  /** How many entries of valids are 1. */
  labelLength: number;
}

/** What the model predicts for one piece of a line: one entry per word. */
export interface ModelOutput {
  /** Each word's mark: an index into MARKS. */
  puncts: readonly number[];
  /** Each word's capitals: 0 as it is, 1 all capitals, 2 first capital, 3 mixed (left as it is). */
  cases: readonly number[];
}

/**
 * Reads the vocabulary file: one "piece<TAB>score" per line, the line number being the id.
 *
 * @param text The file's text.
 * @returns The table.
 * Called from: punct.worker.ts; tests
 */
export function parseVocab(text: string): PieceTable {
  const pieces = new Map<string, { id: number; score: number }>();
  let longest = 0;
  text.split('\n').forEach((row, id) => {
    const [piece, score] = row.replace(/\r$/, '').split('\t');
    if (!piece) return;
    pieces.set(piece, { id, score: Number(score) });
    longest = Math.max(longest, piece.length);
  });
  return { pieces, longest };
}

/**
 * Splits a word into the vocabulary's tokens, keeping the split with the best total score (how the
 * model's own tokenizer, a unigram one, works).
 *
 * @param table The vocabulary.
 * @param word  A word in lower case.
 * @returns The token ids.
 * Called from: encodePieces(); tests
 */
export function encodeWord(table: PieceTable, word: string): number[] {
  const text = `${WORD_START}${word}`;
  const best: ({ score: number; id: number; from: number } | null)[] = [
    { score: 0, id: -1, from: -1 },
  ];
  for (let end = 1; end <= text.length; end += 1) {
    best[end] = null;
    for (let start = Math.max(0, end - table.longest); start < end; start += 1) {
      const before = best[start];
      const piece = table.pieces.get(text.slice(start, end));
      if (!before || !piece) continue;
      const score = before.score + piece.score;
      if (!best[end] || score > best[end]!.score) best[end] = { score, id: piece.id, from: start };
    }
    // A character the vocabulary lacks stands for the unknown token (id 0).
    if (!best[end]) {
      best[end] = { score: best[end - 1]!.score - UNKNOWN_COST, id: 0, from: end - 1 };
    }
  }
  const ids: number[] = [];
  for (let at = text.length; at > 0; at = best[at]!.from) ids.unshift(best[at]!.id);
  return ids;
}

/**
 * Prepares words for the model, cut into pieces it can take.
 *
 * @param table The vocabulary.
 * @param words The words, in lower case.
 * @returns The model's input for each piece, and how many words each piece has.
 * Called from: punctuateWith(); tests
 */
export function encodePieces(
  table: PieceTable,
  words: readonly string[],
): { input: ModelInput; words: number }[] {
  const pieces: { input: ModelInput; words: number }[] = [];
  let tokens = [START_TOKEN];
  let valids = [1];
  let count = 0;
  const flush = () => {
    tokens.push(END_TOKEN);
    valids.push(1);
    pieces.push({
      input: { tokens, valids, labelLength: valids.filter(Boolean).length },
      words: count,
    });
    tokens = [START_TOKEN];
    valids = [1];
    count = 0;
  };
  for (const word of words) {
    const ids = encodeWord(table, word).slice(0, MAX_TOKENS - 2);
    if (tokens.length + ids.length > MAX_TOKENS - 1) flush();
    tokens.push(...ids);
    valids.push(1, ...new Array<number>(ids.length - 1).fill(0));
    count += 1;
  }
  if (count > 0) flush();
  return pieces;
}

/**
 * Writes one word as the model predicted it.
 *
 * @param word  The word in lower case.
 * @param punct The predicted mark.
 * @param kind  The predicted capitals.
 * @returns The written word.
 * Called from: punctuateWith()
 */
function writeWord(word: string, punct: number | undefined, kind: number | undefined): string {
  const cased =
    kind === 1
      ? word.toUpperCase()
      : kind === 2
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word;
  return `${cased}${MARKS[punct ?? 0] ?? ''}`;
}

/**
 * Restores a line's marks and capitals.
 *
 * Marks already written in a word are kept out of what the model sees and put back by the model's
 * prediction, so the same line gives the same result however it was written. A comma at the very end is
 * dropped: the next line, or the end of the turn, decides what goes there (core/transcript/group.ts).
 *
 * @param text  The line.
 * @param table The vocabulary.
 * @param run   Runs the model on one piece.
 * @returns The written line, or the line as it was when it has no words to work on.
 * Called from: punct.worker.ts; tests
 */
export async function punctuateWith(
  text: string,
  table: PieceTable,
  run: (input: ModelInput) => Promise<ModelOutput>,
): Promise<string> {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[,.?!]+|[,.?!]+$/g, ''))
    .filter(Boolean);
  if (words.length === 0) return text;
  const written: string[] = [];
  let at = 0;
  for (const piece of encodePieces(table, words)) {
    const { puncts, cases } = await run(piece.input);
    for (let i = 0; i < piece.words; i += 1) {
      written.push(writeWord(words[at + i]!, puncts[i], cases[i]));
    }
    at += piece.words;
  }
  return written.join(' ').replace(/,$/, '');
}

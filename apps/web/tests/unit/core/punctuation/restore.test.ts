/**
 * Tests for apps/web/src/core/punctuation/restore.ts (v1.1.0, ADR-0044), with a small invented
 * vocabulary and a fake model: the vocabulary is read; a word is split the way with the best total
 * score; a character the vocabulary lacks becomes the unknown token; long lines are cut into pieces the
 * model takes; only marks and capitals change, never the words; a comma at the very end is dropped.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  encodePieces,
  encodeWord,
  MAX_TOKENS,
  parseVocab,
  punctuateWith,
  type ModelInput,
} from '@/core/punctuation/restore';

/** An invented vocabulary: ids 0 to 2 are special, as in the real file; Windows line ends. */
const VOCAB = [
  '<unk>\t0.0',
  '<s>\t0.0',
  '</s>\t0.0',
  '▁the\t-2.0',
  '▁plan\t-3.0',
  '▁pl\t-5.0',
  'an\t-4.0',
  '▁cost\t-3.5',
  's\t-2.5',
  '▁\t-6.0',
  'a\t-4.5',
].join('\r\n');

const table = parseVocab(VOCAB);

describe('parseVocab', () => {
  it('gives each piece its line number as its id, and finds the longest', () => {
    expect(table.pieces.get('<s>')).toEqual({ id: 1, score: 0 });
    expect(table.pieces.get('▁plan')).toEqual({ id: 4, score: -3 });
    expect(table.longest).toBe(5);
  });
});

describe('encodeWord', () => {
  it('keeps the split with the best total score', () => {
    // "▁plan" (-3) beats "▁pl" + "an" (-9).
    expect(encodeWord(table, 'plan')).toEqual([4]);
  });

  it('splits a word into pieces', () => {
    expect(encodeWord(table, 'costs')).toEqual([7, 8]);
  });

  it('uses the unknown token for a character it lacks', () => {
    expect(encodeWord(table, 'theé')).toEqual([3, 0]);
  });
});

describe('encodePieces', () => {
  it("adds the start and end tokens and marks each word's first token", () => {
    expect(encodePieces(table, ['the', 'costs'])).toEqual([
      {
        input: { tokens: [1, 3, 7, 8, 2], valids: [1, 1, 1, 0, 1], labelLength: 4 },
        words: 2,
      },
    ]);
  });

  it('cuts a long line so no piece is over the limit, and keeps every word', () => {
    const words = new Array<string>(500).fill('costs');
    const pieces = encodePieces(table, words);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.input.tokens.length).toBeLessThanOrEqual(MAX_TOKENS);
    expect(pieces.reduce((sum, piece) => sum + piece.words, 0)).toBe(500);
  });
});

describe('punctuateWith', () => {
  it('writes the marks and capitals the model predicts, on lower-cased words', async () => {
    const run = vi.fn(async () => ({ puncts: [0, 0, 3], cases: [2, 0, 1] }));
    await expect(punctuateWith('WHAT THE COST', table, run)).resolves.toBe('What the COST?');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('leaves mixed capitals as they are, and uses each mark', async () => {
    const run = async () => ({ puncts: [1, 2, 3], cases: [3, 0, 0] });
    await expect(punctuateWith('one two three', table, run)).resolves.toBe('one, two. three?');
  });

  it('takes out marks already written, so it never doubles them', async () => {
    const run = async () => ({ puncts: [2, 3], cases: [2, 2] });
    await expect(punctuateWith('Okay. Right?', table, run)).resolves.toBe('Okay. Right?');
  });

  it('drops a comma at the very end', async () => {
    const run = async () => ({ puncts: [0, 1], cases: [2, 0] });
    await expect(punctuateWith('forty seats', table, run)).resolves.toBe('Forty seats');
  });

  it('keeps the words in order across pieces', async () => {
    const words = Array.from({ length: 300 }, (_, i) => `w${i}`);
    const run = async ({ valids }: ModelInput) => {
      const count = valids.filter(Boolean).length - 2;
      return { puncts: new Array<number>(count).fill(0), cases: new Array<number>(count).fill(0) };
    };
    await expect(punctuateWith(words.join(' '), table, run)).resolves.toBe(words.join(' '));
  });

  it('gives back a line with no words as it is, without asking the model', async () => {
    const run = vi.fn();
    await expect(punctuateWith(' ... ', table, run)).resolves.toBe(' ... ');
    expect(run).not.toHaveBeenCalled();
  });
});

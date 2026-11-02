/**
 * Tests for apps/web/scripts/lib/stt-score.ts (Day 6 Stage 1), on invented text: the names list
 * is parsed; a term matches regardless of case, punctuation and spacing, as whole words only, and
 * with a possessive; terms split into names and technical terms; word error rates are weighted
 * by words; percentiles use the nearest rank.
 */
import { describe, expect, it } from 'vitest';
import {
  isTechTerm,
  overallWer,
  parseNamesList,
  percentile,
  scoreTerms,
  termFound,
} from '../../../scripts/lib/stt-score';

describe('parseNamesList', () => {
  it('skips comments and numbers the sentences', () => {
    const list = parseNamesList(
      '# a comment\n\nHello Kite. | Kite\nUse RAG and BM25. | RAG; BM25\n',
    );
    expect(list).toEqual([
      { index: 1, sentence: 'Hello Kite.', terms: ['Kite'] },
      { index: 2, sentence: 'Use RAG and BM25.', terms: ['RAG', 'BM25'] },
    ]);
  });
});

describe('termFound', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(termFound('Next.js', 'THE NEXT JS APP')).toBe(true);
    expect(termFound('LangChain', 'we use lang chain here')).toBe(true);
    expect(termFound('LangChain', 'We use LangChain, here.')).toBe(true);
    expect(termFound('BM25', 'with BM25 ranking')).toBe(true);
    expect(termFound('forward-deployed AI engineering', 'FORWARD DEPLOYED AI ENGINEERING')).toBe(
      true,
    );
  });

  it('needs the whole term as whole words, and allows a possessive', () => {
    expect(termFound('Kite', 'we fly kites')).toBe(false);
    expect(termFound('Zipformer', 'the zip former model')).toBe(true);
    expect(termFound('Zipformer', 'the zip farmer model')).toBe(false);
    expect(termFound('Fabrikam', "send it to Fabrikam's team")).toBe(true);
    expect(termFound('Paramount Intelligence', 'paramount intelligent')).toBe(false);
  });
});

describe('scoreTerms', () => {
  it('splits names and technical terms, and counts a missing clip as wrong', () => {
    expect(isTechTerm('rag')).toBe(true);
    expect(isTechTerm('Next JS')).toBe(true);
    expect(isTechTerm('Paramount Intelligence')).toBe(false);
    const scores = scoreTerms(
      [
        { index: 1, sentence: '', terms: ['Kite', 'RAG'] },
        { index: 2, sentence: '', terms: ['Python', 'Contoso'] },
      ],
      new Map([[1, 'KITE AND RAD']]),
    );
    expect(scores.all).toEqual({ right: 1, total: 4 });
    expect(scores.names).toEqual({ right: 1, total: 2 });
    expect(scores.tech).toEqual({ right: 0, total: 2 });
  });
});

describe('overallWer and percentile', () => {
  it('weights the word error rate by words', () => {
    const rate = overallWer([
      { reference: 'one two three four', hypothesis: 'one two three four' },
      { reference: 'five six', hypothesis: 'five seven' },
    ]);
    expect(rate).toBeCloseTo(1 / 6);
    expect(overallWer([])).toBe(0);
  });

  it('uses the nearest rank', () => {
    expect(percentile([3, 1, 2, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 50)).toBe(0);
  });
});

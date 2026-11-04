/**
 * Tests for apps/web/src/core/transcript/keyTermFix.ts (v1.1.0, item 22, ADR-0044): what the accurate
 * engine really wrote for invented names (measured on 4 Nov 2026) comes back as the term; words that only
 * look a little like a term are left alone, which matters more; marks stay; terms with digits and short
 * terms are never touched.
 */
import { describe, expect, it } from 'vitest';
import { correctTerms, editDistance, soundPattern } from '@/core/transcript/keyTermFix';

/** Invented key terms, as a user would write them. */
const TERMS = [
  'Priya Rao',
  'Harbor Lane Freight',
  'Kubernetes',
  'Bluefin Route',
  'Zainpak',
  'Northwind',
];

describe('soundPattern', () => {
  it('treats letters that sound alike as one, and any run of vowels as one', () => {
    expect(soundPattern('Kubernetes')).toBe(soundPattern('kubernetes'));
    expect(soundPattern('phone')).toBe(soundPattern('fone'));
    expect(soundPattern('Zane Pak')).toBe('sanapak');
    expect(soundPattern('Zainpak')).toBe('sanpak');
  });
});

describe('editDistance', () => {
  it('counts changes, and stops at the limit', () => {
    expect(editDistance('abc', 'abc', 2)).toBe(0);
    expect(editDistance('abc', 'abd', 2)).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBe(2);
    expect(editDistance('a', 'abcdef', 2)).toBe(3);
  });
});

describe('correctTerms', () => {
  it('puts back what the engine really misheard', () => {
    expect(
      correctTerms(
        "We spoke with Preyurao at Harbor Lane Freight about the Cabernet's rollout.",
        TERMS,
      ),
    ).toBe('We spoke with Priya Rao at Harbor Lane Freight about the Kubernetes rollout.');
    expect(correctTerms('We spoke with Pre-Urau yesterday.', TERMS)).toBe(
      'We spoke with Priya Rao yesterday.',
    );
    expect(correctTerms('Does Zane Pak use the Bluefin Rue tool?', TERMS)).toBe(
      'Does Zainpak use the Bluefin Route tool?',
    );
  });

  it('writes a term as the user wrote it', () => {
    expect(correctTerms('the northwind pilot', TERMS)).toBe('the Northwind pilot');
  });

  it('keeps the marks around a word', () => {
    expect(correctTerms("Ask about (Cabernet's), please.", TERMS)).toBe(
      'Ask about (Kubernetes), please.',
    );
  });

  it('leaves words that only look a little like a term', () => {
    const lines = [
      'It gets harder every week.',
      'The harbor is close to the route.',
      'North wins again.',
      'We prefer it this way.',
      'That is quite a kite.',
      'The cabinet is in the corner.',
    ];
    for (const line of lines) {
      expect(correctTerms(line, [...TERMS, 'Harbor', 'Kite'])).toBe(
        line.replace('harbor', 'Harbor').replace(/\bkite\b/, 'kite'),
      );
    }
  });

  it('never joins words across a sentence end', () => {
    expect(correctTerms('Ask Zane. Pak said no.', TERMS)).toBe('Ask Zane. Pak said no.');
  });

  it('leaves terms with digits to display.ts, and ignores short terms', () => {
    expect(correctTerms('We use the BM twenty five index.', ['BM25'])).toBe(
      'We use the BM twenty five index.',
    );
    expect(correctTerms('Go and quite so.', ['Go', 'Kite'])).toBe('Go and quite so.');
  });

  it('changes nothing with no terms', () => {
    expect(correctTerms('Any words  at all.', [])).toBe('Any words  at all.');
  });
});

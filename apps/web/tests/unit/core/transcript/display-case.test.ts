/**
 * Tests for sentenceCase() and displayTerms() in apps/web/src/core/transcript/display.ts (Day 6
 * Stage 4d), on invented lines: an all-capitals line becomes sentence case with a capital
 * first letter and "I"; the session's spellings are restored as whole words only; a line that
 * already has lower-case letters keeps its case; displayTerms() drops a typed " :score",
 * removes duplicates and puts the longest terms first.
 */
import { describe, expect, it } from 'vitest';
import { displayTerms, sentenceCase } from '@/core/transcript/display';

describe('sentenceCase', () => {
  it('writes an all-capitals line in sentence case, with "I" capitalised', () => {
    expect(sentenceCase('I THINK I CAN SEND IT')).toBe('I think I can send it');
    expect(sentenceCase("YES I'M SURE AND I'LL CALL")).toBe("Yes I'm sure and I'll call");
    expect(sentenceCase('WE USE IT DAILY')).toBe('We use it daily');
  });

  it("restores the session's spellings as whole words only", () => {
    const terms = displayTerms({
      company: 'Northwind Logistics',
      preferences: { keyTerms: 'Bluefin Route\nCRM :2\nRoute' },
    });
    expect(sentenceCase('THE BLUEFIN ROUTE PLAN AND OUR CRM', terms)).toBe(
      'The Bluefin Route plan and our CRM',
    );
    expect(sentenceCase('NORTHWIND LOGISTICS REROUTES TRUCKS', terms)).toBe(
      'Northwind Logistics reroutes trucks',
    );
    // A term with regular-expression characters is matched literally.
    expect(sentenceCase('WE USE C++ AND NODE.JS', ['C++', 'Node.js'])).toBe(
      'We use C++ and Node.js',
    );
  });

  it('keeps the case of a line that already has lower-case letters', () => {
    expect(sentenceCase('iPhone sales in Q3')).toBe('IPhone sales in Q3');
    expect(sentenceCase('Already Cased')).toBe('Already Cased');
    expect(sentenceCase('')).toBe('');
  });
});

describe('displayTerms', () => {
  it('drops scores and duplicates, longest first', () => {
    expect(
      displayTerms({ company: 'Acme', preferences: { keyTerms: 'Bluefin Route :2\nAcme\n\n42' } }),
    ).toEqual(['Bluefin Route', 'Acme']);
  });
});

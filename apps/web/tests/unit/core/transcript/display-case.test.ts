/**
 * Tests for sentenceCase() and displayTerms() in apps/web/src/core/transcript/display.ts (Day 6
 * Stage 4d), on invented lines: an all-capitals line becomes sentence case with a capital
 * first letter and "I"; the session's spellings are restored as whole words only; a line that
 * already has lower-case letters keeps its case; displayTerms() drops a typed " :score",
 * removes duplicates and puts the longest terms first; transcriptChips() cuts the latest words
 * into chips with stable ids.
 */
import { describe, expect, it } from 'vitest';
import { displayTerms, sentenceCase, transcriptChips } from '@/core/transcript/display';
import type { Utterance } from '@/core/transcript/transcript';

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

describe('transcriptChips (ADR-0029)', () => {
  /**
   * An invented line.
   *
   * @param id      Its id.
   * @param speaker Who said it.
   * @param text    The words.
   * @returns The line.
   */
  const line = (id: string, speaker: 'you' | 'them', text: string) =>
    ({ id, speaker, text, tStart: 1, tEnd: 2, final: true }) as Utterance;

  it('cuts the latest words into chips, newest last, keeping the spellings', () => {
    const chips = transcriptChips(
      [line('a', 'you', 'I AM HERE'), line('b', 'them', 'WHAT DOES THE BLUEFIN ROUTE PLAN COST')],
      ['Bluefin Route'],
      3,
    );
    expect(chips.map((chip) => chip.text)).toEqual(['What does the', 'Bluefin Route plan', 'cost']);
    expect(chips.every((chip) => chip.speaker === 'them')).toBe(true);
  });

  it('keeps chip ids stable as a line grows', () => {
    const before = transcriptChips([line('a', 'them', 'ONE TWO THREE')]);
    const after = transcriptChips([line('a', 'them', 'ONE TWO THREE FOUR')]);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after).toHaveLength(2);
  });
});

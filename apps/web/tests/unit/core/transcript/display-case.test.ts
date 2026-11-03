/**
 * Tests for sentenceCase() and displayTerms() in apps/web/src/core/transcript/display.ts (Day 6
 * Stage 4d), on invented lines: an all-capitals line becomes sentence case with a capital
 * first letter and "I"; the session's spellings are restored as whole words only; a line that
 * already has lower-case letters keeps its case, except for long all-capitals stretches left by the
 * live engine in a partly refined line (v1.0.2), while acronyms stay; continuationCase() carries a
 * sentence on without a capital; displayTerms() drops a typed " :score",
 * removes duplicates and puts the longest terms first; transcriptChips() cuts the latest words
 * into chips with stable ids.
 */
import { describe, expect, it } from 'vitest';
import {
  continuationCase,
  displayTerms,
  sentenceCase,
  transcriptChips,
} from '@/core/transcript/display';
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

  it('lowers the live engine capitals left in a partly refined line (v1.0.2)', () => {
    // The live engine's part first, then the accurate engine's cased rewrite.
    expect(sentenceCase('SO TELL ME ABOUT the project you built last year.')).toBe(
      'So tell me about the project you built last year.',
    );
    expect(sentenceCase('We shipped it in March. THEN WE MOVED TO KAFKA')).toBe(
      'We shipped it in March. Then we moved to kafka',
    );
    // "I" stays a capital inside a lowered stretch.
    expect(sentenceCase('Right. I THINK I CAN DO IT')).toBe('Right. I think I can do it');
    // A two-word shout with a long word counts.
    expect(sentenceCase('Okay THANK YOU for that.')).toBe('Okay thank you for that.');
  });

  it('keeps acronyms in a cased line (v1.0.2)', () => {
    expect(sentenceCase('We run it on AWS with an API gateway.')).toBe(
      'We run it on AWS with an API gateway.',
    );
    expect(sentenceCase('The AWS API is rate limited.')).toBe('The AWS API is rate limited.');
    expect(sentenceCase('We moved from SQL to NoSQL in Q3 2024.')).toBe(
      'We moved from SQL to NoSQL in Q3 2024.',
    );
  });
});

describe('continuationCase (v1.0.2)', () => {
  it('continues a sentence without a capital, keeping "I" and the session spellings', () => {
    expect(continuationCase('ABOUT YOUR PROJECT')).toBe('about your project');
    expect(continuationCase('AND I USED BLUEFIN ROUTE', ['Bluefin Route'])).toBe(
      'and I used Bluefin Route',
    );
    // A cased engine line keeps its own first letter.
    expect(continuationCase('How would you size it?')).toBe('How would you size it?');
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

describe('the answer card question (v1.0.1)', () => {
  it('shows a heard question in sentence case with the session spellings, as the transcript does', () => {
    const terms = displayTerms({
      company: 'Harbor Lane',
      preferences: { keyTerms: 'BM25, Retrieval' },
    });
    expect(sentenceCase('HOW DOES BM TWENTY FIVE RANK THE DOCUMENTS FOR HARBOR LANE', terms)).toBe(
      'How does BM25 rank the documents for Harbor Lane',
    );
  });

  it('leaves a typed question as the user wrote it', () => {
    expect(sentenceCase('What does BM25 do?')).toBe('What does BM25 do?');
  });

  it('reads comma-separated key terms (v1.0.1 key-term rule)', () => {
    expect(
      displayTerms({ company: 'Acme', preferences: { keyTerms: 'Terraform, Kubernetes' } }),
    ).toEqual(expect.arrayContaining(['Terraform', 'Kubernetes']));
  });
});

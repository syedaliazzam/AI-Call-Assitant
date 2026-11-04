/**
 * Tests for apps/web/src/core/transcript/display.ts:
 * a short line is shown as it is; a line over 20 s or over 35 words is split into equal parts
 * with ids <id>#n, the same speaker, all the words in order, and times spread across the line.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_LINE_WORDS,
  chipWords,
  displayTerms,
  sentenceCase,
  splitAtQuestions,
  splitForDisplay,
  transcriptChips,
} from '@/core/transcript/display';
import type { Utterance } from '@/core/transcript/transcript';

/**
 * A final "Them" line, for testing how long lines are split for display.
 *
 * @param words Number of words.
 * @param ms    How long the line lasted, in ms.
 * @returns The line.
 */
function line(words: number, ms: number): Utterance {
  return {
    id: 'u7',
    speaker: 'them',
    text: Array.from({ length: words }, (_, i) => `w${i}`).join(' '),
    tStart: 1_000,
    tEnd: 1_000 + ms,
    final: true,
  };
}

describe('splitForDisplay', () => {
  it('keeps a short line as it is', () => {
    const short = line(12, 5_000);
    expect(splitForDisplay(short)).toEqual([short]);
  });

  it('splits a line longer than 20 s, keeping every word in order', () => {
    const long = line(30, 45_000);
    const parts = splitForDisplay(long);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.id)).toEqual(['u7#0', 'u7#1', 'u7#2']);
    expect(parts.map((p) => p.text).join(' ')).toBe(long.text);
    expect(parts.every((p) => p.speaker === 'them' && p.final)).toBe(true);
    expect(parts[0]!.tStart).toBe(1_000);
    expect(parts.at(-1)!.tEnd).toBe(46_000);
    expect(parts[1]!.tStart).toBe(parts[0]!.tEnd);
  });

  it('splits a line with more than 35 words even when it is quick', () => {
    const wordy = line(MAX_LINE_WORDS + 5, 15_000);
    const parts = splitForDisplay(wordy);
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.text).join(' ')).toBe(wordy.text);
  });
});

describe('number terms in display (ADR-0027)', () => {
  it('maps a spoken number back to its typed spelling, longest pattern first', () => {
    const terms = displayTerms({
      company: 'Northwind',
      preferences: { keyTerms: 'BM25\nH100' },
    });
    // The recognizer wrote the spoken form; display shows the typed spelling.
    expect(sentenceCase('WE RANKED WITH BM TWENTY FIVE', terms)).toBe('We ranked with BM25');
    expect(sentenceCase('THE H ONE HUNDRED IS FAST', terms)).toBe('The H100 is fast');
  });

  it('leaves a line without a number term unchanged but for sentence case', () => {
    const terms = displayTerms({ company: 'Northwind', preferences: { keyTerms: 'BM25' } });
    expect(sentenceCase('WE MET THE TEAM', terms)).toBe('We met the team');
  });
});

describe('chips without hesitation sounds (v1.0.3, ADR-0039)', () => {
  it('drops um and uh from the live-words chips and capitalises a new first word', () => {
    expect(chipWords('Um what production grade applications have you uh built')).toEqual([
      'What',
      'production',
      'grade',
      'applications',
      'have',
      'you',
      'built',
    ]);
    expect(chipWords('Hmm, okay')).toEqual(['Okay']);
    expect(chipWords('Umbrella insurance')).toEqual(['Umbrella', 'insurance']);
  });

  it('transcriptChips never shows a filler', () => {
    const chips = transcriptChips([
      {
        id: 'l1',
        speaker: 'them',
        text: 'UM WHAT DO YOU UH BUILD',
        tStart: 0,
        tEnd: 1,
        final: true,
      },
    ]);
    expect(chips.map((chip) => chip.text).join(' ')).toBe('What do you build');
  });
});

describe('chipWords: lead-ins and filler phrases (v1.1.0)', () => {
  it('drops words that only lead in at the start, with a capital on what is left', () => {
    expect(chipWords('So, like, what does it cost')).toEqual(['What', 'does', 'it', 'cost']);
    expect(chipWords('Okay right tell me more')).toEqual(['Tell', 'me', 'more']);
  });

  it('keeps those words anywhere else', () => {
    expect(chipWords('What is it like')).toEqual(['What', 'is', 'it', 'like']);
  });

  it('keeps a line that is only a lead-in', () => {
    expect(chipWords('Okay')).toEqual(['Okay']);
  });

  it('drops filler phrases and more hesitation sounds', () => {
    expect(chipWords('It is, you know, kind of slow')).toEqual(['It', 'is,', 'slow']);
    expect(chipWords('Uh-huh ahh mhmm what now')).toEqual(['What', 'now']);
  });
});

describe('splitAtQuestions (v1.1.0, item 19)', () => {
  it('stands each question alone, and keeps statements together', () => {
    expect(
      splitAtQuestions(
        'Thanks for joining. We liked it. What did you do? And how long did it take?',
      ),
    ).toEqual([
      'Thanks for joining. We liked it.',
      'What did you do?',
      'And how long did it take?',
    ]);
  });

  it('keeps the statement after a question in its own part', () => {
    expect(splitAtQuestions('What did you do? We can come back to that.')).toEqual([
      'What did you do?',
      'We can come back to that.',
    ]);
  });

  it('leaves text with no marks, or one sentence, whole', () => {
    expect(splitAtQuestions('WHAT DOES THE PLAN COST FOR FORTY SEATS')).toEqual([
      'WHAT DOES THE PLAN COST FOR FORTY SEATS',
    ]);
    expect(splitAtQuestions('What does it cost?')).toEqual(['What does it cost?']);
  });

  it('does not split inside a number or an abbreviation', () => {
    expect(splitAtQuestions('It rose 2.5 percent, e.g. in May. Is that right?')).toEqual([
      'It rose 2.5 percent, e.g. in May.',
      'Is that right?',
    ]);
  });

  it('splits long statements at a sentence once they run over the limit', () => {
    const sentence = `${new Array(20).fill('word').join(' ')}.`;
    const capital = sentence.charAt(0).toUpperCase() + sentence.slice(1);
    expect(splitAtQuestions(`${capital} ${capital}`)).toEqual([capital, capital]);
  });
});

describe('sentenceCase on written text (v1.1.0)', () => {
  it('keeps what the punctuation pass wrote, and restores the session spellings', () => {
    expect(sentenceCase('We run kubernetes at northwind.', ['Kubernetes', 'Northwind'])).toBe(
      'We run Kubernetes at Northwind.',
    );
  });
});

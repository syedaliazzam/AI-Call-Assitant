/**
 * Tests apps/web/src/core/answer/claimCheck.ts: which numbers, prices, percentages, dates and names
 * in a finished answer are flagged as not found in the documents or the call, and how a line is
 * split for underlining. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import {
  buildClaimCorpus,
  checkClaims,
  claimSegments,
  needsClaimCheck,
} from '@/core/answer/claimCheck';

/**
 * The claims of an answer against some sources, as their words.
 *
 * @param answer  The answer.
 * @param sources The source texts.
 * @returns The flagged words.
 */
function flagged(answer: string, sources: string[]): string[] {
  return checkClaims(answer, buildClaimCorpus(sources)).map((claim) => claim.text);
}

describe('checkClaims', () => {
  it('flags a price that is in no source', () => {
    expect(flagged('It costs $1,200 a seat.', ['Professional is 52 dollars per seat.'])).toEqual([
      '$1,200',
    ]);
  });

  it('accepts the same number written another way', () => {
    expect(flagged('It costs $52 a seat.', ['52 dollars per seat'])).toEqual([]);
    expect(flagged('That is 2,080 a month.', ['two thousand and eighty a month'])).toEqual([]);
    expect(flagged('We had forty seats.', ['40 seats'])).toEqual([]);
    expect(flagged('Budget is $120k.', ['120,000 dollars'])).toEqual([]);
  });

  it('flags a percentage and a spelled-out number that counts something', () => {
    expect(flagged('It rose by 12% over three years.', ['It rose.'])).toEqual(['12%', 'three']);
  });

  it('leaves small ordinary numbers alone', () => {
    expect(flagged('There are two options. The count is 1.', ['Options.'])).toEqual([]);
  });

  it('flags a date with a month name that is in no source', () => {
    expect(flagged('We shipped on March 12.', ['We shipped.'])).toEqual(['March 12']);
    expect(flagged('We shipped on March 12.', ['Shipped March 12 this year.'])).toEqual([]);
  });

  it('flags a name mid-sentence, and accepts one the sources have', () => {
    expect(flagged('I worked with Acme Corp on that.', ['I worked on billing.'])).toEqual([
      'Acme Corp',
    ]);
    expect(flagged('I worked with Acme Corp on that.', ['Client: Acme Corp'])).toEqual([]);
  });

  it('does not flag common technical names or a sentence opener', () => {
    expect(flagged('Sure, I would use Python and Kafka here.', ['Nothing.'])).toEqual([]);
    expect(flagged('Great question.', ['Nothing.'])).toEqual([]);
  });

  it('ignores code, complexity notation and the private note', () => {
    const answer = [
      'I would use a dictionary.',
      '- Complexity: O(1) per lookup',
      '```python',
      'limit = 4096',
      '```',
      'Note: check the 99% figure with Acme Corp.',
    ].join('\n');
    expect(flagged(answer, ['Nothing.'])).toEqual([]);
  });

  it('lists each claim once, in order', () => {
    expect(flagged('$9 then $5 then $9 again.', ['Nothing.'])).toEqual(['$9', '$5']);
  });
});

describe('needsClaimCheck', () => {
  it('skips private answers, screenshots and case answers', () => {
    expect(needsClaimCheck({ type: 'sales', target: 'call' }, 'answer')).toBe(true);
    expect(needsClaimCheck(null, 'answer')).toBe(true);
    expect(needsClaimCheck({ type: 'concept', target: 'kite' }, 'chat')).toBe(false);
    expect(needsClaimCheck({ type: 'sales', target: 'call' }, 'screenshot')).toBe(false);
    expect(needsClaimCheck({ type: 'case', target: 'call' }, 'answer')).toBe(false);
  });
});

describe('claimSegments', () => {
  it('splits a line at its claims, and joined it is the line', () => {
    const segments = claimSegments('It costs $1,200 for 3 seats.', ['$1,200', '3']);
    expect(segments.map((segment) => segment.text).join('')).toBe('It costs $1,200 for 3 seats.');
    expect(segments.filter((segment) => segment.claim).map((segment) => segment.text)).toEqual([
      '$1,200',
      '3',
    ]);
  });

  it('treats marks in a claim as plain text', () => {
    expect(claimSegments('Pay $5.', ['$5'])[1]).toEqual({ text: '$5', claim: true });
  });

  it('returns the whole line when there are no claims', () => {
    expect(claimSegments('Fine.', [])).toEqual([{ text: 'Fine.', claim: false }]);
  });
});

describe('possessive and hyphen forms (v1.1.0, item 24)', () => {
  /**
   * The claims in an answer, by their words.
   *
   * @param answer  The answer.
   * @param sources What it is checked against.
   * @returns The claims' words.
   */
  const claimsIn = (answer: string, sources: string) =>
    checkClaims(answer, buildClaimCorpus([sources])).map((claim) => claim.text);

  it('finds a possessive in the plain name, either way round', () => {
    expect(
      claimsIn(
        'We talked about Northwind Logistics\u2019s routes.',
        'Northwind Logistics runs routes.',
      ),
    ).toEqual([]);
    expect(
      claimsIn("We talked about Northwind Logistics's routes.", 'Northwind Logistics runs routes.'),
    ).toEqual([]);
    expect(
      claimsIn('We talked about Northwind Logistics routes.', "Northwind Logistics's routes."),
    ).toEqual([]);
    expect(
      claimsIn('We asked the Harbor Clients\u2019 team.', 'Harbor Clients is a team.'),
    ).toEqual([]);
  });

  it('finds a hyphenated name in the spaced one, either way round', () => {
    expect(claimsIn('We used Bluefin-Route for it.', 'Bluefin Route is the tool.')).toEqual([]);
    expect(claimsIn('We used Bluefin Route for it.', 'Bluefin-Route is the tool.')).toEqual([]);
  });

  it('still flags a name that is really not there', () => {
    expect(claimsIn('We used Crimson Bridge for it.', 'Bluefin Route is the tool.')).toEqual([
      'Crimson Bridge',
    ]);
  });

  it('keeps a name with an apostrophe inside it', () => {
    expect(claimsIn("We met Dana O'Neil there.", "Dana O'Neil runs operations.")).toEqual([]);
  });
});

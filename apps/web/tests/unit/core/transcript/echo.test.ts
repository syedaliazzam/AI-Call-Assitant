/**
 * Tests for apps/web/src/core/transcript/echo.ts:
 * the developer's two speaker-leak examples (Day 2) are echoes; short genuine replies ("yes",
 * "exactly", "sounds good") are never echoes, even right after "Them" said the same words; a real
 * answer that reuses words of the question is not an echo; lcsLength() and echoScore() compute
 * the in-order overlap.
 */
import { describe, expect, it } from 'vitest';
import { ECHO_MIN_SCORE, echoScore, isEcho, lcsLength } from '@/core/transcript/echo';

/** The developer's examples: what "Them" said, and the "You" echo that followed. */
const EXAMPLES = [
  {
    them: 'NINETY SIX TIMES IT RECOMMENDED ONE OF THEIR TWO MOST POPULAR FLAVORS',
    you: "NINETY SIX TIMES YOU'D RECOMMENDED ONE OF YOUR TWO MOST POPULAR FLAVORS",
  },
  {
    them: 'NOW THIS MIGHT SOUND TRIVIAL AND NOT REALLY EXISTENTIAL AT ALL',
    you: 'AND THIS MIGHT SOUND TRIVIAL AND NOT REALLY EXISTENTIAL AT ALL',
  },
];

describe('isEcho', () => {
  it.each(EXAMPLES)('recognises the speaker leak "$you"', ({ them, you }) => {
    expect(isEcho(you, them)).toBe(true);
    expect(echoScore(you, them)).toBeGreaterThanOrEqual(ECHO_MIN_SCORE);
  });

  it('scores the examples 0.83 and 0.91', () => {
    expect(echoScore(EXAMPLES[0]!.you, EXAMPLES[0]!.them)).toBeCloseTo(10 / 12, 2);
    expect(echoScore(EXAMPLES[1]!.you, EXAMPLES[1]!.them)).toBeCloseTo(10 / 11, 2);
  });

  it('still finds the echo when "Them" said more around it', () => {
    const them = `SO HERE IS THE THING ${EXAMPLES[1]!.them} BUT IT IS`;
    expect(isEcho(EXAMPLES[1]!.you, them)).toBe(true);
  });

  it.each(['yes', 'exactly', 'sounds good', 'yes exactly right'])(
    'never hides a short genuine reply: "%s"',
    (reply) => {
      expect(isEcho(reply, `${reply} ${reply} that is what I meant`)).toBe(false);
    },
  );

  it('does not hide a real answer that reuses words of the question', () => {
    const them = 'WHAT DOES THE PROFESSIONAL PLAN COST PER SEAT';
    const you = 'THE PROFESSIONAL PLAN IS FIFTY TWO DOLLARS A MONTH FOR EACH SEAT';
    expect(echoScore(you, them)).toBeLessThan(ECHO_MIN_SCORE);
    expect(isEcho(you, them)).toBe(false);
  });

  it('does not hide anything when "Them" said nothing', () => {
    expect(isEcho(EXAMPLES[0]!.you, '')).toBe(false);
  });
});

describe('lcsLength', () => {
  it('counts the longest run of words in the same order (gaps allowed)', () => {
    expect(lcsLength(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd'])).toBe(3);
    expect(lcsLength(['a', 'b'], ['b', 'a'])).toBe(1);
    expect(lcsLength([], ['a'])).toBe(0);
  });
});

describe('three-word lines (v1.1.0, ADR-0044)', () => {
  it('are an echo only when said exactly, very close in time', () => {
    expect(isEcho('what about onboarding', 'said long before', 'what about onboarding')).toBe(true);
    expect(isEcho('WHAT ABOUT ONBOARDING', '', 'so what about onboarding then')).toBe(true);
    // The words in the wider window do not count for so short a line.
    expect(isEcho('what about onboarding', 'what about onboarding', 'something else')).toBe(false);
    expect(isEcho('what about pricing', '', 'what about onboarding')).toBe(false);
    expect(isEcho('about what onboarding', '', 'what about onboarding')).toBe(false);
  });

  it('leave shorter lines alone, however close', () => {
    expect(isEcho('sounds good', 'sounds good', 'sounds good')).toBe(false);
  });

  it('the wider rule still needs four words and 60%', () => {
    expect(isEcho('what about the onboarding', 'what about the onboarding')).toBe(true);
    expect(isEcho('we could look at onboarding next week', 'what about the onboarding')).toBe(
      false,
    );
  });
});

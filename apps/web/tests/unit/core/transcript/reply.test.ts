/**
 * Tests for apps/web/src/core/transcript/reply.ts and question.ts lastReplyIndex() (1.5.2, ADR-0070), with
 * the real call of 11 Nov 2026's times: a "You" line that began while the other person was still asking
 * (the speakers' echo 4 s into the churn question, the user reading an answer over the support question)
 * is not a reply; one that began after they stopped, or within the slack before their last word, is; a
 * press then still finds the question after the overlapping line.
 */
import { describe, expect, it } from 'vitest';
import { lastReplyIndex, selectQuestion } from '@/core/transcript/question';
import { REPLY_SLACK_MS, startedOverThem } from '@/core/transcript/reply';
import type { Utterance } from '@/core/transcript/transcript';

const T = 1_700_000_000_000;
const at = (seconds: number) => T + seconds * 1_000;

/**
 * A line.
 *
 * @param id      Its id.
 * @param speaker Who spoke.
 * @param text    Its words.
 * @param start   Start, s.
 * @param end     End, s.
 * @param final   False for a grey line.
 * @returns The line.
 */
const line = (
  id: string,
  speaker: 'you' | 'them',
  text: string,
  start: number,
  end: number,
  final = true,
): Utterance => ({ id, speaker, text, tStart: at(start), tEnd: at(end), final });

const CHURN =
  'CHURN ON OUR FOUR G CUSTOMERS IS A BIG PROBLEM HAVE YOU BUILT ANYTHING TO PREDICT IT';

describe('startedOverThem', () => {
  it('is true for the echo that began 4 s into the question (round 2, churn)', () => {
    const them = line('t', 'them', CHURN, 336.8, 343.5);
    const echo = line('e', 'you', 'HAVE YOU SHOWN', 340.7, 342.9);
    expect(startedOverThem(echo, [them, echo])).toBe(true);
  });

  it('is true over a grey line still being spoken', () => {
    const grey = line('g', 'them', CHURN, 336.8, 341, false);
    const reading = line('r', 'you', 'YES WE BUILT A MODEL', 338, 340);
    expect(startedOverThem(reading, [grey, reading])).toBe(true);
  });

  it('is false for a reply after they stopped, or within the slack before their last word', () => {
    const them = line('t', 'them', CHURN, 336.8, 343.5);
    expect(startedOverThem(line('a', 'you', 'YES WE DID', 343.8, 345), [them])).toBe(false);
    const early = line('b', 'you', 'YES WE DID', 343.5 - REPLY_SLACK_MS / 1_000 + 0.1, 345);
    expect(startedOverThem(early, [them])).toBe(false);
  });
});

describe('lastReplyIndex and selectQuestion', () => {
  it('passes over a line that began over the question, so a press still finds it', () => {
    const lines = [
      line('u55', 'you', 'WE DEALT WITH EXACTLY THIS ON A TELECOM CHATBOT PLATFORM', 323.7, 335.8),
      line('u58', 'them', CHURN, 336.8, 343.5),
      line('u57', 'you', 'HAVE YOU SHOWN', 340.7, 342.9),
    ];
    expect(lastReplyIndex(lines)).toBe(0);
    expect(selectQuestion(lines)?.lineIds).toEqual(['u58']);
  });
});

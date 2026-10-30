/**
 * Tests for apps/web/src/core/answer/unavailable.ts: unavailableReason() recognises only the
 * code 'claude_unavailable' (with each fixed message, and an unknown message as the usage
 * limit); answerFailureText() shows the usage-limit and overload messages exactly as given
 * (they say the transcript is still being recorded) and any other failure as "The answer
 * failed." with the server's reason; notesFailureText() names the usage limit or overload, and
 * mentions the session review only when the transcript is saved.
 */
import { CLAUDE_UNAVAILABLE_MESSAGES } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { answerFailureText, notesFailureText, unavailableReason } from '@/core/answer/unavailable';

describe('unavailableReason', () => {
  it('reads the reason from the code and the fixed message only', () => {
    expect(unavailableReason('claude_unavailable', CLAUDE_UNAVAILABLE_MESSAGES.usageLimit)).toBe(
      'usageLimit',
    );
    expect(unavailableReason('claude_unavailable', CLAUDE_UNAVAILABLE_MESSAGES.overloaded)).toBe(
      'overloaded',
    );
    expect(unavailableReason('claude_unavailable', 'something newer')).toBe('usageLimit');
    expect(unavailableReason('upstream_error', CLAUDE_UNAVAILABLE_MESSAGES.usageLimit)).toBeNull();
    expect(unavailableReason(undefined, undefined)).toBeNull();
  });
});

describe('answerFailureText', () => {
  it('shows the usage-limit message exactly, marked unavailable', () => {
    const shown = answerFailureText({
      code: 'claude_unavailable',
      message: CLAUDE_UNAVAILABLE_MESSAGES.usageLimit,
    });
    expect(shown).toEqual({
      text: "Answers are unavailable right now: the team's Claude usage limit has been reached. Your transcript is still being recorded.",
      unavailable: true,
    });
  });

  it('shows the overload message, also saying the transcript is still being recorded', () => {
    const shown = answerFailureText({
      code: 'claude_unavailable',
      message: CLAUDE_UNAVAILABLE_MESSAGES.overloaded,
    });
    expect(shown.unavailable).toBe(true);
    expect(shown.text).toContain('Claude is overloaded');
    expect(shown.text).toContain('Your transcript is still being recorded.');
  });

  it('keeps any other failure as this answer failing', () => {
    expect(
      answerFailureText({ code: 'timeout', message: 'Claude took too long to answer.' }),
    ).toEqual({ text: 'The answer failed. Claude took too long to answer.', unavailable: false });
  });
});

describe('notesFailureText', () => {
  it('names the usage limit or overload, and offers the review only with a saved transcript', () => {
    const limit = notesFailureText('usageLimit', true);
    expect(limit).toContain("the team's Claude usage limit has been reached");
    expect(limit).toContain('session review');
    expect(notesFailureText('overloaded', false)).toBe(
      'The call notes could not be written: Claude is overloaded.',
    );
    expect(notesFailureText(null, false)).toBe('The call notes could not be written.');
  });
});

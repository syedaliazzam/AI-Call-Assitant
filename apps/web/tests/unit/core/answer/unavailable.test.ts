/**
 * Tests for apps/web/src/core/answer/unavailable.ts: unavailableReason() recognises only the
 * code 'claude_unavailable' (with each fixed message, and an unknown message as the usage
 * limit); answerFailureText() shows the usage-limit and overload messages exactly as given
 * (they say the transcript is still being recorded), a 401 as "signed out" and a lost
 * connection as "offline" (Day 6 Stage 4e), and any other failure as "The answer
 * failed." with the server's reason; notesFailureText() names the usage limit or overload, and
 * mentions the session review only when the transcript is saved. v1.0.2 (ADR-0036): the daily
 * limit (code 'daily_limit') shows the server's message as it is, and in the notes status.
 */
import { CLAUDE_UNAVAILABLE_MESSAGES, dailyLimitMessage } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import {
  answerFailureText,
  DAILY_LIMIT_FALLBACK_TEXT,
  notesFailureText,
  OFFLINE_TEXT,
  REQUEST_PROBLEM_TEXT,
  SIGNED_OUT_TEXT,
  unavailableReason,
} from '@/core/answer/unavailable';

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

describe('answerFailureText: problems the user can act on (Day 6 Stage 4e)', () => {
  it('turns a 401 into "signed out", with the session kept', () => {
    expect(answerFailureText({ code: 'unauthorized', message: 'Sign in required' })).toEqual({
      text: SIGNED_OUT_TEXT,
      unavailable: false,
      problem: 'signed-out',
    });
    expect(SIGNED_OUT_TEXT).toContain('stay as they are');
  });

  it('turns a lost connection into "offline"', () => {
    for (const message of ['Network error', 'The connection closed before the end']) {
      expect(answerFailureText({ code: 'internal', message })).toEqual({
        text: OFFLINE_TEXT,
        unavailable: false,
        problem: 'offline',
      });
    }
    // Any other internal failure keeps the generic text.
    expect(
      answerFailureText({ code: 'internal', message: 'Malformed reply from server' }).problem,
    ).toBeUndefined();
  });
});

describe('answerFailureText: never an internal reason (v1.0.1)', () => {
  it('turns a rejected request into plain words, not the validation path', () => {
    const shown = answerFailureText({
      code: 'bad_request',
      message: 'session.keyTerms.0: Too big: expected string to have <=200 characters',
    });
    expect(shown.text).toBe(REQUEST_PROBLEM_TEXT);
    expect(shown.text).not.toMatch(/session\.|keyTerms|Too big/);
    expect(shown.unavailable).toBe(false);
  });

  it('does not show a bare HTTP status either', () => {
    expect(answerFailureText({ code: 'internal', message: 'Request failed (HTTP 500)' }).text).toBe(
      REQUEST_PROBLEM_TEXT,
    );
  });
});

describe('daily limit (v1.0.2, ADR-0036)', () => {
  it('shows the server message for daily_limit as it is, as a notice', () => {
    const message = dailyLimitMessage(300);
    expect(unavailableReason('daily_limit', message)).toBe('dailyLimit');
    expect(answerFailureText({ code: 'daily_limit', message })).toEqual({
      text: message,
      unavailable: true,
    });
    expect(answerFailureText({ code: 'daily_limit', message: '' }).text).toBe(
      DAILY_LIMIT_FALLBACK_TEXT,
    );
  });

  it('says so in the notes status', () => {
    expect(notesFailureText('dailyLimit', false)).toMatch(/today's limit of answers/);
  });
});

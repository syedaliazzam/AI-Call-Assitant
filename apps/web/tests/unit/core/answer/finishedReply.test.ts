/**
 * Tests finishedReplyAction() in apps/web/src/core/answer/finishedReply.ts (ADR-0112): a finished live
 * reply with answer text is shown; one with no text, or one the server stopped on a copied template, is
 * asked again once; a retry that is still empty or templated gives up (card removed, notice shown).
 * The server side of the same flow is in tests/unit/server/answer-meta-template.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { finishedReplyAction } from '@/core/answer/finishedReply';

describe('finishedReplyAction', () => {
  it('shows a reply with answer text', () => {
    expect(finishedReplyAction('We support SSO on every plan.', {}, false)).toBe('show');
    expect(finishedReplyAction('We support SSO on every plan.', {}, true)).toBe('show');
  });

  it('asks again once for a templated first line (stopped by the server, so no text)', () => {
    expect(finishedReplyAction('', { templated: true }, false)).toBe('retry');
  });

  it('asks again once for an empty reply', () => {
    expect(finishedReplyAction('', {}, false)).toBe('retry');
    expect(finishedReplyAction(' \n\t', {}, false)).toBe('retry');
  });

  it('gives up when the retry is still empty or templated', () => {
    expect(finishedReplyAction('', {}, true)).toBe('give-up');
    expect(finishedReplyAction('', { templated: true }, true)).toBe('give-up');
  });

  it('never shows a reply flagged as templated, even if text came with it', () => {
    expect(finishedReplyAction('stray', { templated: true }, false)).toBe('retry');
  });
});

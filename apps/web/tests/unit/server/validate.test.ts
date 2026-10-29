/**
 * Tests for apps/web/src/server/validate.ts, parseAnswerRequest():
 * accepts a hello request, a warm request and a full answer request; rejects unknown modes and
 * fields, a warm request without a session, and more than 100 key terms; enforces the
 * 150k-character document total; and reports field paths without echoing submitted values.
 */
import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_CHARS, MAX_KEY_TERMS, parseAnswerRequest } from '@/server/validate';

/** A complete, valid session block. */
const SESSION = {
  type: 'sales',
  company: 'Acme',
  role: 'Account review',
  instructions: 'Be brief.',
  keyTerms: ['Bluefin Route'],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [{ name: 'pricing.pdf', text: 'Price list' }],
};

describe('parseAnswerRequest', () => {
  it('accepts the Day 1 hello request', () => {
    expect(parseAnswerRequest({ mode: 'hello' })).toEqual({ ok: true, data: { mode: 'hello' } });
  });

  it('accepts a full answer request', () => {
    const result = parseAnswerRequest({
      mode: 'answer',
      model: 'fast',
      session: SESSION,
      transcript: [{ speaker: 'them', text: 'What is the timeline?', t: 1729750000 }],
      question: 'What is the timeline?',
      image: null,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a warm request with a session', () => {
    expect(parseAnswerRequest({ mode: 'warm', model: 'fast', session: SESSION }).ok).toBe(true);
  });

  it('rejects a warm request without a session, naming the field', () => {
    expect(parseAnswerRequest({ mode: 'warm' })).toEqual({
      ok: false,
      message: 'session: required for mode warm',
    });
  });

  it('rejects a session without key terms, and more than the key-term limit', () => {
    const { keyTerms: _omitted, ...withoutKeyTerms } = SESSION;
    expect(parseAnswerRequest({ mode: 'warm', session: withoutKeyTerms })).toMatchObject({
      ok: false,
      message: expect.stringContaining('session.keyTerms'),
    });
    const tooMany = Array.from({ length: MAX_KEY_TERMS + 1 }, (_, i) => `Term ${i}`);
    expect(
      parseAnswerRequest({ mode: 'warm', session: { ...SESSION, keyTerms: tooMany } }).ok,
    ).toBe(false);
  });

  it('rejects an unknown mode', () => {
    const result = parseAnswerRequest({ mode: 'poem' });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('mode') });
  });

  it('rejects unknown fields', () => {
    expect(parseAnswerRequest({ mode: 'hello', extra: true }).ok).toBe(false);
  });

  it('rejects a body that is not an object', () => {
    expect(parseAnswerRequest('hello').ok).toBe(false);
    expect(parseAnswerRequest(null).ok).toBe(false);
  });

  it('rejects documents above the total character limit', () => {
    const half = 'x'.repeat(MAX_DOCUMENT_CHARS / 2 + 1);
    const result = parseAnswerRequest({
      mode: 'warm',
      session: {
        ...SESSION,
        documents: [
          { name: 'a.txt', text: half },
          { name: 'b.txt', text: half },
        ],
      },
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('documents') });
  });

  it('rejects an image that is not an image data URL', () => {
    expect(parseAnswerRequest({ mode: 'screenshot', image: 'https://example.com/a.png' }).ok).toBe(
      false,
    );
  });

  it('does not echo submitted text in the error message', () => {
    const result = parseAnswerRequest({ mode: 'hello', question: 'q'.repeat(3000) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain('qqqq');
  });
});

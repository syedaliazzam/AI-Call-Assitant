/**
 * Tests for apps/web/src/core/documents/limits.ts: the caps are 500k characters per session and
 * 250k per document; above 280k the wizard warns, with one more line for Sonnet (documentWarnings(),
 * ADR-0067); roomLeft() never goes below
 * 0; fitsInSession() accepts a document that fits (up to exactly the cap), refuses one over the
 * per-document cap ('document-too-long') and one that would overfill the session
 * ('session-full'), with messages that give the numbers.
 */
import { MAX_SESSION_DOCUMENT_CHARS } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import {
  DEEP_MODEL_WARNING,
  documentWarnings,
  fitsInSession,
  LARGE_SESSION_CHARS,
  LARGE_SESSION_WARNING,
  MAX_DOCUMENT_CHARS,
  MAX_SESSION_CHARS,
  roomLeft,
} from '@/core/documents/limits';

describe('the caps (ADR-0067)', () => {
  it('are 500k per session and 250k per document, the same session cap as the server', () => {
    expect(MAX_SESSION_CHARS).toBe(500_000);
    expect(MAX_DOCUMENT_CHARS).toBe(250_000);
    expect(MAX_SESSION_CHARS).toBe(MAX_SESSION_DOCUMENT_CHARS);
  });

  it('warns above 280k with the agreed words', () => {
    expect(LARGE_SESSION_CHARS).toBe(280_000);
    expect(LARGE_SESSION_WARNING).toBe(
      "Above about 280k characters, each answer costs about 5× more and the first answer is slower. Remove documents you don't need.",
    );
    expect(DEEP_MODEL_WARNING).toBe(
      'Large documents with the deeper model are expensive. Haiku is recommended.',
    );
  });
});

describe('documentWarnings', () => {
  it('says nothing at or under 280k, whatever the model', () => {
    expect(documentWarnings(0, 'fast')).toEqual([]);
    expect(documentWarnings(LARGE_SESSION_CHARS, 'fast')).toEqual([]);
    expect(documentWarnings(LARGE_SESSION_CHARS, 'smart')).toEqual([]);
  });

  it('warns above 280k, and adds the deeper-model line only for Sonnet', () => {
    expect(documentWarnings(LARGE_SESSION_CHARS + 1, 'fast')).toEqual([LARGE_SESSION_WARNING]);
    expect(documentWarnings(LARGE_SESSION_CHARS + 1, 'smart')).toEqual([
      LARGE_SESSION_WARNING,
      DEEP_MODEL_WARNING,
    ]);
  });
});

describe('roomLeft', () => {
  it('is the session cap minus what is used, never below 0', () => {
    expect(roomLeft(0)).toBe(MAX_SESSION_CHARS);
    expect(roomLeft(490_000)).toBe(10_000);
    expect(roomLeft(MAX_SESSION_CHARS + 5)).toBe(0);
  });
});

describe('fitsInSession', () => {
  it('accepts a document that fits, up to exactly the remaining room', () => {
    expect(fitsInSession(1_000, 0)).toEqual({ ok: true });
    expect(fitsInSession(MAX_DOCUMENT_CHARS, 0)).toEqual({ ok: true });
    expect(fitsInSession(50_000, MAX_SESSION_CHARS - 50_000)).toEqual({ ok: true });
  });

  it('refuses one document over the per-document cap', () => {
    const result = fitsInSession(MAX_DOCUMENT_CHARS + 1, 0);
    expect(result).toMatchObject({ ok: false, reason: 'document-too-long' });
    expect(!result.ok && result.message).toContain('250,000');
  });

  it('refuses a document that would overfill the session, saying how much room is left', () => {
    const result = fitsInSession(20_000, 490_000);
    expect(result).toMatchObject({ ok: false, reason: 'session-full' });
    expect(!result.ok && result.message).toContain('10,000');
    expect(!result.ok && result.message).toContain('500,000');
  });
});

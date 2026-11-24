/**
 * Tests for apps/web/src/core/documents/limits.ts: the file cap is 10 MB (ADR-0117); the text caps
 * are 500k characters per session and per document, the same as the server's; the wizard warns only
 * above 500k, with the agreed words, and not at all under it (documentWarnings(), overSessionLimit(),
 * ADR-0117, which removed ADR-0067's 280k cost warning and its Sonnet line); the file and text gates
 * are independent; roomLeft() never goes below 0; fitsInSession() accepts a document that fits (up to
 * exactly the cap), refuses one over the per-document cap ('document-too-long') and one that would
 * overfill the session ('session-full'), with messages that give the numbers.
 */
import { MAX_SESSION_DOCUMENT_CHARS } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import * as limits from '@/core/documents/limits';
import {
  documentWarnings,
  fitsInSession,
  MAX_DOCUMENT_CHARS,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  MAX_SESSION_CHARS,
  OVER_LIMIT_WARNING,
  overSessionLimit,
  roomLeft,
} from '@/core/documents/limits';

describe('the caps (ADR-0067, ADR-0117)', () => {
  it('are 500k per session and (1.5.1, ADR-0069) 500k for one document, the same cap as the server', () => {
    expect(MAX_SESSION_CHARS).toBe(500_000);
    expect(MAX_DOCUMENT_CHARS).toBe(500_000);
    expect(MAX_SESSION_CHARS).toBe(MAX_SESSION_DOCUMENT_CHARS);
  });

  it('reads files up to 10 MB (ADR-0117; was 20 MB)', () => {
    expect(MAX_FILE_MB).toBe(10);
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('warns above 500k with the agreed words', () => {
    expect(OVER_LIMIT_WARNING).toBe(
      'Documents exceed the 500,000-character limit — remove some to continue',
    );
  });

  it('no longer has the 280k cost warning or the Sonnet line (ADR-0117)', () => {
    expect(limits).not.toHaveProperty('LARGE_SESSION_CHARS');
    expect(limits).not.toHaveProperty('LARGE_SESSION_WARNING');
    expect(limits).not.toHaveProperty('DEEP_MODEL_WARNING');
  });
});

describe('documentWarnings and overSessionLimit', () => {
  it('say nothing at or under 500k, including at the old 280k line', () => {
    for (const chars of [0, 280_001, 499_999, MAX_SESSION_CHARS]) {
      expect(documentWarnings(chars)).toEqual([]);
      expect(overSessionLimit(chars)).toBe(false);
    }
  });

  it('warn above 500k', () => {
    expect(documentWarnings(MAX_SESSION_CHARS + 1)).toEqual([OVER_LIMIT_WARNING]);
    expect(overSessionLimit(MAX_SESSION_CHARS + 1)).toBe(true);
  });
});

describe('the two gates are independent (ADR-0117)', () => {
  it('lets a full 10 MB file through when its text is under 500k, with no warning', () => {
    // Gate 1 (bytes) is tested in extract.test.ts; here, the text such a file gave.
    const textOfTenMbFile = 120_000;
    expect(fitsInSession(textOfTenMbFile, 0)).toEqual({ ok: true });
    expect(documentWarnings(textOfTenMbFile)).toEqual([]);
  });

  it('refuses a small file whose text is over 500k, whatever its size in bytes', () => {
    expect(fitsInSession(MAX_SESSION_CHARS + 1, 0)).toMatchObject({ ok: false });
    expect(documentWarnings(MAX_SESSION_CHARS + 1)).toEqual([OVER_LIMIT_WARNING]);
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
    expect(!result.ok && result.message).toContain('500,000');
  });

  it('refuses a document that would overfill the session, saying how much room is left', () => {
    const result = fitsInSession(20_000, 490_000);
    expect(result).toMatchObject({ ok: false, reason: 'session-full' });
    expect(!result.ok && result.message).toContain('10,000');
    expect(!result.ok && result.message).toContain('500,000');
  });
});

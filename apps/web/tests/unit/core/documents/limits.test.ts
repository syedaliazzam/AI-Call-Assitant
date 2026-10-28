/**
 * Tests for apps/web/src/core/documents/limits.ts: roomLeft() never goes below 0;
 * fitsInSession() accepts a document that fits (up to exactly the cap), refuses one over the
 * per-document cap ('document-too-long') and one that would overfill the session
 * ('session-full'), with messages that give the numbers.
 */
import { describe, expect, it } from 'vitest';
import {
  fitsInSession,
  MAX_DOCUMENT_CHARS,
  MAX_SESSION_CHARS,
  roomLeft,
} from '@/core/documents/limits';

describe('roomLeft', () => {
  it('is the session cap minus what is used, never below 0', () => {
    expect(roomLeft(0)).toBe(MAX_SESSION_CHARS);
    expect(roomLeft(140_000)).toBe(10_000);
    expect(roomLeft(MAX_SESSION_CHARS + 5)).toBe(0);
  });
});

describe('fitsInSession', () => {
  it('accepts a document that fits, up to exactly the remaining room', () => {
    expect(fitsInSession(1_000, 0)).toEqual({ ok: true });
    expect(fitsInSession(50_000, MAX_SESSION_CHARS - 50_000)).toEqual({ ok: true });
  });

  it('refuses one document over the per-document cap', () => {
    const result = fitsInSession(MAX_DOCUMENT_CHARS + 1, 0);
    expect(result).toMatchObject({ ok: false, reason: 'document-too-long' });
    expect(!result.ok && result.message).toContain('100,000');
  });

  it('refuses a document that would overfill the session, saying how much room is left', () => {
    const result = fitsInSession(20_000, 140_000);
    expect(result).toMatchObject({ ok: false, reason: 'session-full' });
    expect(!result.ok && result.message).toContain('10,000');
  });
});

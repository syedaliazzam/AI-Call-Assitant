/**
 * Tests for apps/web/src/core/sync/size.ts: jsonBytes() counts UTF-8 bytes of the JSON text exactly
 * as the server's Buffer.byteLength() does, including text outside ASCII (where string length
 * under-counts), and a 250k-character document (the largest, ADR-0067) stays under the record
 * limit even in a 3-byte script.
 */
import { SYNC_LIMITS } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { jsonBytes } from '@/core/sync/size';

describe('jsonBytes', () => {
  it('matches Buffer.byteLength of the JSON text', () => {
    for (const value of [{ text: 'plain' }, { text: 'café' }, { text: '日本語' }, { text: '😀' }]) {
      expect(jsonBytes(value)).toBe(Buffer.byteLength(JSON.stringify(value)));
    }
  });

  it('counts more than the string length outside ASCII', () => {
    const record = { text: '日'.repeat(1_000) };
    expect(jsonBytes(record)).toBeGreaterThan(JSON.stringify(record).length);
  });

  it('keeps the largest document under the record limit, even at 3 bytes a character', () => {
    const record = { id: 'd1', sessionId: 's1', name: 'a.txt', text: '日'.repeat(250_000) };
    expect(jsonBytes(record)).toBeLessThan(SYNC_LIMITS.recordBytes);
  });
});

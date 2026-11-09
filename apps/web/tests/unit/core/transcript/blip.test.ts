/**
 * Tests for apps/web/src/core/transcript/blip.ts (v1.4, ADR-0062): a blip is two words or
 * fewer, a run of listening words, or noise, and a real reply is not. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { isBlip } from '@/core/transcript/blip';

describe('isBlip', () => {
  it('is true for listening sounds, two words or fewer, and noise', () => {
    for (const text of [
      'UM',
      'OKAY',
      'Mm-hm.',
      'YEAH RIGHT',
      'OKAY YEAH I SEE',
      'Got it, okay.',
      '',
      'BLUE BLUE BLUE BLUE',
    ]) {
      expect(isBlip(text)).toBe(true);
    }
  });

  it('is false for a real reply', () => {
    for (const text of [
      'WE USED CONTRACT TESTS',
      'Yes, I led that migration.',
      'SO THE TEAM IS TWELVE',
    ]) {
      expect(isBlip(text)).toBe(false);
    }
  });
});

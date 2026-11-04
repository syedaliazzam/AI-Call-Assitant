/**
 * Tests for apps/web/src/core/session/callLength.ts (v1.1.0, ADR-0041): a call's length as the home
 * panel's card writes it, and nothing for a length that is missing or makes no sense.
 */
import { describe, expect, it } from 'vitest';
import { callLength } from '@/core/session/callLength';

describe('callLength', () => {
  it('writes seconds, minutes and seconds, or hours and minutes', () => {
    expect(callLength(6_000)).toBe('6s');
    expect(callLength(147_000)).toBe('2m 27s');
    expect(callLength(3_840_000)).toBe('1h 4m');
  });

  it('shows at least one second, and rounds to the nearest', () => {
    expect(callLength(200)).toBe('1s');
    expect(callLength(59_600)).toBe('1m 0s');
  });

  it('gives nothing for a missing, zero or broken length', () => {
    expect(callLength(undefined)).toBeNull();
    expect(callLength(0)).toBeNull();
    expect(callLength(-5)).toBeNull();
    expect(callLength(Number.NaN)).toBeNull();
  });
});

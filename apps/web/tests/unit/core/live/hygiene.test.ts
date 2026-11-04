/**
 * Tests for apps/web/src/core/live/hygiene.ts (v1.1.0, ADR-0044, item 21): after 10 minutes with nothing
 * from the other person and no answers, ask; after 30, pause.
 */
import { describe, expect, it } from 'vitest';
import { HYGIENE_ASK_MS, HYGIENE_PAUSE_MS, hygieneState } from '@/core/live/hygiene';

describe('hygieneState', () => {
  it('uses the limits of the brief', () => {
    expect(HYGIENE_ASK_MS).toBe(600_000);
    expect(HYGIENE_PAUSE_MS).toBe(1_800_000);
  });

  it('is ok, then asks, then pauses, each at its limit', () => {
    const start = 5_000;
    expect(hygieneState(start, start)).toBe('ok');
    expect(hygieneState(start, start + HYGIENE_ASK_MS - 1)).toBe('ok');
    expect(hygieneState(start, start + HYGIENE_ASK_MS)).toBe('ask');
    expect(hygieneState(start, start + HYGIENE_PAUSE_MS - 1)).toBe('ask');
    expect(hygieneState(start, start + HYGIENE_PAUSE_MS)).toBe('paused');
  });
});

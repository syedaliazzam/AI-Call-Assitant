/**
 * Tests for apps/web/src/core/transcript/autoScroll.ts (v1.1.0, ADR-0041): the transcript follows its
 * newest line only while the reader is at the bottom.
 */
import { describe, expect, it } from 'vitest';
import { atBottom, BOTTOM_SLACK_PX } from '@/core/transcript/autoScroll';

describe('atBottom', () => {
  it('is true at the bottom and within the slack, and when everything fits', () => {
    expect(atBottom(600, 400, 1000)).toBe(true);
    expect(atBottom(600 - BOTTOM_SLACK_PX, 400, 1000)).toBe(true);
    expect(atBottom(0, 400, 300)).toBe(true);
  });

  it('is false once the reader has scrolled up further than the slack', () => {
    expect(atBottom(600 - BOTTOM_SLACK_PX - 1, 400, 1000)).toBe(false);
    expect(atBottom(0, 400, 1000)).toBe(false);
  });
});

/**
 * Tests for apps/web/src/core/transcript/complete.ts (v1.4, ADR-0062): a line sounds cut off when it ends
 * on a joining word, an article, a question word, a hesitation or an open mark, while normal endings of
 * questions ("you", "that", "more", "do", "on") do not count. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { looksUnfinished } from '@/core/transcript/complete';

describe('looksUnfinished', () => {
  it('is true for a line cut off in the middle', () => {
    for (const text of [
      'COULD YOU WALK ME THROUGH THE SYSTEM AND',
      'TELL ME ABOUT THE',
      'AND WHAT YOU WOULD CHANGE ABOUT',
      'So the main thing is,',
      'HOW WOULD',
      'WHAT DOES THE PLAN COST UM',
    ]) {
      expect(looksUnfinished(text)).toBe(true);
    }
  });

  it('is false for finished questions, including ones ending on common last words', () => {
    for (const text of [
      'WHAT MOTIVATES YOU',
      'CAN YOU EXPLAIN THAT',
      'TELL ME MORE',
      'WHAT WOULD YOU DO',
      'WHAT ARE YOU WORKING ON',
      'How big is the team?',
      'WHY DO YOU WANT TO LEAVE YOUR CURRENT COMPANY',
      '',
    ]) {
      expect(looksUnfinished(text)).toBe(false);
    }
  });
});

/**
 * Tests for parseGhosts() in apps/web/src/features/live/overlay/SnapZones.tsx (v1.1.0, ADR-0041): the
 * ghosts are read from the address the shell writes, and anything unreadable draws nothing.
 */
import { describe, expect, it } from 'vitest';
import { parseGhosts } from '@/features/live/overlay/SnapZones';

describe('parseGhosts', () => {
  it('reads each ghost', () => {
    expect(parseGhosts('top-left,24,24,680,320;top-center,620,24,680,320')).toEqual([
      { preset: 'top-left', x: 24, y: 24, width: 680, height: 320 },
      { preset: 'top-center', x: 620, y: 24, width: 680, height: 320 },
    ]);
  });

  it('draws nothing for nothing', () => {
    expect(parseGhosts(null)).toEqual([]);
    expect(parseGhosts('')).toEqual([]);
  });

  it('leaves out what it cannot read', () => {
    expect(parseGhosts('top-left,1,2,3;top-right,a,b,c,d;,1,2,3,4;top-center,1,2,3,4')).toEqual([
      { preset: 'top-center', x: 1, y: 2, width: 3, height: 4 },
    ]);
  });
});

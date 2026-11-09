/**
 * Tests for apps/desktop/src/positions.ts (v1.3.0, ADR-0056): the six positions on a work area, 16 DIPs
 * from its edges, with the taskbar on any side (the work area starts or ends short), on a second monitor
 * (left of, right of or above the primary), at display scales that give fractional DIPs, and with a
 * window larger than the area; the nearest position to a window; and the jump shortcuts (no wrap).
 */
import { describe, expect, it } from 'vitest';
import {
  isOverlayJump,
  jumpPosition,
  nearestPosition,
  POSITION_MARGIN,
  positionPlace,
} from '../../src/positions';

/** The overlay's size in these tests. */
const W = 900;
const H = 136;

/** Every position, top row then bottom row. */
const ALL = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

/**
 * Every position's place on an area.
 *
 * @param area The work area.
 * @returns The places, by position.
 */
function places(area: { x: number; y: number; width: number; height: number }) {
  return Object.fromEntries(ALL.map((preset) => [preset, positionPlace(preset, area, W, H)]));
}

describe('positionPlace', () => {
  it('puts the six positions 16 DIPs from the edges of a 1920 × 1040 work area (taskbar at the bottom)', () => {
    expect(POSITION_MARGIN).toBe(16);
    expect(places({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({
      'top-left': { x: 16, y: 16 },
      'top-center': { x: 510, y: 16 },
      'top-right': { x: 1004, y: 16 },
      'bottom-left': { x: 16, y: 888 },
      'bottom-center': { x: 510, y: 888 },
      'bottom-right': { x: 1004, y: 888 },
    });
  });

  it('keeps clear of a taskbar at the top, on the left or on the right', () => {
    // Top: the work area starts 40 down.
    const top = places({ x: 0, y: 40, width: 1920, height: 1040 });
    expect(top['top-left']).toEqual({ x: 16, y: 56 });
    expect(top['bottom-right']).toEqual({ x: 1004, y: 40 + 1040 - H - 16 });
    // Left: the work area starts 48 across.
    const left = places({ x: 48, y: 0, width: 1872, height: 1080 });
    expect(left['top-left']).toEqual({ x: 64, y: 16 });
    expect(left['bottom-center']).toEqual({ x: 48 + (1872 - W) / 2, y: 1080 - H - 16 });
    // Right: the work area ends 48 short.
    const right = places({ x: 0, y: 0, width: 1872, height: 1080 });
    expect(right['top-right']).toEqual({ x: 1872 - W - 16, y: 16 });
  });

  it('works on a second monitor to the right, to the left (negative x) and above (negative y)', () => {
    expect(places({ x: 1920, y: 0, width: 2560, height: 1400 })['bottom-right']).toEqual({
      x: 1920 + 2560 - W - 16,
      y: 1400 - H - 16,
    });
    expect(places({ x: -1280, y: 0, width: 1280, height: 984 })['top-left']).toEqual({
      x: -1264,
      y: 16,
    });
    expect(places({ x: 0, y: -1080, width: 1920, height: 1040 })['bottom-center']).toEqual({
      x: 510,
      y: -1080 + 1040 - H - 16,
    });
  });

  it('gives whole DIPs at display scales with fractional work areas (125 %, 150 %, 175 %)', () => {
    for (const area of [
      { x: 0, y: 0, width: 1536, height: 816.8 },
      { x: 1536, y: 0, width: 1706.6667, height: 932.6667 },
      { x: 0, y: 0, width: 1097.1429, height: 594.2857 },
    ]) {
      for (const place of Object.values(places(area))) {
        expect(Number.isInteger(place.x)).toBe(true);
        expect(Number.isInteger(place.y)).toBe(true);
        // Inside the area.
        expect(place.x).toBeGreaterThanOrEqual(Math.floor(area.x));
        expect(place.x + W).toBeLessThanOrEqual(Math.ceil(area.x + area.width));
      }
    }
  });

  it('keeps a window larger than the area inside it, from its edge', () => {
    const small = { x: 100, y: 50, width: 800, height: 120 };
    expect(positionPlace('top-right', small, W, H)).toEqual({ x: 100, y: 50 });
    expect(positionPlace('bottom-left', small, W, H)).toEqual({ x: 100, y: 50 });
    // Only a little room: the margin shrinks before the window leaves the area.
    expect(positionPlace('top-left', { x: 0, y: 0, width: 910, height: 140 }, W, H)).toEqual({
      x: 10,
      y: 4,
    });
  });
});

describe('nearestPosition', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };

  it('finds the position a window is at, or nearest to', () => {
    for (const preset of ALL) {
      expect(
        nearestPosition({ ...positionPlace(preset, area, W, H), width: W, height: H }, area),
      ).toBe(preset);
    }
    expect(nearestPosition({ x: 700, y: 600, width: W, height: H }, area)).toBe('bottom-center');
    expect(nearestPosition({ x: 1100, y: 200, width: W, height: H }, area)).toBe('top-right');
  });

  it('works on a second monitor', () => {
    const second = { x: 1920, y: 0, width: 1280, height: 984 };
    expect(nearestPosition({ x: 3000, y: 900, width: 200, height: 48 }, second)).toBe(
      'bottom-right',
    );
  });
});

describe('jumpPosition', () => {
  it('moves one spot within the row and stops at the edges (no wrap)', () => {
    expect(jumpPosition('top-center', 'overlay-spot-left')).toBe('top-left');
    expect(jumpPosition('top-left', 'overlay-spot-left')).toBe('top-left');
    expect(jumpPosition('top-center', 'overlay-spot-right')).toBe('top-right');
    expect(jumpPosition('top-right', 'overlay-spot-right')).toBe('top-right');
    expect(jumpPosition('bottom-left', 'overlay-spot-right')).toBe('bottom-center');
    expect(jumpPosition('bottom-right', 'overlay-spot-right')).toBe('bottom-right');
  });

  it('goes to the top or bottom row in the same column', () => {
    expect(jumpPosition('top-left', 'overlay-row-bottom')).toBe('bottom-left');
    expect(jumpPosition('top-center', 'overlay-row-bottom')).toBe('bottom-center');
    expect(jumpPosition('bottom-right', 'overlay-row-top')).toBe('top-right');
    expect(jumpPosition('top-right', 'overlay-row-top')).toBe('top-right');
    expect(jumpPosition('bottom-center', 'overlay-row-bottom')).toBe('bottom-center');
  });

  it('knows the jump shortcuts from the nudges', () => {
    expect(isOverlayJump('overlay-spot-left')).toBe(true);
    expect(isOverlayJump('overlay-row-bottom')).toBe(true);
    expect(isOverlayJump('overlay-left')).toBe(false);
    expect(isOverlayJump('overlay-toggle')).toBe(false);
  });
});

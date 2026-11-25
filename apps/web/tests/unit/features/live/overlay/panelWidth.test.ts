/**
 * Tests for apps/web/src/features/live/overlay/panelWidth.ts (ADR-0113): the column of each of the six
 * positions (and centred with none), the alignment class and the grip's side for each column, the panels'
 * width after a sideways drag of the corner grip (the grip's edge follows the pointer: the right edge on a
 * left position, the left edge on a right position, both edges centred; never under the button strip, never
 * wider than the bars), the share stored from it, and the CSS width of a share. ADR-0115: the default share
 * before any drag (62 % for the answer alone, the bars' whole width beside the transcript); a stored share wins.
 */
import { describe, expect, it } from 'vitest';
import { OVERLAY_PRESETS } from '@kite/shared';
import { OVERLAY_PANELS_WIDTH } from '@/core/storage/overlayPrefs';
import {
  columnAlignClass,
  gripSide,
  overlayColumn,
  panelsColumn,
  panelsShare,
  panelsWidthStyle,
  widthAfterDrag,
  widthShareAfterDrag,
} from '@/features/live/overlay/panelWidth';

describe('panelWidth', () => {
  it('gives every position its column, and centres with no position', () => {
    const columns = Object.fromEntries(
      OVERLAY_PRESETS.map((preset) => [preset, overlayColumn(preset)]),
    );
    expect(columns).toEqual({
      'top-center': 'center',
      'top-left': 'start',
      'top-right': 'end',
      'bottom-center': 'center',
      'bottom-left': 'start',
      'bottom-right': 'end',
    });
    expect(overlayColumn(null)).toBe('center');
    expect(overlayColumn(undefined)).toBe('center');
  });

  it('lines pieces up on the column edge, and puts the grip on the side that moves', () => {
    expect(columnAlignClass('start')).toBe('items-start');
    expect(columnAlignClass('center')).toBe('items-center');
    expect(columnAlignClass('end')).toBe('items-end');
    expect(gripSide('start')).toBe('right');
    expect(gripSide('center')).toBe('right');
    expect(gripSide('end')).toBe('left');
  });

  it('moves the grip edge with the pointer for each column', () => {
    const base = { startWidth: 600, min: 260, max: 830 };
    // Left position: the right edge follows; right position: the left edge (moving left widens).
    expect(widthAfterDrag({ ...base, dx: -100, column: 'start' })).toBe(500);
    expect(widthAfterDrag({ ...base, dx: 100, column: 'start' })).toBe(700);
    expect(widthAfterDrag({ ...base, dx: -100, column: 'end' })).toBe(700);
    expect(widthAfterDrag({ ...base, dx: 100, column: 'end' })).toBe(500);
    // Centred: both edges move, so the width changes by twice the distance.
    expect(widthAfterDrag({ ...base, dx: -100, column: 'center' })).toBe(400);
    expect(widthAfterDrag({ ...base, dx: 50, column: 'center' })).toBe(700);
  });

  it('never goes under the button strip or past the bars', () => {
    const base = { startWidth: 600, min: 260, max: 830, column: 'start' as const };
    expect(widthAfterDrag({ ...base, dx: -1000 })).toBe(260);
    expect(widthAfterDrag({ ...base, dx: 1000 })).toBe(830);
    // A window narrower than the strip: the bars' width wins (the answer is never wider than the bar).
    expect(widthAfterDrag({ ...base, min: 900, dx: 0 })).toBe(830);
  });

  it('stores the width as a share of the bars, inside its limits', () => {
    const base = { startWidth: 800, min: 260, max: 800, column: 'start' as const };
    expect(widthShareAfterDrag({ ...base, dx: -400 })).toBe(0.5);
    expect(widthShareAfterDrag({ ...base, dx: 400 })).toBe(1);
    // A tiny strip and a long drag: the share's own floor.
    expect(widthShareAfterDrag({ ...base, min: 10, dx: -2000 })).toBe(OVERLAY_PANELS_WIDTH.min);
    expect(widthShareAfterDrag({ ...base, max: 0, dx: -100 })).toBeNull();
  });

  it('defaults the answer alone to a reading column, and keeps a dragged width (ADR-0115)', () => {
    // Never dragged: the answer alone is 62 % of the bars; beside the transcript the block keeps the bars'
    // whole width (the split already narrows the answer, and a narrower block would stack the two).
    expect(panelsShare(null, false)).toBe(0.62);
    expect(panelsWidthStyle(panelsShare(null, false))).toBe('62%');
    expect(panelsShare(null, true)).toBe(OVERLAY_PANELS_WIDTH.max);
    // The user's own width wins in both layouts, kept inside the limits.
    expect(panelsShare(0.8, false)).toBe(0.8);
    expect(panelsShare(0.8, true)).toBe(0.8);
    expect(panelsShare(1.4, false)).toBe(OVERLAY_PANELS_WIDTH.max);
    expect(panelsShare(0.05, true)).toBe(OVERLAY_PANELS_WIDTH.min);
  });

  it('writes a share as a percentage of the bars, clamped', () => {
    expect(panelsWidthStyle(1)).toBe('100%');
    expect(panelsWidthStyle(0.5)).toBe('50%');
    expect(panelsWidthStyle(0.3165)).toBe('31.7%');
    expect(panelsWidthStyle(2)).toBe('100%');
    expect(panelsWidthStyle(0)).toBe(`${OVERLAY_PANELS_WIDTH.min * 100}%`);
  });
});

describe('panelsColumn (ADR-0124)', () => {
  it('centres the answer alone on every position, and lines the pair up by the position', () => {
    for (const column of ['start', 'center', 'end'] as const) {
      expect(panelsColumn(column, false)).toBe('center');
      expect(panelsColumn(column, true)).toBe(column);
    }
  });
});

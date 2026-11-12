/**
 * Tests for apps/web/src/features/live/overlay/BarTooltip.tsx placeTip() and parts.tsx tipShortcut()
 * (1.6.3, ADR-0075): the tooltip goes below bar 1 on the top row and above it on the bottom row, takes the
 * other side when that does not fit, sits beside its control when neither does (the collapsed bar), and
 * is always whole inside the window; shortcuts read "Ctrl+Shift+Enter" (symbols on macOS).
 */
import { describe, expect, it } from 'vitest';
import { placeTip, type TipBox } from '@/features/live/overlay/BarTooltip';
import { tipShortcut } from '@/features/live/overlay/parts';

/** A 980 × 480 window. */
const WIN: TipBox = { left: 0, top: 0, width: 980, height: 480 };

/** A tooltip's size. */
const TIP = { width: 140, height: 24 };

/**
 * Whether a tooltip at a place is whole inside a window.
 *
 * @param place Its top-left corner.
 * @param win   The window.
 * @returns True when inside.
 */
const inside = (place: { left: number; top: number }, win: TipBox) =>
  place.left >= win.left &&
  place.top >= win.top &&
  place.left + TIP.width <= win.left + win.width &&
  place.top + TIP.height <= win.top + win.height;

describe('placeTip', () => {
  it('goes below bar 1 on the top row, centred on its control', () => {
    const bar = { left: 0, top: 0, width: 980, height: 44 };
    const control = { left: 200, top: 6, width: 80, height: 32 };
    const place = placeTip(control, bar, TIP, WIN, false);
    expect(place).toEqual({ left: 170, top: 50, side: 'below' });
  });

  it('goes above bar 1 on the bottom row', () => {
    const bar = { left: 0, top: 436, width: 980, height: 44 };
    const control = { left: 200, top: 442, width: 80, height: 32 };
    const place = placeTip(control, bar, TIP, WIN, true);
    expect(place).toEqual({ left: 170, top: 406, side: 'above' });
  });

  it('shifts sideways to stay inside the window at both edges', () => {
    const bar = { left: 0, top: 0, width: 980, height: 44 };
    const left = placeTip({ left: 4, top: 6, width: 20, height: 32 }, bar, TIP, WIN, false);
    const right = placeTip({ left: 940, top: 6, width: 36, height: 32 }, bar, TIP, WIN, false);
    expect(left.left).toBe(4);
    expect(right.left).toBe(980 - 4 - TIP.width);
  });

  it('takes the other side when its own has no room', () => {
    // A bottom-row window only as tall as bar 1 and bar 2, with bar 1 at the top of what is left.
    const short: TipBox = { left: 0, top: 0, width: 980, height: 120 };
    const bar = { left: 0, top: 0, width: 980, height: 44 };
    const place = placeTip({ left: 200, top: 6, width: 80, height: 32 }, bar, TIP, short, true);
    expect(place.side).toBe('below');
    expect(inside(place, short)).toBe(true);
  });

  it('sits beside its control in the collapsed bar, whole inside the window', () => {
    const collapsed: TipBox = { left: 0, top: 0, width: 980, height: 56 };
    const bar = { left: 0, top: 6, width: 980, height: 44 };
    for (const controlLeft of [10, 480, 930]) {
      const control = { left: controlLeft, top: 12, width: 40, height: 32 };
      for (const up of [false, true]) {
        const place = placeTip(control, bar, TIP, collapsed, up);
        expect(place.side).toBe('beside');
        expect(inside(place, collapsed), `${controlLeft} ${up}`).toBe(true);
        // Never over its own control.
        const overlaps =
          place.left < control.left + control.width && place.left + TIP.width > control.left;
        expect(overlaps, `${controlLeft} ${up}`).toBe(false);
      }
    }
  });
});

describe('tipShortcut', () => {
  it('names shortcuts in words on Windows and with symbols on macOS', () => {
    expect(tipShortcut('CommandOrControl+Enter', false)).toBe('Ctrl+Enter');
    expect(tipShortcut('CommandOrControl+Shift+Space', false)).toBe('Ctrl+Shift+Space');
    expect(tipShortcut('CommandOrControl+Alt+R', false)).toBe('Ctrl+Alt+R');
    expect(tipShortcut('CommandOrControl+Enter', true)).toBe('⌘ ↵');
  });
});

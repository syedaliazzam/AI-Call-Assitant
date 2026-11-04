/**
 * Tests for apps/web/src/ui/popupPosition.ts: a popup takes its preferred side when it fits, otherwise
 * the side with more room; it stays inside the window; and it reports the height left before it must
 * scroll, so a long list inside a modal is never cut off.
 */
import { describe, expect, it } from 'vitest';
import { placePopup, POPUP_MARGIN } from '@/ui/popupPosition';

/** A window to place popups in. */
const VIEWPORT = { width: 1000, height: 800 };

/** An anchor in the middle of the window. */
const ANCHOR = { left: 400, top: 300, width: 200, height: 40 };

describe('placePopup', () => {
  it('goes under the anchor, left edges together', () => {
    const where = placePopup(ANCHOR, { width: 200, height: 100 }, VIEWPORT, 'bottom-start', 6);
    expect(where).toEqual({ left: 400, top: 346, maxHeight: 446 });
  });

  it('lines up right edges for bottom-end', () => {
    const where = placePopup(ANCHOR, { width: 300, height: 100 }, VIEWPORT, 'bottom-end', 6);
    expect(where.left).toBe(300);
  });

  it('lines up right edges over the anchor for top-end', () => {
    const where = placePopup(ANCHOR, { width: 300, height: 100 }, VIEWPORT, 'top-end', 6);
    expect(where).toMatchObject({ left: 300, top: 194 });
  });

  it('centres a tooltip over the anchor', () => {
    const where = placePopup(ANCHOR, { width: 100, height: 30 }, VIEWPORT, 'top-center', 6);
    expect(where.left).toBe(450);
    expect(where.top).toBe(264);
  });

  it('flips over the anchor when there is no room under it', () => {
    const low = { ...ANCHOR, top: 700 };
    const where = placePopup(low, { width: 200, height: 200 }, VIEWPORT, 'bottom-start', 6);
    expect(where.top).toBe(494);
    expect(where.maxHeight).toBe(686);
  });

  it('stays under when neither side fits but under has more room, and limits its height', () => {
    const high = { ...ANCHOR, top: 100 };
    const where = placePopup(high, { width: 200, height: 2000 }, VIEWPORT, 'bottom-start', 6);
    expect(where.top).toBe(146);
    expect(where.maxHeight).toBe(800 - 140 - 6 - POPUP_MARGIN);
  });

  it('slides along to stay inside the window', () => {
    const right = { ...ANCHOR, left: 950 };
    const where = placePopup(right, { width: 200, height: 100 }, VIEWPORT, 'bottom-start', 6);
    expect(where.left).toBe(1000 - 200 - POPUP_MARGIN);
    const left = { ...ANCHOR, left: 0, width: 50 };
    expect(placePopup(left, { width: 200, height: 100 }, VIEWPORT, 'bottom-end', 6).left).toBe(
      POPUP_MARGIN,
    );
  });

  it('a sub-menu sits to the right, and stays in the window', () => {
    const where = placePopup(ANCHOR, { width: 150, height: 100 }, VIEWPORT, 'right-start', 6);
    expect(where.left).toBe(606);
    expect(where.top).toBe(300);
    const low = placePopup(
      { ...ANCHOR, top: 780 },
      { width: 150, height: 100 },
      VIEWPORT,
      'right-start',
      6,
    );
    expect(low.top).toBe(800 - 100 - POPUP_MARGIN);
  });
});

/**
 * Tests for apps/web/src/core/storage/overlayPrefs.ts (ADR-0029, ADR-0039), with a fake
 * localStorage: calls start in the overlay unless turned off; the panel opacity falls back to the
 * 82% default when unset or out of range; an old stored value (the window-opacity key, default 1)
 * is migrated once to the panel key, 1 becoming the default; fading away from the pointer is off by default
 * and never makes the panel more solid than the chosen value (the v1.0.2 bug: solid under the
 * pointer); blocked storage leaves the defaults. ADR-0085: the transcript panel is open by default (once
 * on a device that stored a choice before), then follows the user's own choice; the answer panel is never
 * remembered; the side-by-side split defaults to a third (34 %; 40 % before 27 Nov 2026) and stays within its limits. ADR-0113: the panels' own
 * width defaults to the bars' whole width (a share of 1) and stays within its limits.
 * ADR-0119 amended (27 Nov 2026): the window growth for the pair (remembered until undone) and the split's
 * default of about a third.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FADE_AWAY_FACTOR,
  getOverlayFade,
  getOverlayOpacity,
  getOverlayPanels,
  getOverlayPanelsWidth,
  getOverlaySplit,
  getPairGrowth,
  OVERLAY_PAIR_GROWTH_KEY,
  setPairGrowth,
  OVERLAY_PANELS_DEFAULT_KEY,
  OVERLAY_PANELS_WIDTH,
  OVERLAY_PANELS_WIDTH_KEY,
  setOverlayPanelsWidth,
  OVERLAY_PANELS_KEY,
  OVERLAY_SPLIT,
  OVERLAY_SPLIT_KEY,
  PANELS_DEFAULT_VERSION,
  setOverlayPanels,
  setOverlaySplit,
  getStartInOverlay,
  OVERLAY_FADE_KEY,
  OVERLAY_OPACITY,
  OVERLAY_OPACITY_KEY,
  OVERLAY_PANEL_ALPHA_KEY,
  paintedOpacity,
  setOverlayFadePref,
  setOverlayOpacityPref,
  setStartInOverlay,
} from '@/core/storage/overlayPrefs';

/** The fake storage's contents. */
let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('overlayPrefs', () => {
  it('starts calls in the overlay unless turned off', () => {
    expect(getStartInOverlay()).toBe(true);
    setStartInOverlay(false);
    expect(getStartInOverlay()).toBe(false);
    setStartInOverlay(true);
    expect(getStartInOverlay()).toBe(true);
  });

  it('keeps the panel opacity in range, 82% by default', () => {
    expect(getOverlayOpacity()).toBe(0.82);
    setOverlayOpacityPref(0.6);
    expect(getOverlayOpacity()).toBe(0.6);
    setOverlayOpacityPref(0.1);
    expect(getOverlayOpacity()).toBe(OVERLAY_OPACITY.min);
    stored.set(OVERLAY_PANEL_ALPHA_KEY, 'loud');
    expect(getOverlayOpacity()).toBe(OVERLAY_OPACITY.default);
  });

  it('migrates the old stored value once: 1 (the old default) becomes the default, a choice is kept', () => {
    stored.set(OVERLAY_OPACITY_KEY, '1');
    expect(getOverlayOpacity()).toBe(0.82);
    expect(stored.has(OVERLAY_OPACITY_KEY)).toBe(false);
    stored.clear();
    stored.set(OVERLAY_OPACITY_KEY, '0.5');
    expect(getOverlayOpacity()).toBe(0.5);
    stored.clear();
    stored.set(OVERLAY_OPACITY_KEY, '0.2');
    expect(getOverlayOpacity()).toBe(OVERLAY_OPACITY.min);
    stored.clear();
    stored.set(OVERLAY_OPACITY_KEY, 'garbage');
    expect(getOverlayOpacity()).toBe(0.82);
    // A value already under the new key wins over an old one.
    stored.clear();
    stored.set(OVERLAY_PANEL_ALPHA_KEY, '0.45');
    stored.set(OVERLAY_OPACITY_KEY, '1');
    expect(getOverlayOpacity()).toBe(0.45);
  });

  it('fading away from the pointer is off by default; the old fade key is ignored', () => {
    stored.set(OVERLAY_FADE_KEY, 'on');
    expect(getOverlayFade()).toBe(false);
    setOverlayFadePref(true);
    expect(getOverlayFade()).toBe(true);
  });

  it('paints the chosen opacity under the pointer, never more solid', () => {
    expect(paintedOpacity(0.7, false, true)).toBe(0.7);
    expect(paintedOpacity(0.7, false, false)).toBe(0.7);
    expect(paintedOpacity(0.7, true, true)).toBe(0.7);
    expect(paintedOpacity(0.7, true, false)).toBeCloseTo(0.7 * FADE_AWAY_FACTOR, 2);
    for (const value of [0.4, 0.55, 0.7, 1]) {
      for (const fade of [true, false]) {
        for (const hovered of [true, false]) {
          expect(paintedOpacity(value, fade, hovered)).toBeLessThanOrEqual(value);
        }
      }
    }
  });

  it('uses the defaults when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(getStartInOverlay()).toBe(true);
    expect(getOverlayOpacity()).toBe(OVERLAY_OPACITY.default);
    expect(getOverlayFade()).toBe(false);
    expect(() => setStartInOverlay(false)).not.toThrow();
  });
});

describe('overlay panels and split (ADR-0085)', () => {
  it('opens the transcript on the first call on a device, with the answer panel closed', () => {
    expect(getOverlayPanels()).toEqual({ transcript: true, answer: false });
    expect(stored.get(OVERLAY_PANELS_DEFAULT_KEY)).toBe(String(PANELS_DEFAULT_VERSION));
  });

  it('opens the transcript once on a device that stored a choice before, then keeps the choice', () => {
    // A 1.6.4 device: both panels closed last time, and the answer panel remembered as open before that.
    stored.set(OVERLAY_PANELS_KEY, 'none');
    expect(getOverlayPanels()).toEqual({ transcript: true, answer: false });
    // The user closes it: the next call starts closed.
    setOverlayPanels({ transcript: false, answer: true });
    expect(getOverlayPanels()).toEqual({ transcript: false, answer: false });
    // And opens it again: open from then on.
    setOverlayPanels({ transcript: true, answer: false });
    expect(getOverlayPanels()).toEqual({ transcript: true, answer: false });
  });

  it('never remembers the answer panel (an answer opening it is not a choice)', () => {
    stored.set(OVERLAY_PANELS_DEFAULT_KEY, String(PANELS_DEFAULT_VERSION));
    setOverlayPanels({ transcript: false, answer: true });
    expect(stored.get(OVERLAY_PANELS_KEY)).toBe('none');
    // An old stored value with the answer open starts with it closed.
    stored.set(OVERLAY_PANELS_KEY, 'transcript,answer');
    expect(getOverlayPanels()).toEqual({ transcript: true, answer: false });
  });

  it('keeps the split at 40 % by default and within its limits', () => {
    expect(getOverlaySplit()).toBe(OVERLAY_SPLIT.default);
    setOverlaySplit(0.55);
    expect(getOverlaySplit()).toBe(0.55);
    setOverlaySplit(0.99);
    expect(stored.get(OVERLAY_SPLIT_KEY)).toBe(String(OVERLAY_SPLIT.max));
    setOverlaySplit(0);
    expect(getOverlaySplit()).toBe(OVERLAY_SPLIT.min);
    stored.set(OVERLAY_SPLIT_KEY, 'wide');
    expect(getOverlaySplit()).toBe(OVERLAY_SPLIT.default);
  });

  it("remembers the panels' width within its limits, and nothing until a drag (ADR-0113, ADR-0115)", () => {
    // ADR-0115: nothing stored is null (the page picks the default for the panels open), and the answer
    // alone defaults to 62 % of the bars' width (it was the bars' whole width).
    expect(getOverlayPanelsWidth()).toBeNull();
    expect(OVERLAY_PANELS_WIDTH.default).toBe(0.62);
    setOverlayPanelsWidth(0.4567);
    expect(stored.get(OVERLAY_PANELS_WIDTH_KEY)).toBe('0.457');
    expect(getOverlayPanelsWidth()).toBe(0.457);
    // Never wider than the bars, never under the floor.
    setOverlayPanelsWidth(1.5);
    expect(getOverlayPanelsWidth()).toBe(OVERLAY_PANELS_WIDTH.max);
    setOverlayPanelsWidth(0);
    expect(getOverlayPanelsWidth()).toBe(OVERLAY_PANELS_WIDTH.min);
    stored.set(OVERLAY_PANELS_WIDTH_KEY, 'narrow');
    expect(getOverlayPanelsWidth()).toBeNull();
  });

  it('with storage blocked: the transcript open, the default split, and no error', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(getOverlayPanels()).toEqual({ transcript: true, answer: false });
    expect(getOverlaySplit()).toBe(OVERLAY_SPLIT.default);
    expect(() => setOverlayPanels({ transcript: false, answer: false })).not.toThrow();
    expect(() => setOverlaySplit(0.5)).not.toThrow();
    expect(getOverlayPanelsWidth()).toBeNull();
    expect(() => setOverlayPanelsWidth(0.5)).not.toThrow();
  });
});

describe('getPairGrowth / setPairGrowth (ADR-0119 amended, 27 Nov 2026)', () => {
  it('remembers the window growth for the pair until it is undone', () => {
    expect(getPairGrowth()).toBeNull();
    setPairGrowth({ base: 640.4, grown: 826.2, bars: 590.3 });
    expect(getPairGrowth()).toEqual({ base: 640, grown: 826, bars: 590 });
    setPairGrowth(null);
    expect(getPairGrowth()).toBeNull();
  });

  it('reads a damaged or impossible value as no growth', () => {
    for (const raw of [
      '{',
      'null',
      '{"base":800,"grown":700,"bars":600}',
      '{"base":-1,"grown":5,"bars":4}',
      '{"base":640,"grown":826}',
      '"x"',
    ]) {
      localStorage.setItem(OVERLAY_PAIR_GROWTH_KEY, raw);
      expect(getPairGrowth()).toBeNull();
    }
  });

  it('defaults the split to about a third for the transcript (like ParakeetAI)', () => {
    expect(OVERLAY_SPLIT.default).toBe(0.34);
  });
});

/**
 * Tests for apps/web/src/core/storage/overlayPrefs.ts (ADR-0029, ADR-0039), with a fake
 * localStorage: calls start in the overlay unless turned off; the panel opacity falls back to the
 * 82% default when unset or out of range; an old stored value (the window-opacity key, default 1)
 * is migrated once to the panel key, 1 becoming the default; fading away from the pointer is off by default
 * and never makes the panel more solid than the chosen value (the v1.0.2 bug: solid under the
 * pointer); blocked storage leaves the defaults. 1.6.3 (ADR-0075): any setting paints the panel 92–100 %
 * opaque (paintedPanelAlpha).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FADE_AWAY_FACTOR,
  getOverlayFade,
  getOverlayOpacity,
  getStartInOverlay,
  OVERLAY_FADE_KEY,
  OVERLAY_OPACITY,
  OVERLAY_OPACITY_KEY,
  OVERLAY_PANEL_ALPHA_KEY,
  PANEL_ALPHA_FLOOR,
  paintedOpacity,
  paintedPanelAlpha,
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

describe('paintedPanelAlpha (1.6.3, ADR-0075)', () => {
  it('maps the slider onto 92–100 %, the default 82 % to 97.6 %', () => {
    expect(PANEL_ALPHA_FLOOR).toBe(0.92);
    expect(paintedPanelAlpha(OVERLAY_OPACITY.min)).toBe(0.92);
    expect(paintedPanelAlpha(OVERLAY_OPACITY.default)).toBe(0.976);
    expect(paintedPanelAlpha(OVERLAY_OPACITY.max)).toBe(1);
    expect(paintedPanelAlpha(0.7)).toBe(0.96);
  });

  it('never goes below the floor, even while fading away from the pointer', () => {
    expect(paintedPanelAlpha(OVERLAY_OPACITY.min * FADE_AWAY_FACTOR)).toBe(0.92);
    expect(paintedPanelAlpha(0)).toBe(0.92);
    expect(paintedPanelAlpha(Number.NaN)).toBe(1);
    expect(paintedPanelAlpha(5)).toBe(1);
  });
});

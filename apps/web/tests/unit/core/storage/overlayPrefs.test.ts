/**
 * Tests for apps/web/src/core/storage/overlayPrefs.ts (ADR-0029), with a fake localStorage: calls
 * start in the overlay unless turned off; the opacity falls back to the default when unset or out
 * of range; fading is on unless turned off; blocked storage leaves the defaults.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOverlayFade,
  getOverlayOpacity,
  getStartInOverlay,
  OVERLAY_OPACITY,
  OVERLAY_OPACITY_KEY,
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

  it('keeps the opacity in range', () => {
    expect(getOverlayOpacity()).toBe(OVERLAY_OPACITY.default);
    setOverlayOpacityPref(0.6);
    expect(getOverlayOpacity()).toBe(0.6);
    stored.set(OVERLAY_OPACITY_KEY, '0.01');
    expect(getOverlayOpacity()).toBe(OVERLAY_OPACITY.default);
    stored.set(OVERLAY_OPACITY_KEY, 'loud');
    expect(getOverlayOpacity()).toBe(OVERLAY_OPACITY.default);
  });

  it('fades unless turned off', () => {
    expect(getOverlayFade()).toBe(true);
    setOverlayFadePref(false);
    expect(getOverlayFade()).toBe(false);
  });

  it('uses the defaults when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(getStartInOverlay()).toBe(true);
    expect(getOverlayOpacity()).toBe(OVERLAY_OPACITY.default);
    expect(() => setStartInOverlay(false)).not.toThrow();
  });
});

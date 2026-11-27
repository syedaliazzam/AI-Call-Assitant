/**
 * Tests for apps/web/src/features/live/ScreenshotSource.tsx (Mac 1.8.1 / Windows 1.7.5): a screenshot answer's card
 * shows the thumbnail; with a desktop app that names the screen and more than one screen, also "Screen 2" and
 * "Wrong screen?"; a browser or an older desktop app (no screen), or one screen, shows the thumbnail only; the
 * button waits while a screenshot is being taken.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { canRetakeScreen, ScreenshotSource } from '@/features/live/ScreenshotSource';

/** A tiny image data URL (never a real screenshot). */
const IMAGE = 'data:image/jpeg;base64,/9j/AA==';

describe('ScreenshotSource', () => {
  it('names the screen and offers "Wrong screen?" with more than one screen', () => {
    const html = renderToString(
      <ScreenshotSource image={IMAGE} screen={{ number: 2, count: 3 }} onWrongScreen={() => {}} />,
    );
    expect(html).toContain('alt="Screenshot this answer is about"');
    expect(html).toContain('data-screen-name');
    expect(html).toMatch(/Screen <!-- -->2/);
    expect(html).toContain('Wrong screen?');
    expect(html).not.toContain('disabled=""');
  });

  it('shows the thumbnail only for an older desktop app, a browser, or one screen', () => {
    for (const screen of [undefined, { number: 1, count: 1 }]) {
      const html = renderToString(
        <ScreenshotSource image={IMAGE} screen={screen} onWrongScreen={() => {}} />,
      );
      expect(html).toContain('alt="Screenshot this answer is about"');
      expect(html).not.toContain('data-screen-name');
      expect(html).not.toContain('Wrong screen?');
    }
    expect(renderToString(<ScreenshotSource />)).toBe('');
  });

  it('waits while a screenshot is being taken', () => {
    const html = renderToString(
      <ScreenshotSource screen={{ number: 1, count: 2 }} onWrongScreen={() => {}} busy />,
    );
    expect(html).toContain('disabled=""');
  });

  it('offers a retake only when the screen is known and there are several', () => {
    expect(canRetakeScreen(undefined)).toBe(false);
    expect(canRetakeScreen({ count: 1 })).toBe(false);
    expect(canRetakeScreen({ count: 2 })).toBe(true);
  });
});

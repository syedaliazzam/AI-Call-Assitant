/**
 * Tests for apps/web/src/features/live/CompactView.tsx (ADR-0113), from its markup (Node has no layout
 * engine, so widths are checked as the classes and styles that make them): the bars' column is as wide as
 * bar 1 (w-fit, never wider than the window) and lines up by the position's column (left, centre, right;
 * centred with no position); the pieces under bar 1 fill that column without widening it; with the answer
 * open the panels' block takes its remembered share of the bars' width (the bars' whole width by default),
 * and with the transcript alone it fills it; the answer's corner grip sits on the side that moves (bottom
 * left on a right position) and its Clear button always shows its key.
 */
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlayPreset } from '@kite/shared';
import type { CompactState } from '@/core/live/liveChannel';
import type { OverlayPanels } from '@/core/storage/overlayPrefs';

vi.mock('@/platform', () => ({
  getPlatform: () => ({
    getShareProtection: async () => ({ supported: true, on: true }),
    setShareProtection: async (on: boolean) => ({ supported: true, on }),
    hotkeyModifier: () => 'Ctrl',
  }),
}));
const { CompactView } = await import('@/features/live/CompactView');
const { OVERLAY_PANELS_WIDTH_KEY } = await import('@/core/storage/overlayPrefs');

/** A call with one finished answer on screen. */
const ANSWERED: CompactState = {
  audio: { you: true, them: true },
  chips: [{ id: 'c1', speaker: 'them', text: 'tell me about' }],
  answer: {
    id: 'a1',
    question: 'how would you design it',
    text: 'Start from latency.\n- Stream every stage',
    headline: 'Start from latency.',
    claims: [],
    askedAt: 0,
    rating: null,
    reported: false,
    auto: false,
    status: 'done',
    mode: 'answer',
    error: null,
    unavailable: false,
  },
  index: 0,
  total: 1,
  answering: false,
  capturing: false,
  notice: null,
  ended: false,
};

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

/**
 * The overlay as HTML, as the desktop app shows it (see-through, with the shell's resize steps).
 *
 * @param position The overlay's position (undefined: none, as in a browser).
 * @param panels   Which panels are open.
 * @returns The markup.
 */
function overlay(
  position: OverlayPreset | undefined,
  panels: OverlayPanels = { transcript: false, answer: true },
): string {
  return renderToString(
    <CompactView
      state={ANSWERED}
      protection={{ supported: true, on: true }}
      onCommand={() => undefined}
      glass
      panels={panels}
      onPanels={() => undefined}
      {...(position ? { position } : {})}
      onResize={() => undefined}
    />,
  );
}

/**
 * The class attribute of the first element carrying a data attribute.
 *
 * @param html      The markup.
 * @param attribute The data attribute (for example data-bars-column).
 * @returns Its class list, or '' when there is none.
 */
function classOf(html: string, attribute: string): string {
  const tag = html.match(new RegExp(`<[^>]*${attribute}=""[^>]*>`))?.[0] ?? '';
  return tag.match(/class="([^"]*)"/)?.[1] ?? '';
}

/**
 * The page root's class attribute (the first element with k-overlay-root).
 *
 * @param html The markup.
 * @returns Its class list.
 */
function rootClass(html: string): string {
  return html.match(/class="([^"]*k-overlay-root[^"]*)"/)?.[1] ?? '';
}

describe('CompactView (ADR-0113)', () => {
  it('lines the bars up by the position column, centred with no position', () => {
    expect(rootClass(overlay('top-left'))).toContain('items-start');
    expect(rootClass(overlay('bottom-left'))).toContain('items-start');
    expect(rootClass(overlay('top-center'))).toContain('items-center');
    expect(rootClass(overlay('top-right'))).toContain('items-end');
    expect(rootClass(overlay('bottom-right'))).toContain('items-end');
    expect(rootClass(overlay(undefined))).toContain('items-center');
  });

  it('keeps the bars at their natural width, and the pieces under bar 1 at its width', () => {
    const html = overlay('top-left');
    const column = classOf(html, 'data-bars-column');
    expect(column).toContain('w-fit');
    expect(column).toContain('max-w-full');
    // No 980 px cap or full-width bar any more (until ADR-0113 every bar filled the window).
    expect(html).not.toContain('max-w-[980px]');
    expect(html).toContain('w-0 min-w-full');
    // Mirrored on the bottom row, as the page was.
    expect(classOf(overlay('bottom-left'), 'data-bars-column')).toContain('flex-col-reverse');
  });

  it('gives the answer its remembered share of the bars, the bars whole by default', () => {
    expect(overlay('top-left')).toMatch(/data-panels-block=""[^>]*style="width:100%"/);
    stored.set(OVERLAY_PANELS_WIDTH_KEY, '0.5');
    const html = overlay('top-right');
    expect(html).toMatch(/data-panels-block=""[^>]*style="width:50%"/);
    // The block lines up on the bar's right edge, and is a container (side by side or stacked by its width).
    expect(html).toMatch(
      /class="[^"]*items-end[^"]*w-0 min-w-full[^"]*"><div data-gap="" data-panels-block/,
    );
    expect(classOf(html, 'data-panels-block')).toContain('@container');
    // The pair moves as one block: with the transcript open too, the same share.
    expect(overlay('top-right', { transcript: true, answer: true })).toMatch(
      /data-panels-block=""[^>]*style="width:50%"/,
    );
    // The transcript alone still fills the bars' width.
    expect(overlay('top-right', { transcript: true, answer: false })).toMatch(
      /data-panels-block=""[^>]*style="width:100%"/,
    );
  });

  it('keeps the answer panel at least as wide as its button strip, with the Clear key always shown', () => {
    const html = overlay('top-center');
    expect(classOf(html, 'data-answer-panel')).toContain('min-w-max');
    // The text under the strip never sets the panel's smallest width.
    expect(html).toContain('[contain:inline-size]');
    // The key-cap after "Clear" has no width rule hiding it (until ADR-0113: hidden under 620 px).
    const clear = html.match(/aria-label="Clear answers"[^>]*>([\s\S]*?)<\/button>/)?.[1] ?? '';
    expect(clear).toContain('Clear');
    expect(clear).toContain('inline-flex');
    expect(clear).not.toMatch(/class="(?:[^"]* )?hidden[ "]/);
  });

  it('puts the corner grip on the side that moves', () => {
    expect(overlay('top-left')).toContain('data-grip-side="right"');
    expect(overlay('top-center')).toContain('data-grip-side="right"');
    expect(overlay('top-right')).toContain('data-grip-side="left"');
    expect(overlay('bottom-right')).toContain('data-grip-side="left"');
  });
});

/**
 * Tests for apps/web/src/features/live/CompactView.tsx (ADR-0113), from its markup (Node has no layout
 * engine, so widths are checked as the classes and styles that make them): the bars' column is as wide as
 * bar 1 (w-fit, never wider than the window) and lines up by the position's column (left, centre, right;
 * centred with no position); the pieces under bar 1 fill that column without widening it; with the answer
 * open the panels' block takes its remembered share of the bars' width, and with the transcript alone it
 * fills it; the answer's corner grip sits on the side that moves (bottom left on a right position) and its
 * Clear button always shows its key. ADR-0115: before any drag the answer alone is 62 % of the bars' width
 * and the pair beside the transcript the bars' whole width; the question carries a muted "Question:" label.
 * ADR-0118: bar 2 (the transcript bar) stays with the words when the full transcript opens under it, a warning
 * has its own line between them, and both are mirrored on the bottom row.
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
 * @param state    What the live page shows (a call with one answer by default).
 * @returns The markup.
 */
function overlay(
  position: OverlayPreset | undefined,
  panels: OverlayPanels = { transcript: false, answer: true },
  state: CompactState = ANSWERED,
): string {
  return renderToString(
    <CompactView
      state={state}
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

  it('gives the answer its remembered share of the bars, a reading column by default', () => {
    // ADR-0115: never dragged, the answer alone is 62 % of the bars (it was 100 %), and beside the transcript
    // the pair keeps the bars' whole width (so the two still sit side by side).
    expect(overlay('top-left')).toMatch(/data-panels-block=""[^>]*style="width:62%"/);
    expect(overlay('top-left', { transcript: true, answer: true })).toMatch(
      /data-panels-block=""[^>]*style="width:100%"/,
    );
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

  it('labels the question with a muted "Question:" before it, inside the accent bar (ADR-0115)', () => {
    const html = overlay('top-left');
    const card = html.match(/<p aria-label="Question"[^>]*>([\s\S]*?)<\/p>/);
    expect(card?.[0]).toContain('border-l-2');
    const label = card?.[1]?.match(/<span([^>]*)>([^<]*)<\/span>/);
    expect(label?.[2]).toBe('Question:');
    // Subtle: hidden from screen readers (the paragraph is named), smaller, lighter and grey.
    expect(label?.[1]).toContain('aria-hidden="true"');
    expect(label?.[1]).toContain('text-ui-muted');
    expect(label?.[1]).toContain('font-medium');
    // The question's words follow it, still the bold title.
    expect(card?.[1]).toContain('How would you design it');
    expect(card?.[0]).toMatch(/class="[^"]*font-semibold[^"]*text-ui-heading/);
  });

  it('puts the corner grip on the side that moves', () => {
    expect(overlay('top-left')).toContain('data-grip-side="right"');
    expect(overlay('top-center')).toContain('data-grip-side="right"');
    expect(overlay('top-right')).toContain('data-grip-side="left"');
    expect(overlay('bottom-right')).toContain('data-grip-side="left"');
  });
});

/** A call where the other side cannot be heard (a warning with its button). */
const SILENT_THEM: CompactState = {
  ...ANSWERED,
  callNotice: {
    kind: 'them-silent',
    text: "We can't hear the other side — check the audio source.",
    detail: '',
    action: { list: 'audio', label: 'Choose audio source' },
  },
};

describe('CompactView (ADR-0118: the transcript bar like ParakeetAI)', () => {
  it('keeps bar 2 with the live words when the full transcript opens, and the panel under it', () => {
    const html = overlay('top-left', { transcript: true, answer: true });
    const bar2 = html.indexOf('aria-label="Status bar"');
    const panel = html.indexOf('aria-label="Transcript panel"');
    expect(bar2).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(bar2);
    // Only one status bar (the panel has no header of its own) and it still shows the words.
    expect(html.split('aria-label="Status bar"')).toHaveLength(2);
    expect(html).toContain('tell me about');
    expect(html).toContain('aria-label="Close the full transcript"');
    // Bar 1 has no Transcript switch any more.
    expect(html).not.toContain('aria-label="Transcript"');
  });

  it('shows a warning in its own line under bar 2, never in place of the words', () => {
    const html = overlay('top-left', { transcript: false, answer: true }, SILENT_THEM);
    const bar2 = html.indexOf('aria-label="Status bar"');
    const line = html.indexOf('data-status="them-silent"');
    expect(line).toBeGreaterThan(bar2);
    expect(line).toBeLessThan(html.indexOf('data-panels-block'));
    expect(html).toContain('Choose audio source');
    expect(html).toContain('tell me about');
    // No line at all when nothing applies.
    expect(overlay('top-left')).not.toContain('data-status=');
  });

  it('mirrors bar 2 and the warning line on the bottom row (the line above bar 2)', () => {
    const top = overlay('top-left', { transcript: false, answer: true }, SILENT_THEM);
    const bottom = overlay('bottom-left', { transcript: false, answer: true }, SILENT_THEM);
    // The wrapper that holds bar 2 and the line: a column on the top row, reversed on the bottom row.
    const wrapper = (html: string) =>
      html.match(
        /<div data-gap="" class="([^"]*)"><div class="[^"]*"[^>]*data-bars=""[^>]*><div role="group" aria-label="Status bar"/,
      )?.[1] ?? '';
    expect(wrapper(top)).toMatch(/(^| )flex-col( |$)/);
    expect(wrapper(bottom)).toContain('flex-col-reverse');
  });
});

describe('CompactView (ADR-0119: side by side from the window width)', () => {
  it('makes the root the named container "overlay" that the panels follow', () => {
    expect(rootClass(overlay('top-left'))).toContain('@container/overlay');
    const area = classOf(
      overlay('top-left', { transcript: true, answer: true }),
      'data-panels-area',
    );
    expect(area).toContain('@min-[600px]/overlay:flex-row');
    // The bottom row is mirrored, as before.
    const bottom = classOf(
      overlay('bottom-left', { transcript: true, answer: true }),
      'data-panels-area',
    );
    expect(bottom).toContain('flex-col-reverse');
    expect(bottom).toContain('@min-[600px]/overlay:items-end');
  });

  it('lets the pair be as wide as the window or 720 px (wider than bar 1) only with both panels open', () => {
    const both = classOf(
      overlay('top-center', { transcript: true, answer: true }),
      'data-panels-block',
    );
    expect(both).toContain('@min-[600px]/overlay:min-w-[min(720px,100cqw)]');
    expect(both).toContain('@min-[600px]/overlay:max-w-none');
    // One panel alone keeps ADR-0113 / ADR-0115's width (the answer's share, the transcript the bars' width).
    expect(classOf(overlay('top-center'), 'data-panels-block')).not.toContain('min-w-[min(');
    expect(
      classOf(overlay('top-center', { transcript: true, answer: false }), 'data-panels-block'),
    ).not.toContain('min-w-[min(');
  });

  it('keeps each panel’s minimum (transcript 240, answer 340) side by side, by the window', () => {
    const html = overlay('top-left', { transcript: true, answer: true });
    expect(html).toContain('@min-[600px]/overlay:min-w-[240px]');
    expect(html).toContain('@min-[600px]/overlay:min-w-[340px]');
    // No query left on the block's own width.
    expect(html).not.toMatch(/@min-\[600px\]:(flex-row|min-w|grow-0|basis|flex )/);
  });
});

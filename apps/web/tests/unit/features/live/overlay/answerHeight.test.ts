/**
 * Tests for apps/web/src/features/live/overlay/answerHeight.ts (ADR-0105, desktop 1.7.1): the answer panel's
 * default height follows the answer text size; a panel asks for its default even before the window can show
 * it; while the same answer shows the content height only grows (no jumping as it streams), and a new answer,
 * width, zoom or text size fits again.
 */
import { describe, expect, it } from 'vitest';
import {
  ANSWER_PANEL_CHROME,
  ANSWER_PANEL_DEFAULT_HEIGHT,
  answerHoldKey,
  answerPanelMinHeight,
  holdHeight,
  neededPanelHeight,
} from '@/features/live/overlay/answerHeight';

describe('answerPanelMinHeight', () => {
  it('is the default height at 100 % text size; only the text part follows the size', () => {
    expect(answerPanelMinHeight()).toBe(ANSWER_PANEL_DEFAULT_HEIGHT);
    expect(answerPanelMinHeight(1)).toBe(380);
    // 150 %: the header and padding (70) stay, the text part (310) grows by half.
    expect(answerPanelMinHeight(1.5)).toBe(ANSWER_PANEL_CHROME + 465);
    expect(answerPanelMinHeight(0.8)).toBe(318);
  });

  it('treats a bad size as 100 %', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(answerPanelMinHeight(bad)).toBe(380);
    }
  });
});

describe('neededPanelHeight', () => {
  it('is what the panel shows plus what scrolls, and never less than its default', () => {
    // A long answer in a short window: 200 shown, 300 more scroll.
    expect(neededPanelHeight(200, 300, 380)).toBe(500);
    // A window shorter than the default, with a short answer: the default is asked for.
    expect(neededPanelHeight(150, 0, 380)).toBe(380);
    // No default (the transcript panel, or no answer yet): the content alone.
    expect(neededPanelHeight(150, 20, 0)).toBe(170);
    expect(neededPanelHeight(150, -5, 0)).toBe(150);
  });
});

describe('holdHeight: grow-only while the same answer shows', () => {
  const key = (answerId: string | null, width = 768) =>
    answerHoldKey({ answerId, transcript: false, up: false, zoom: 1, fontScale: 1, width });

  it('only grows while an answer streams, then a new shorter answer shrinks it back', () => {
    let held = holdHeight(null, key('a1'), 488);
    expect(held?.height).toBe(488);
    // Streaming: taller, then a re-wrap that measures a little shorter: it stays at the tallest.
    held = holdHeight(held, key('a1'), 560);
    held = holdHeight(held, key('a1'), 544);
    expect(held?.height).toBe(560);
    held = holdHeight(held, key('a1'), 616);
    expect(held?.height).toBe(616);
    // The next answer is shorter: it fits again.
    held = holdHeight(held, key('a2'), 488);
    expect(held?.height).toBe(488);
  });

  it('starts again when the person resizes, zooms or changes the text size', () => {
    const held = holdHeight(null, key('a1', 768), 616);
    expect(holdHeight(held, key('a1', 960), 480)?.height).toBe(480);
    const zoomed = answerHoldKey({
      answerId: 'a1',
      transcript: false,
      up: false,
      zoom: 1.3,
      fontScale: 1,
      width: 768,
    });
    expect(holdHeight(held, zoomed, 600)?.height).toBe(600);
    const bigger = answerHoldKey({
      answerId: 'a1',
      transcript: false,
      up: false,
      zoom: 1,
      fontScale: 1.2,
      width: 768,
    });
    expect(holdHeight(held, bigger, 590)?.height).toBe(590);
    // Opening the transcript beside it, or moving to the bottom row, starts again too.
    expect(
      answerHoldKey({
        answerId: 'a1',
        transcript: true,
        up: false,
        zoom: 1,
        fontScale: 1,
        width: 768,
      }),
    ).not.toBe(key('a1'));
    expect(
      answerHoldKey({
        answerId: 'a1',
        transcript: false,
        up: true,
        zoom: 1,
        fontScale: 1,
        width: 768,
      }),
    ).not.toBe(key('a1'));
  });

  it('holds nothing with no answer shown', () => {
    expect(key(null)).toBeNull();
    expect(
      answerHoldKey({
        answerId: undefined,
        transcript: true,
        up: false,
        zoom: 1,
        fontScale: 1,
        width: 1,
      }),
    ).toBeNull();
    const held = holdHeight(null, key('a1'), 616);
    expect(holdHeight(held, null, 200)).toBeNull();
  });
});

# ADR-0124: The transcript and the answer are always the same height side by side; the answer alone sits centred under the bars

- **Status:** Accepted (25 Nov 2026, the developer's WP3 brief, item 3)
- **Date:** 2026-11-25
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Overlay, compact view) (version 4.62.0)
- **Supersedes / superseded by:** amends ADR-0113 §5 (the answer panel lined up by the position's column when open alone) and ADR-0119 (the pair's height: each panel was as tall as its own content, and the taller one set the window). Keeps ADR-0119's widths (side by side from 600 CSS px of the window; the pair at least `min(720 px, window)`), ADR-0115's default shares, ADR-0105's height rules for the answer, and ADR-0056 / ADR-0075's bottom-row mirroring.

## Context

In ParakeetAI's overlay the transcript panel on the left and the answer panel on the right are always the same height, and with the transcript closed the answer sits centred under the bars. Ours (measured 25 Nov 2026 in the integration harness, `docs/testing/wp3-overlay-screenshots/before/`): side by side each panel was as tall as its own content (`items-start`), so at 640 px the transcript was 296 px and the answer 409 px, with an uneven gap under the transcript; a long transcript made the window taller than the answer needed. Since ADR-0113 the answer alone lined up on bar 1's left edge on a left position and its right edge on a right position.

## Decision

Web only. No change to the desktop shell.

1. **Same height side by side.** With both panels open and side by side (a window of 600 CSS px or more), the transcript panel is exactly as tall as the answer panel. The answer sizes itself as before (its content, at least its default height, up to what the window allows); a layout effect copies its height to `--k-pair-height` on the panels' area whenever it changes (a ResizeObserver, so a streaming answer and a re-wrap are followed), and the transcript panel uses it (`@min-[600px]/overlay:h-[var(--k-pair-height,auto)]`). Stacked under 600 px nothing changes.
2. **The transcript scrolls inside its panel** and keeps following the newest words, with **Scroll to bottom** when scrolled up (`useStickToBottom`, unchanged). Its length never makes the window taller: side by side, only the answer panel is measured for the window's height (`contentHeight`).
3. **The pair's floor.** With both open, the answer panel is at least its default height even before the first answer (`answerPanelMinHeight`), so the transcript beside it is never a sliver.
4. **The answer alone is centred under the bars** on every position (`panelsColumn()`); its corner grip then moves both edges, as on a centre position. With the transcript open the pair lines up by the position's column as ADR-0113 / ADR-0119 decided (from bar 1's left edge on a left position, its right edge on a right one).
5. **Opening the transcript keeps the height.** The answer's held height (ADR-0105) no longer starts again when the transcript opens or closes beside it, nor when the block widens for the pair (ADR-0119): its key uses the window's width and the dragged share instead of the block's width. It can still grow if the answer needs more room at its narrower width (the window never cuts an answer short); stacked, opening the transcript fits again as before.
6. **Mirroring is unchanged:** on the bottom row the pair sits on the bars, the same height, aligned on its bottom edge.

## Consequences

- At the 640 default the pair is 409 px tall on both sides (was 296 / 409); at 1280 px 380 / 380 (was 296 / 380); the answer alone is centred to within 1 px on every position (measured in the harness, `docs/testing/wp3-overlay-screenshots/after/measurements.json`).
- A call with a long transcript no longer grows the window beyond the answer; the transcript scrolls instead.
- On a left or right position the answer alone no longer hugs the bar's edge; it is centred under the bars (the bars themselves still line up by the position).
- Opening the transcript beside a short answer in a 640 px window may still add a few pixels when the narrower answer re-wraps (20 px for the test answer), rather than cutting the answer.

## Alternatives considered

- **Stretch both panels to the panels' area (`items-stretch`).** In a single-line flex row with a definite height the line is the whole area, so the panels would fill the window rather than the answer's height, and a stretched answer cannot be measured for its own height (the window would never shrink).
- **Fix both panels to a constant height, as the reference app seems to.** It would cut long answers or leave short ones with a large empty panel; ADR-0105 chose content-fitted answers.
- **Keep the column alignment for the answer alone.** The brief asks for it centred.

## Validation

- Unit: `tests/unit/features/live/CompactView.test.tsx` (the transcript's pair height only side by side, the pair's floor, the answer alone centred on every position, the grip side), `panelWidth.test.ts` (`panelsColumn`), `answerHeight.test.ts` (the share in the hold key).
- Integration: `tests/integration/live.spec.ts` "ADR-0124" (same height and same top at 640 and 1280 px on top-center, bottom-center, top-left and bottom-right; the answer alone centred; a long transcript scrolls inside its panel, keeps the pair's height, and shows **Scroll to bottom**), S15, and the WP3 pictures.
- Pictures, before and after, at 640 and 1280 px, top and bottom: `docs/testing/wp3-overlay-screenshots/`.

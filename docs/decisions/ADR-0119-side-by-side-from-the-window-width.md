# ADR-0119: The transcript and the answer sit side by side whenever the window allows, even if the bars are narrower

- **Status:** Accepted (25 Nov 2026, the developer's approval of the investigation's fix F2, decision D-3)
- **Date:** 2026-11-25
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Overlay, compact view) (version 4.56.0)
- **Supersedes / superseded by:** amends ADR-0113 (the panels' block was never wider than the bars, and it chose side by side or stacked from its own width) and ADR-0085 (side by side from 600 CSS px "of the window"; ADR-0113 had made that "of the block"). Keeps ADR-0115's default widths, ADR-0113's column alignment and corner grip, and ADR-0056 / ADR-0075's mirroring.

## Context

The investigation of 25 Nov 2026 (`docs/investigations/2026-11-25-mac-windows-parity-and-backlog.md` §A.1) found why the Mac overlay always stacked the transcript above the answer:

- The desktop app opens the overlay at 40 % of the work area, 640–960 DIP (`apps/desktop/src/windows.ts`). On a 13" MacBook Air (work area 1440–1470 pt), a 1366 or 1536 DIP Windows laptop, and 1920×1080 at 125 % (1536 DIP), that is the 640 floor.
- Since ADR-0113 the panels' block was a share of the bars' width and never wider than bar 1. Bar 1, as wide as what it shows, gives way in a 640 window and ends up under 600 px (ADR-0113 measured 530 on Windows; about 590 on the Mac).
- The block chose side by side from **its own** width (`@min-[600px]` on the block), so at 640 it could never reach 600 and always stacked. Kite's zoom scales both sides of that comparison, and the answer's corner grip was capped at the bars' width, so neither helped.
- It was not Mac-specific. It showed on the Mac because Mac laptops always get the 640 floor.
- ADR-0118 removed the Transcript switch from bar 1, which makes bar 1 narrower still. Without this change, the panels would also stack in wider windows.

## Decision

Web only. No change to the desktop shell.

1. **The window decides.** The overlay's root is a named container (`@container/overlay`). The transcript and the answer sit side by side when the **window** is at least 600 CSS px wide (`@min-[600px]/overlay:`), and stack below that, as ADR-0085 first meant. The transcript is on the left and the answer on the right. On the bottom row they still sit on the bars.
2. **The pair may be wider than bar 1.**
   - With both panels open in a window of at least 600 px, the block is at least as wide as the window or 720 px, whichever is less (`@min-[600px]/overlay:min-w-[min(720px,100cqw)]`; `100cqw` is the root's width, the nearest container). There is no 100 % cap, and the block is never wider than the window.
   - 720 px is about the width the pair had beside the bars before ADR-0118 removed bar 1's Transcript switch: bar 1 measured 715 px at the 768 and 960 defaults with Rec and Click-through. Without it the pair would have been about 100 px narrower in wide windows, and the answer's footer wrapped (integration test S15 at 1080 px).
   - A wider bar 1, or a wider dragged share, still sets the width.
   - With one panel open, the width is as before: the remembered share of the bars' width, or by default the bars' whole width (ADR-0115).
3. **Alignment is unchanged.** The block keeps lining up by the position's column. On a left position it extends from bar 1's left edge to the right, on a right position from bar 1's right edge to the left, and centred it extends evenly on both sides. It does not widen the bars' column (`w-0 min-w-full` around it, ADR-0113).
4. **Where it already worked, nothing changes.** Wherever the pair was side by side before (bar 1 at least 600 px), it stays side by side, at about the same width (715 before, 720 now, at the 768 and 960 defaults) or exactly the same when bar 1 is wider than 720.

## Consequences

- At the 640 default (13" Mac, small Windows laptops), both panels now sit side by side across the whole window (640 px), wider than bar 1. The transcript keeps at least 240 px and the answer at least 340 px (ADR-0085).
- A user who dragged the answer narrow no longer stacks the pair when both are open: the block holds the window's width or 720 px. The answer alone still takes the dragged width.
- On wide windows the pair keeps about the width it had (720 px instead of bar 1's 715). It is exactly the same where bar 1 is wider than 720 px.
- Under 600 px (a picture-in-picture window, the narrowest desktop window) the panels stack as before, transcript first.

## Alternatives considered

- **Lower the threshold and the panels' minimums (F1).** Simple, but tied to bar 1's contents: one more chip in bar 1 and it stacks again. It also leaves about 200 px columns.
- **Raise the shell's default width, or set the window to bar 1's width (F3).** Needs a desktop release on both systems, changes only the default, and covers half of a 13" screen.
- **Keep ADR-0113's "never wider than the bars" and stack.** That is the bug the team reported.

## Validation

- Unit tests:
  - `tests/unit/features/live/CompactView.test.tsx`: the named root container, the block's 600 px minimum only with both panels, the layout classes.
  - `tests/unit/features/live/overlay/PanelSplit.test.tsx`: the divider follows the window.
- Integration: `tests/integration/live.spec.ts` S15 (side by side at 1080 and now at 640, stacked under 600) and `tests/integration/sim-calls.spec.ts`.
- Measured in the headless harness with Windows and Mac settings at 640, 768 and 960 px, before and after (`docs/testing/v1.8.0-overlay-screenshots/`, `measurements.json`).
- On the real Mac (13" Air at the 640 default) and Windows: the release test and the Windows checklist.

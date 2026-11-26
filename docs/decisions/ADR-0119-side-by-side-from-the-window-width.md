# ADR-0119: The transcript and the answer sit side by side whenever the window allows, even if the bars are narrower

- **Status:** Accepted (25 Nov 2026, the developer's approval of the investigation's fix F2, decision D-3)
- **Date:** 2026-11-25
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Overlay, compact view) (version 4.56.0)
- **Amended 27 Nov 2026:** the pair is one row about 1.4 × bar 1 (at least 720 px), the window grows for it through the existing resize steps, and opening the transcript opens the answer beside it (see "Amendment" at the end).
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

## Amendment (27 Nov 2026): the transcript and the answer as one wide row, like ParakeetAI

**Context.** In ParakeetAI's overlay, with the transcript open, the panel row (transcript ≈ 1/3 on the left, answer ≈ 2/3 on the right, the same height) is clearly wider than the bars, about 1.4 × the first bar, and lines up under them. Ours was held to about bar 1's width (at least `min(720 px, window)`), and a Windows user still saw the pair stacked with the transcript open. The pair stacks whenever the window is under 600 CSS px, which happens at the 640 DIP default with a UI zoom above about 107 % (640 / 1.07 < 600), or in a window the user narrowed; the user's exact window was not available, so that is the likely cause, not a measured one.

**Decision (web only; Windows 1.7.4 and Mac 1.8.0 already have everything it uses).**
1. **Opening the transcript opens the answer beside it** (bar 2's buttons, a click on the words, Ctrl+Alt+T). Closing the transcript leaves the answer open. A user who closes the answer keeps the transcript alone, which fills the bars' width as before.
2. **One row.** With both open the panels' block is `min(100cqw, max(720px, 140%))` (`pairWidthStyle()`): 1.4 × bar 1's width (`PAIR_WIDTH_FACTOR`), at least 720 px (`PAIR_ROW_MIN`; under about that the answer's footer wrapped, as this ADR found first), never wider than the window. The transcript takes about a third (the split's default is now 0.34; a dragged split is still remembered). The answer's dragged width (ADR-0113 / ADR-0115) applies to the answer alone; on the pair the grip changes only the height.
3. **Side by side always, unless the screen is too narrow.** The pair sits side by side from 600 CSS px of window (unchanged). The window grows to the row (point 4), so it stacks only where the window cannot reach 600 CSS px: a screen whose work area is under 600 × the UI zoom + 32 DIP (632 DIP at 100 %), or a browser's picture-in-picture window narrower than 600 px.
4. **The window grows, the bars stay.** While the pair shows in the full overlay, the page asks the shell for a window wide enough for the row (`pairWindowWidth()`: the row at the page's zoom, never narrower than now, never wider than the screen's work area less 16 DIP a side), through `resizeOverlay`, the bridge every desktop app has had since 1.0.2 (ADR-0035). It sends only `'start'` and `'move'` steps on the edge the position allows (`widthSteps()`): the right edge on a left position, the left edge on a right position, half on each side centred, so the bars do not move on screen. No `'end'` step: the shell's `'end'` would store the window's height as the one the user chose for these panels and save the grown width as the overlay's own. Before the window grows, the page holds the bars' column at the width it had (written to its style), so bar 1 does not spread into the new room. When the pair closes (the transcript or the answer closed, the call ended), the page narrows the window back by the same steps and lets the bars go once the window has narrowed (at most 1 s). `overlay/usePairWindow.ts`.
5. **An overlay closed while grown.** The shell saves the bounds it has on close, so the next overlay would open wide. The page remembers the growth (`kite.overlayPairGrowth`: the widths before and after, in CSS px of the page) and, when an overlay opens at exactly the grown width, holds the bars and narrows it back as soon as the pair is not showing. A record that does not match the window is dropped.
6. **No shell** (a browser's picture-in-picture window): nothing grows; the row is as wide as the window allows, side by side from 600 px.
7. **The answer's footer.** Its type, how and when are one part that takes the rest of the footer's line and wraps inside itself, right-aligned, so "Answer · 12:01" never falls alone under the buttons at the new widths (about 550 px for the answer by default).

**Consequences.**
- Measured in the harness (27 Nov 2026, `docs/testing/overlay-fixes-2-screenshots/*/measurements.json`): bar 1 is 605 px there at both the 640 DIP default (1280 and 1440 screens) and the 768 default (1920), so opening the transcript widens the window to 847 DIP; the row is 847 px (1.40 × the bars), the transcript 288 and the answer 553 (before: 256 / 378 at 640 and 288 / 426 at 768, the row 640 or 720). The bars stay exactly where they were (605 px, bar 1's fit step unchanged, also with the Rec pill and Click-through squeezing bar 1 in a 640 window). With a wider bar 1 the window grows more, for example to about 1001 DIP for the 715 px bar 1 ADR-0119 measured at 768.
- Closed, the answer alone now sits on the bars' edge on left and right positions (it was 115 px in from it, centred).
- The space beside the bars in the grown window is transparent and passes clicks through (ADR-0055), as any gap does.
- If the user resizes the overlay while the pair is open, closing the pair narrows it back to the width it had before the pair opened (on the side its position allows); a window already that narrow or narrower is left alone. A position picked from the ⋮ grid keeps the window's width, so the same applies.
- **Desktop part for a later release (not needed now):** a shell-side "content width" in `OverlayLayout` (anchored like `zoomedWidth()`) would let the shell size the window itself, without page-driven steps, and remember the user's own width separately. Listed for the next desktop release; today's shells work without it.

**Alternatives considered.**
- **Wait for a desktop release with a content width.** Cleaner, but needs Windows and Mac releases; the resize steps already do the job on both shells today.
- **Grow without holding the bars.** Bar 1 would spread into the new room (it is squeezed in a 640 window), the row would grow with it and the bars would visibly change.
- **Send the `'end'` step.** It would save the grown width as the overlay's own and pin the remembered height.

**Validation.**
- Unit: `panelWidth.test.ts` (the row's CSS, `pairWindowWidth()` at zoom 1 and 1.25, the screen cap, `widthSteps()` per column with no `'end'`), `overlayPrefs.test.ts` (`kite.overlayPairGrowth`, the 0.34 split), `CompactView.test.tsx` (the row only with both open, no hold in the markup).
- Integration: `live.spec.ts` "ADR-0119 / ADR-0124 amended" (1280, 1440 and 1920 px screens at their default windows, all six positions: the steps and their edges, the window played to the new width, the bars unchanged, the pair side by side, the same height, 1.4 × bar 1, inside the window, aligned; closing narrows back by the same amount), "ADR-0119 amended: where the window cannot grow" (no shell: side by side at 640, stacked at 560), S15.
- Pictures before and after: `docs/testing/overlay-fixes-2-screenshots/`.

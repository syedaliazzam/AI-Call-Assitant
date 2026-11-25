# ADR-0113: The answer panel has its own width; the bars keep theirs; both line up by the position's column

- **Status:** Accepted (23 Nov 2026, after review of the branch preview)
- **Date:** 2026-11-23
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Overlay, compact view) (version 4.50.0)
- **Supersedes / superseded by:** reverses ADR-0085's "one open panel fills the width" for the answer panel; keeps the rest of ADR-0085 (the split, side by side from 600 CSS px, the default size, the window's width never changed by the panels). Its default width for the answer open alone is changed by ADR-0115 (0.62 of the bars' width instead of 1). **Amended by ADR-0119:** side by side or stacked follows the window's width again (600 CSS px of the window, not of the block), and with both panels open in a window that wide the block is at least the window's width or 720 px, whichever is less, so it may be wider than the bars (it stacked in every 640 px window: 13" Mac, small Windows laptops).

## Context

The developer compared our overlay with a reference product's. Their photos show two pieces: a main bar of a fixed size, and an answer window with its own resize corner. The answer window's top strip of buttons keeps the same size and labels at every width; only the answer area changes. The answer window lines up with the bar by where the bar is on screen: centred in the middle, on the bar's left edge on the left, on its right edge on the right. Top and bottom were already mirrored in ours (ADR-0056, ADR-0075).

Ours before this change (measured on 23 Nov 2026 in a headless browser on the current `main`, invented data, no real screen):

- One window holds everything. The bars filled the window up to 980 CSS px; each panel open alone filled it; everything was centred.
- The answer panel's corner grip resized the whole window ('se' to the shell), so a narrower answer meant narrower bars. Bar 1 then gave way (words, key-caps, move, Click-through). In a 640 px window it was at fit step 3, and at 440 px at step 6.
- The answer panel's Clear button lost its key-cap under 620 px (so at the default 640 window it was shown only when the answer filled a wider window).
- Bar 1's natural width is 833 CSS px (958 with the desktop Rec pill).

## Decision

Web only. No change to the desktop shell (`apps/desktop/src/windows.ts`) or the bridge.

1. **Bars at their natural width.** The pieces sit in one column (`data-bars-column`, `w-fit max-w-full`) as wide as bar 1 needs, never wider than the window. Bar 1 no longer stretches. Bar 2, the warnings, the "call has ended" line and the panels' area are exactly bar 1's width (`w-0 min-w-full`: their own content never widens the column). Bar 1 gives way only when the window itself is narrower than it, never because the answer was resized. Because the column no longer follows the window, bar 1 starts its fit again whenever the window's width changes (`ControlBar.tsx` `useFitStep`).
2. **A fixed answer strip.** The answer panel's top strip keeps the same buttons and labels at every width: Clear always shows its key. The panel is never narrower than that strip: `min-width: max-content`, with the answer text below it size-contained (`contain: inline-size`), so the text wraps instead of setting the width. The strip measures 261 CSS px.
3. **The answer's own width.** With the answer open, the panels are one block (`data-panels-block`) whose width is a share of the bars' width. The share is remembered per device (`kite.overlayPanelsWidth`, 0.2–1, default 1 = as wide as the bars; **ADR-0115 narrows the default: until the user drags, the answer open alone is 0.62 of the bars' width, and the transcript and answer side by side keep 1**). It is never wider than the bars, so the window never has to grow for it. The transcript beside it shares that block (side by side from 600 CSS px of the block, stacked below that, as before). The transcript open alone still fills the bars' width.
4. **The corner grip.** A drag sideways changes only the share, in the page; the window's width never changes. The grip's edge follows the pointer: the right edge on a left or centre position (centred, both edges move, so the width changes by twice the distance), the left edge on a right position, where the grip sits in the bottom-left corner. The width stops at the strip and at the bars' width. A drag up or down still changes the window's height through the shell, as before (now edge 's' with no sideways part, instead of 'se').
5. **Alignment by column.** As the rows mirror top and bottom, the columns line up the pieces: on left positions the column of bars sits on the window's left edge and the panels' block on the bars' left edge; centred in the middle; on right positions on the right edges (`overlay/panelWidth.ts` `overlayColumn()`). With no position (a browser's picture-in-picture window) everything is centred, as before.

## Consequences

- Resizing the answer never changes the bars. Measured after the change (same headless set-up, a 960 px window): bar 1 stays 832 px at fit step 0 during every drag. A 300 px drag narrows the answer to 533 px on a left or right position and to the strip (263 px) centred. A drag far outward stops at 832 px, far inward at 263 px (strip 261 px). The shell receives only height steps (`s`, dx 0).
- **The window's width is still set by the shell** (the user's edge drag, the zoom, the default of 40 % of the display, 640–960 DIP). The page cannot set it without a shell change. So the window is not always exactly as wide as the bars:
  - In a window wider than bar 1 (for example 960 with an 833 bar), the space beside the bars is a transparent gap that passes clicks through (ADR-0055). The window's invisible side grips stay at the window's edges, not at the bars'.
  - In a window narrower than bar 1's natural width (the 640 default on a 1366 or 1536 laptop screen), bar 1 still gives way, as before, and is then only as wide as what it shows (530 px at 640, with a 55 px gap each side when centred). On those screens the bars cannot show every word until the window is widened.
  - Making the window exactly as wide as the bars (the reference look) needs the shell to accept a width from the page, like `contentHeight`. That is a desktop release; it was left out on purpose and is offered as a follow-up.
- A narrower answer is taller (its text wraps more); the window's height follows it (`contentHeight`; the held height of ADR-0105 is now keyed on the panels' width).
- Popovers placed under bar 1's buttons (Rec, model) are kept inside bar 1's box rather than the window's.
- Older desktop shells are unaffected beyond the page's layout (they get the same steps as before; 's' has always been a valid edge).

## Alternatives considered

- **Shell sets the window to the bars' width** (a `contentWidth` in `OverlayLayout`, anchored by column as `zoomedWidth()` already is). Faithful to the reference, and the bars would always show every word. Rejected for now: the developer asked for a web-only change; it is the natural next step.
- **Drive the window's width from the page with synthetic resize steps.** Rejected: it misuses the drag API, and its 'end' step writes the remembered heights.
- **Store the answer's width in pixels.** Rejected: under the UI zoom (CSS zoom) pixels and pointer coordinates differ. A share of the bars' width needs no correction, like the divider's split.
- **Let the transcript alone take the answer's width too.** Rejected: the transcript has no grip of its own, so the user could not change it from there.

## Validation

- Unit tests: `tests/unit/features/live/overlay/panelWidth.test.ts` (columns, alignment, grip side, drag maths, limits), `tests/unit/features/live/CompactView.test.tsx` (the markup: column alignment, natural-width column, the block's share, the strip's minimum, Clear's key, grip side), `tests/unit/core/storage/overlayPrefs.test.ts` (the stored share).
- Measured in a headless browser with the real CompactView (above). No smoke or end-to-end tests were run, at the developer's request.
- For the developer, on the real desktop app after deploy: the six positions with the answer narrowed by the grip, and a window narrower than the bars.

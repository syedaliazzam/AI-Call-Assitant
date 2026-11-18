# ADR-0105: The overlay's answer panel fits the answer (up to 70 % of the screen), and its menus close on any press outside

- **Status:** Accepted (19 Nov 2026, the developer's brief)
- **Date:** 2026-11-19
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §7.3 (version 4.44.0)
- **Supersedes / superseded by:** changes ADR-0082's "panels up to half the display's height" for the answer panel, and ADR-0061's outside-click rule for the overlay's menus; keeps ADR-0061's window fitted to its content

## Context

Two problems with the desktop overlay, from the developer's brief of 18 Nov 2026.

**1. The answer card opened short.** Since ADR-0082 (1.6.4) the window grows to its content only up to half the display's work area, or a height the person once gave it. On a laptop that is too little: the answer panel showed the question, the answer line and two bullets, and the rest scrolled.

We measured the real overlay in headless Chromium on 18 Nov 2026. The test answer was a question, an answer line, five bullets, a Tip and a Note:

| Overlay width | Answer panel | Window (bars + panel) |
|---|---|---|
| 640 (narrowest default) | 507 px | 616 px |
| 768 and 960 | 371 px | 480 px |

Half of a 1080p laptop's work area at 125 % scaling is about 413 DIPs, so a typical answer could not fit.

**2. The ⋮ menu closed only from its own button.** The page closed menus on a `pointerdown` outside them, but:
- the bars are window drag areas (`-webkit-app-region: drag`), where Windows sends the page no pointer events;
- a click in another app left the menu open;
- a press that did reach the page also clicked whatever was under it;
- in Click-through mode, a click on ⋮ gave the keyboard back at once (`releaseFocus`).

## Decision

**Answer height (web + desktop 1.7.1):**
- **Default height:** with an answer shown, the answer panel is at least 380 CSS px tall at 100 % text size (`ANSWER_PANEL_DEFAULT_HEIGHT`, `overlay/answerHeight.ts`). That is the measured typical answer at the default widths, plus a little room. Only the text part (310 of the 380) follows the answer text size. With the bars, the window is 488 DIPs at 100 % zoom. The panel is never taller than the window allows (`min(380px, 100%)`), and the page asks the shell for it (`data-min-height`) even while the window is still shorter.
- **Growth:** a longer answer grows the panel and the window as it streams. While the same answer shows (same panels, zoom, text size and width), the content height the page reports only grows (`holdHeight()`), so the window never jumps up and down. The next answer starts again, so a shorter one shrinks the window back (to the default height at least).
- **Maximum height:** the shell lets the window grow, with the answer panel open, to `answerMaxHeight()` in `windows.ts`:
  - 70 % of the work area's height (`ANSWER_MAX_SHARE`);
  - but at least what a typical answer needs in a 640-wide window (616 DIPs × zoom, `ANSWER_TYPICAL_HEIGHT`), as long as that is no more than 80 % of the work area (`ANSWER_MAX_SHARE_SHORT`).
  
  Below the cap there is no scroll bar; beyond it the answer scrolls. The transcript alone keeps the old half-screen limit.
- **What stays as before:**
  - the top edge stays where it is (on the bottom row, the bottom edge), and the room left below it limits the height, so the window stays inside the work area;
  - a height the person gives the answer layout by dragging an edge replaces the cap;
  - the zoom scales the default and the typical-answer floor;
  - a Ctrl+Alt+Shift+Arrow nudge now refits the height to the room below the window's new top. Ctrl+Shift+Arrow jumps keep the size, as before.
- **One-time reset:** answer heights saved before 1.7.1 were set under the half-screen limit, so they are forgotten once (`overlayAnswerFit`, `OVERLAY_ANSWER_FIT_VERSION`). The transcript and bars heights are kept.
- **Private:** `protection.attach()` re-applies `setContentProtection(true)` on every `resize` while Private is on. Before, it only did this on create and on show.

**Menus (web; the drag-area part needs no shell change):** an open overlay menu or list closes in these cases (`overlay/usePopupDismiss.ts`, `LiveMenu.tsx`):
- a press anywhere outside it: the bars, the panels, the gaps, or the button that opened it;
- the window losing focus (`window` blur: a click in another app);
- Esc;
- choosing an item: a switch, a recording type, a position or a link. Display, Answer preferences and the Model row open more instead of closing.

The closing press is stopped in the capture phase, and its click is swallowed, so nothing under it is triggered. While a menu is open, the root has `k-popup-open`, which turns every drag area off (`theme.css`), so a press on the bars reaches the page. In Click-through mode, a click that opens a menu keeps the keyboard; it is given back when the menu closes.

## Consequences

- A typical answer shows whole on 1080p screens at 100–125 % scaling, at every default width. A short answer leaves empty space in a 380 px card, as a fixed answer window would.
- On a very short screen (work area under about 770 DIPs), the window may cover up to 80 % of the screen for a long answer. It still never leaves the work area.
- People who had resized the answer layout lose that height once.
- While a menu is open, the overlay cannot be dragged. The first press closes the menu.
- Toggling several switches in ⋮ now means opening it once per switch.
- In the browser's picture-in-picture window, the page cannot resize the window. The default panel height and the menu rules apply there too; the window size stays the person's.

## Alternatives considered

- **Fit the content exactly, with no default height.** The panel would start tiny and resize with every streamed line. The brief asks for a card that opens tall enough for a typical answer.
- **A fixed 65 % cap.** At 125 % scaling on a 1080p laptop it is 537 DIPs, below the 616 a typical answer needs in a 640-wide window.
- **Detecting presses on the drag areas in the shell** (`WM_NCLBUTTONDOWN`, `will-move`). This needs a desktop-only path and IPC. Turning the drag areas off while a menu is open is one CSS rule.

## Validation

- **Unit tests:**
  - `apps/web/tests/unit/features/live/overlay/answerHeight.test.ts`: default height, needed height, grow-only hold.
  - `apps/web/tests/unit/features/live/overlay/usePopupDismiss.test.ts`: outside press, blur, Esc, swallowed click, no later click eaten.
  - `apps/desktop/tests/unit/windows.test.ts`: `answerMaxHeight`, growth, cap, top kept, inside the work area, manual height, nudge refit, one-time reset, Private re-applied on resize.
- **Headless check of the real `CompactView` (19 Nov 2026):**
  - window heights 488 (short answer), 488 (typical, 960 wide), 616 (typical, 640 wide);
  - the menu closes on a bar-1 pill without toggling it, on a panel button without triggering it, on ⋮, on Esc, on window blur, after choosing Auto answer, and on a gap click (Display sheet);
  - no drag area while the menu is open.
- **Developer's check on desktop 1.7.1:** the steps in the release summary.

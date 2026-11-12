# ADR-0075: Overlay fixes: bar 1 always fits, the bottom row sits on the bars, Auto on bar 1, one recording warning, nearly solid panels

- **Status:** Accepted (developer's brief, 12 Nov 2026: keep the default overlay size; fix everything inside it; web only if possible).
- **Date:** 2026-11-12
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (overlay)
- **Supersedes / superseded by:** amends ADR-0033 (the opacity setting now paints 92–100 %), ADR-0056 (the bottom row's panels), ADR-0068 and ADR-0070 (the Rec pill's "Visible in recording" words).

## Context

Five problems in the desktop overlay at its default size (980 × 480):

1. Bar 1 had more on it than fits: the red Exit was cut at the right edge, and with a recording running (Rec timer and "Visible in recording") Exit and ⋮ were pushed out of the window. Bar 1 gave way by fixed container widths that did not count the Rec pill, Auto answer or Click-through.
2. On the bottom row the answer panel sat at the top of the window, far from the bars. The panels' area grows to fill the window and lined the panels up with its top (`items-start`). Measured from the bottom edge, the panel then reached the window's top, so the page never asked the shell for a shorter window, and the gap stayed.
3. Auto answer had a floating box of its own beside bar 2 (and a second copy in the answer panel with both panels open).
4. A recording with Private off was announced twice: the warning bar and "Visible in recording" on the Rec pill.
5. The see-through panels let the app behind show through the answer and transcript text. The window cannot blur what is behind it (a page's backdrop-filter only sees the page; Windows uses plain transparency, ADR-0039).

## Decision

1. **Bar 1 measures itself** (`overlay/ControlBar.tsx`). ⋮, Exit, compact, the timer and move sit in a right-hand group that never shrinks. The left-hand group may only clip, never push. Before anything is painted, a layout effect steps through what gives way until the left side fits:
   - the Rec key-cap, then the Screenshot and Chat key-caps, then the Answer key-cap;
   - the words "Transcript" and "Click-through on", and the timer's clock icon;
   - Answer, Screenshot and Chat become icons;
   - "Auto" becomes its bolt;
   - only then does anything go: the Transcript pill (the live words' level button and Ctrl+Alt+T still open it), the move icon (the whole bar drags), and the timer last.

   A ResizeObserver starts again from everything shown when the window or the content changes for another reason. At 980 the words stay. At 560, with recording on, Private off and Auto on, the Transcript pill goes and everything else stays as icons. Every bar button names itself and its shortcut in one tooltip drawn in the page (`data-tip`, never `title`: ADR-0042).
2. **Bottom row:** the panels' area lines its panels up with the bars (`items-end`), and stacked panels are mirrored (`flex-col-reverse`: the transcript nearest the bars). The gap is the same 6 px as on the top row, and the page reports the same content height as on the top row, so the shell fits the window to the panels. No shell change: nudges keep the position (ADR-0056).
3. **Auto answer is a toggle on bar 1** (switch "Auto answer": bolt and "Auto"; green ring, bolt and dot when on, muted when off; tooltip "Auto answer: On/Off"; no shortcut). Same command as before. The floating pill and the answer panel's copy are removed.
4. **One warning:** the warning bar stays, with "Turn Private back on". The Rec pill shows only "● Rec m:ss" and a small amber dot. Screen readers still hear "Visible in recording" in its name. This also applies to the call window's top bar, which shares the pill and has the same warning bar.
5. **Nearly solid panels:** `paintedPanelAlpha()` (`core/storage/overlayPrefs.ts`) maps the opacity setting (40–100 %, and anything lower while fading) onto 92–100 %. The default 82 % paints 97.6 %. The base colour is darker: rgb(17, 17, 20), was 24, 24, 27. The secondary grey is lighter on the see-through panel (`--k-glass-muted` #c4c4cc, was #a1a1aa), key-caps are a little brighter (0.16, was 0.12), and disabled bar buttons fade less (60 %, was 50 %). Sizes and layout are otherwise unchanged.

## Consequences

- Exit and ⋮ can no longer leave the window at any size or in any state. The order in which things give way is fixed and tested.
- The opacity slider still exists, but it now changes little (92–100 %). Its label still shows the chosen setting. Readability over any app was asked for over see-through.
- The bottom row's window shrinks to the panels, as the top row's does.
- Hotkeys, click-through, Private (setContentProtection), answers and recording are unchanged. Web-only change: no desktop release is needed (the shell is unchanged; 1.6.2 stays current).

## Alternatives considered

- **Fixed container-width breakpoints (as before):** they cannot count the Rec pill, Auto, Click-through and the timer's length together. That is how Exit got cut.
- **A strong backdrop blur instead of a solid background:** the window cannot blur other apps; the blur only covers the page itself.
- **Keeping "Visible in recording" on the pill and dropping the bar:** the bar has the one-click fix.

## Validation

- `apps/web/tests/integration/live.spec.ts`, the "1.6.3" tests. They run at 980 × 480 and 560 × 260, with recording on/off, Private on/off and Auto on/off (16 states): bar 1 fits, ⋮ and Exit are whole, every control is present, the timer is short.
  - Tooltips: names and shortcuts, inside the window, below the bar (above it on the bottom row), no `title`.
  - All six positions: the 6 px gap on both rows, the same content height, stacked panels mirrored.
  - Auto toggle; one warning; panel background `rgba(17, 17, 20, 0.976)` and the lighter grey.
- Unit tests: `overlayPrefs.test.ts` (paintedPanelAlpha), `theme.test.ts` (every text token reaches 4.5:1 over pure white at any setting), `PrivateOffWarning.test.tsx` (amber dot, no words).
- Real shell (`apps/desktop/tests/visual/overlay-positions.ts`, 12 Nov 2026, Windows 11, shell 1.6.2 against the rig): all six positions and bottom-row nudges, answer only and both panels, 60 checks passed.

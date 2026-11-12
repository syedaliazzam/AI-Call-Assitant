# ADR-0075: Overlay fixes: bar 1 always fits, readable tooltips, the bottom row sits on the bars, Auto on bar 1, one recording warning

- **Status:** Accepted (developer's brief, 12 Nov 2026: keep the default overlay size and fix everything inside it, web only if possible; amended 13 Nov 2026: keep the panels' look and opacity exactly as before, make the bar's tooltips readable, keep the words at the default size).
- **Date:** 2026-11-12, amended 2026-11-13
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (overlay)
- **Supersedes / superseded by:** amends ADR-0056 (the bottom row's panels), ADR-0068 and ADR-0070 (the Rec pill's "Visible in recording" words). ADR-0033 (panel look and the opacity setting) is unchanged.

## Context

Problems in the desktop overlay at its default size (980 × 480):

1. Bar 1 had more on it than fits: the red Exit was cut at the right edge, and with a recording running (Rec timer and "Visible in recording") Exit and ⋮ were pushed out of the window. Bar 1 gave way by fixed container widths that did not count the Rec pill, Auto answer or Click-through.
2. On the bottom row the answer panel sat at the top of the window, far from the bars. The panels' area grows to fill the window and lined the panels up with its top (`items-start`). Measured from the bottom edge, the panel then reached the window's top, so the page never asked the shell for a shorter window, and the gap stayed.
3. Auto answer had a floating box of its own beside bar 2 (and a second copy in the answer panel with both panels open).
4. A recording with Private off was announced twice: the warning bar and "Visible in recording" on the Rec pill.
5. Amendment, 13 Nov 2026:
   - The first version's tooltips were unreadable. They were drawn inside bar 1's glass piece, a stacking context of its own, so bar 2, the warning and the panels (later in the page) painted over them.
   - With a UI zoom above 100 % (Settings → Zoom is CSS zoom on the page, up to 130 %), the default window showed Answer, Screenshot and Chat as icons, because they gave way before "Auto".
   - The first version also made the panels nearly solid, which the developer did not want.

## Decision

1. **Bar 1 measures itself** (`overlay/ControlBar.tsx`). ⋮, Exit, compact, the timer and move sit in a right-hand group that never shrinks. The left-hand group may only clip, never push. Before anything is painted, a layout effect steps through what gives way until the left side fits:
   - the Rec key-cap, then the Screenshot and Chat key-caps, then the Answer key-cap;
   - the words "Transcript" and "Click-through on", and the timer's clock icon;
   - "Auto" becomes its bolt;
   - only then do Answer, Screenshot and Chat become icons;
   - after that things go: the Transcript pill (the live words' level button and Ctrl+Alt+T still open it), the move icon (the whole bar drags), and the timer last.

   A ResizeObserver starts again from everything shown when the window or the content changes for another reason. At 980 px the words stay in every state (recording, Private off, Auto, Click-through) up to 130 % UI zoom.
2. **Tooltips** (`overlay/BarTooltip.tsx`):
   - One tooltip for bar 1, from each control's `data-tip`, saying its name and shortcut ("Answer · Ctrl+Enter"). Drawn in the page (never `title`: ADR-0042).
   - Rendered into `document.body` (fixed, z-index 1000) so nothing paints over it. Solid dark with white text in every theme (`.k-bar-tip`).
   - Placed below bar 1 (above it on the bottom row), on the other side when that does not fit, and beside its control when neither does (the collapsed bar is the whole window). Shifted sideways to stay inside the window; converted for CSS zoom.
   - The device icons opt out of the window's drag handle so the pointer reaches them.
   - **The move icon keeps the native window drag** (snap zones, drop on the nearest position). Windows sends the page no pointer events over a drag handle, so it shows no tooltip on hover in the desktop app. Measured: 0 pointer moves reached the page with the real pointer on it.
3. **Bottom row:** the panels' area lines its panels up with the bars (`items-end`), and stacked panels are mirrored (`flex-col-reverse`: the transcript nearest the bars). The gap is the same 6 px as on the top row, and the page reports the same content height as on the top row, so the shell fits the window to the panels. No shell change: nudges keep the position (ADR-0056).
4. **Auto answer is a toggle on bar 1** (switch "Auto answer": bolt and "Auto"; green ring, bolt and dot when on, muted when off; tooltip "Auto answer: On/Off"; no shortcut). Same command as before. The floating pill and the answer panel's copy are removed.
5. **One warning:** the warning bar stays, with "Turn Private back on". The Rec pill shows only "● Rec m:ss" and a small amber dot. Screen readers still hear "Visible in recording" in its name. This also applies to the call window's top bar, which shares the pill and has the same warning bar.
6. **The panels' look and the opacity setting are unchanged:** rgba(24, 24, 27, setting), 40–100 %, the same greys and key-caps as before this ADR.

## Consequences

- Exit and ⋮ can no longer leave the window at any size or in any state.
- Every bar control except the move icon shows a readable tooltip in the desktop app. All of them show it in a browser's picture-in-picture window.
- The bottom row's window shrinks to the panels, as the top row's does.
- Hotkeys, click-through, Private (setContentProtection), answers and recording are unchanged. Web-only change: no desktop release (the shell is unchanged; 1.6.2 stays current).

## Alternatives considered

- **Fixed container-width breakpoints (as before):** they cannot count the Rec pill, Auto, Click-through and the zoom together.
- **A page-made drag on the move icon** (so it could take hover): it would lose the native drag's snap zones and its drop on the nearest position.
- **Growing the window while a tooltip shows:** not needed. Every layout but the collapsed bar has room below or above bar 1, and the collapsed bar places it beside its control.

## Validation

- `apps/web/tests/integration/live.spec.ts`, the "1.6.3" tests:
  - Bar 1 at 980 × 480 and 560 × 260, recording/Private/Auto each on and off: it fits, ⋮ and Exit are whole.
  - The words stay at 980 px in every state up to 130 % zoom.
  - Every control's tooltip in all six positions, with Click-through on, in the light theme over a dark page, and in the collapsed bar: right words, solid dark and white, on top at its middle, inside the window.
  - The Opacity setting changes the panels (0.4 → 1).
  - Bottom row: mirrored, same 6 px gap and content height.
  - Auto toggle; one warning.
- Real shell (`apps/desktop/tests/visual/overlay-positions.ts`, Windows 11, shell 1.6.2 against the rig, 13 Nov 2026): six positions, nudges and tooltips at every position, with the answer panel alone and with both panels; 0 failed. With `KITE_REAL_POINTER=1` the real pointer showed the tooltips on Answer and the microphone icon, and none on the move icon (drag handle).

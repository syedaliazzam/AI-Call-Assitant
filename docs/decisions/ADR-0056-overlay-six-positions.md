# ADR-0056: The overlay has six positions, with jump shortcuts

- **Status:** Accepted (shipped in desktop 1.3.0)
- **Date:** 2026-11-09
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (compact view), §7.3 (hotkeys.ts, windows.ts, positions.ts)
- **Supersedes / superseded by:** refines ADR-0035 (presets, edge snapping), ADR-0041 (snap zones along the top) and ADR-0029 (the move shortcuts). Desktop 1.3.0 and the web app, for every account.

## Context

The team wants to put the overlay where a meeting leaves room, quickly and from the keyboard: above the shared screen, or below the faces. Until 1.2.0 the overlay had three places along the top (dragging showed three zones) and moved 20 px per Ctrl+Alt+Arrow press (100 px with Shift), which took many presses to cross a screen.

## Decision

1. **Six positions, a 2 × 3 grid** (`apps/desktop/src/positions.ts`): top-left, top-centre, top-right, bottom-left, bottom-centre, bottom-right, on the work area of the display the overlay is on (the taskbar or Dock is outside it, on whichever side), 16 DIPs from its edges. A window larger than the area stays inside it. All maths is in DIPs and rounded, so display scaling and a second monitor at any offset work the same.
2. **Shortcuts** (global during a call, in the hotkey map and Settings → Hotkeys with conflict detection):
   - Ctrl+Alt+Left / Right: one spot within the row, stopping at the edges (no wrap);
   - Ctrl+Alt+Up / Down: the top or bottom row, same column;
   - the small nudge (20 DIPs) moved to Ctrl+Alt+Shift+Arrows; the bigger nudge is gone;
   - never Ctrl+Shift+Arrows (it selects text by word in other apps).
3. **Dragging** shows all six zones (bottom-row ghosts mirrored); the one nearest to the overlay is highlighted, and the overlay snaps to it on release wherever it is dropped. The zones follow the overlay onto another display.
4. **The ⋮ menu** has a Position row: a 2 × 3 grid, the current one highlighted; a click puts the overlay there at its current size. It replaces Reset position on 1.3.0; older shells keep Reset position.
5. **The bottom row mirrors the overlay:** bar 1 at the bottom edge, the chat bar and bar 2 above it, the panels above them; menus and lists open upward. The window is anchored at its bottom edge: opening panels or a menu grows it upward, collapsing keeps bar 1 where it is, and the icon sits at the bottom edge. The shell tells the overlay's page its position (`kite:overlay-position-changed`), and the page lays itself out from it.
6. **Remembered per display:** the last position on each display (`overlayPositions` in the shell's settings file, by display id); the overlay opens there on that display. A nudge keeps the position (and its row).
7. **Edge snapping after a manual move** now pulls within 8 DIPs (was 16), under the 16 DIP margin, so a window at a position is never pulled onto the edge.
8. **Transcript key:** Ctrl+Alt+T turns the transcript on or off while the overlay's bars have focus (the page's own key handling; never held globally). Settings tries the keys for a moment and reports when another app holds them.

## Consequences

- A 1.2.0 shell keeps its own keys (Ctrl+Alt+Arrows nudge) and three top zones; Settings shows it its own move row. The new web app offers the grid only where the shell has the position methods (`getOverlayPosition`, `setOverlayPosition`, `onOverlayPosition`).
- Settings → Overlay position offers the bottom row on 1.3.0. A 1.2.0 shell refuses the bottom-left and bottom-right names, so they are never sent to it.
- The bottom row's mirrored layout means bar 2 sits above bar 1 there.

## Alternatives considered

- **Keep nudging, with bigger steps:** still many presses, and never exactly aligned.
- **Free placement with a snap-to-edge only:** the reference app and the team asked for fixed places.
- **Ctrl+Shift+Arrows for jumps:** selects text by word in every editor; refused.

## Validation

- Unit (`apps/desktop/tests/unit/positions.test.ts`): the six places with the taskbar at the bottom, top, left and right; two monitors (right, left with a negative x, above with a negative y); fractional work areas at 125 %, 150 % and 175 %; a window larger than the area; nearest position; jumps stop at the edges.
- Unit (`windows.test.ts`, `snapZones.test.ts`, `hotkeys.test.ts`): jumps, the bottom-row anchor (layout, menu, collapse, icon), the ⋮ grid, per-display memory, the IPC check; six zones, nearest highlight, drop anywhere, zones following to another display; key map and the Transcript check.
- Harness (`live.spec.ts`): the bottom row mirrored with the menu opening upward, the Position grid, Ctrl+Alt+T.
- Real shell (`apps/desktop/tests/smoke.spec.ts`, temporary profile): each position 16 DIPs from the real work area, the bottom row growing upward, the overlay page told of each change, a bad name refused, the keys registered.

# ADR-0085: Compact view: side by side, the window follows the zoom, Private before the overlay shows

- **Status:** Accepted
- **Date:** 2026-11-15
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Overlay, compact view), §4 (protection), §7.3
- **Supersedes / superseded by:** revises ADR-0082 in part (the overlay's default size of a third of the display, stacked panels, the status bar's language control); ADR-0055 (popups kept in the window only with account sync)
- **Plan and measurements:** `docs/investigations/2026-11-15-compact-view-plan.md`

## Context

The developer's review of the compact view in desktop 1.6.4 found six problems. Each was measured in the real desktop shell (temporary profile, the overlay rig, invented data; `apps/desktop/tests/visual/compact-view-check.ts`) on a 1920 × 1200 laptop screen at 150 % (a 1280 DIP wide work area).

1. **Private.** The overlay was opened before Private was turned on. After a call that ended with Private off, the overlay was **not protected when first shown**. Measured: protected at show = false. The page turned Private on only after the whole connect. For accounts without account sync, the overlay also kept native `title` tooltips, and the Rec popover's Screen list was a native `<select>`. Both are separate OS windows that `setContentProtection` does not reach.
2. **Language.** Two answer-language selectors (the status bar and ⋮) changed the session's saved language mid-call. Calls are in English.
3. **Transcript toggle.** It was fit step 4 of bar 1's six, so it disappeared in a narrow or zoomed window. Measured: absent at 440 DIP. It also existed only for accounts with account sync.
4. **Transcript at call start.** Closed by default. An answer opening its panel was saved as if the user had chosen it.
5. **Layout.** Side by side needed 900 CSS px, while 1.6.4's default width was a third of the display. Measured: 440 DIP on this screen, so the panels always stacked.
6. **Zoom.** CSS zoom on `<html>` inside a window whose width never changed. Under CSS zoom, `100vh` is scaled too. Measured at 130 %: the page was 739 px tall in a 568 px window, which made the scrollbar; bar 1 dropped to fit step 6 and the panels stacked.

## Decision

**Private (web and desktop 1.6.5).**
- The call page turns Private on **before** it opens the overlay.
- Desktop 1.6.5 also turns Private on for every window before it creates a new overlay window (`windows.ts` `open()`, `deps.allWindows`). The overlay is therefore protected from its first frame even with an older web page.
- `keepPopupsInWindow()` now runs on every desktop page **for every account**, so there are no native tooltips and `<select>` lists are drawn in the page.
- The overlay's own files have no `title=` (a unit test checks this).
- `.k-overlay-root select` uses `appearance: base-select`.
- A quieter amber line, "Private is off: the overlay shows in screen shares · Turn on", shows whenever Private is off during a call. The recording warning is unchanged.
- The per-call consent tick is unchanged.
- OS indicators (the mic-in-use icon, the taskbar button and its thumbnail, the pointer) are out of scope. CLAUDE.md: never hide from the taskbar or OS lists.

**Language (web).** Both selectors are removed from the compact view. The session's language is set in the session as before, and the `language` command remains for the full call window.

**Bar 1 (web).**
- Pinned on the left and never cut: the device icons, the **Transcript** switch (every account) and, while recording, the Rec pill.
- Pinned on the right as before: ⋮ and Exit.
- What gives way, in order: Rec's key-cap → the words "Transcript" / "Click-through" and the clock icon → "Auto" → the move icon → the Click-through toggle (still in ⋮ and on Ctrl+Alt+X) → the timer.

**Panels (web).**
- The transcript is open on a device's first call. It is opened once on devices that stored a choice before (`kite.overlayPanelsDefault` = 2). After that, the user's own choice is remembered (the switch, the level button, Ctrl+Alt+T, its collapse button).
- The answer panel is not remembered. It opens on the first answer of each call.
- **Transcript left, answer right, side by side from 600 CSS px.** A divider sits between them: drag to resize, arrow keys while focused, double-click resets to 40 / 60. The split is remembered per device (`kite.overlaySplit`, 20–70 %). The transcript stays at least 240 px wide and the answer at least 340 px.
- Below 600 CSS px the panels stack (bottom row: mirrored).
- One open panel fills the width.
- The bottom row keeps its rules: panels sit on the bars, mirrored.

**Default size (desktop 1.6.5).**
- 40 % of the work area's width, at least 640 and at most 960 DIP, and never wider than the work area less the 16 DIP margins. Height: half the work area, as before. 1366 → 640, 1536 → 640, 1920 → 768, 2560 → 960.
- `OVERLAY_DEFAULT_SIZE_VERSION` 165 applies it once.
- The panels never change the window's width any more. 1.2.0 to 1.6.4 widened it for both panels to a remembered width, which also pushed a window the user had narrowed back to its earlier width.

**Zoom (web and desktop 1.6.5).**
- The whole window scales. The shell already receives the page's zoom (`OverlayLayout.scale`), so there is **no new bridge method**.
- On a zoom change the width becomes width × z₁ / z₀, about the anchor its position gives (left column: the left edge; centre: the centre; right column: the right edge). The height follows the content, as before, so on the bottom row the bottom edge stays.
- The window stays on the work area; it is never wider than the area less the margins.
- The minimum width is 440 × zoom, so the page is never narrower than 440 CSS px.
- Widths are remembered at 100 % (stored ÷ zoom), so a size dragged at 120 % comes back exactly at 100 %.
- Range unchanged: 80–130 % in 10 % steps.
- In the page:
  - Full-height boxes use `calc(100vh / var(--k-zoom))` (`.k-zoom-screen`).
  - Menus are limited the same way.
  - The page measures its height again on the next frame after a zoom change, and whenever the panels' content changes size.
  - The panels' scroll areas keep room for their scrollbar (`scrollbar-gutter: stable`), so text wraps the same with or without one.

## Consequences

- With side by side at the default size, the overlay covers more of the meeting: 40 % instead of 33 %, and 50 % on a 1280 DIP work area, where the 640 minimum applies.
- Existing desktop users get the new size once, as with 1.6.4.
- Ctrl+= pressed while the meeting is in front now also resizes the overlay window. The zoom keys are global during a call (ADR-0082). This is intended, and the guide says so.
- On a 1.6.4 shell the web changes still work: there is no scrollbar at any zoom, the Transcript switch is always there, and side by side applies from 600 CSS px. The window keeps its width when zooming until 1.6.5 is installed.
- In-page lists and no native tooltips now apply to the dashboard pages of accounts without account sync too (production has `KITE_SYNC_USERS=*`, so no account changes today).

## Alternatives considered

- **`webContents.setZoomFactor`** for zoom. Rejected: Chromium zooms per site, so the home panel and the call window would zoom too.
- **Keeping a third of the width and stacking:** narrower, but the panels never sit side by side on laptops. **50 %:** side by side everywhere, but it covers half the meeting.
- **Tabs (Transcript | Answer) in one panel** below 600 px: hides one panel.
- **Auto-widening the window when both panels open** (1.2.0's behaviour): the window jumped on every answer.
- **Moving the Transcript switch next to ⋮:** simpler, but it moves a control people have learned.
- **Hiding the answer panel's remembered state behind a flag:** unnecessary, since nobody chose it.

## Validation

- Unit tests:
  - web: `overlayPrefs` defaults and migration, split, the status line's Private line, bar 1's pinned group, `PanelSplit`, no `title=` in the overlay;
  - desktop: `overlayDefaultSize`, `minWidthAt`, `zoomedWidth` at all anchors, `setLayout` rescaling and remembering at 100 %, Private on before the window exists, panels never changing the width.
- Integration: `live.spec.ts` (side by side at 640, stacked at 560, the divider's drag / limits / double-click / arrow keys, no language control).
- Real shell: `compact-view-check.ts`, before and after. Pictures are in `docs/testing/v1.6.5-screenshots/`; numbers are in `docs/testing/benchmark-results.md`.
- The developer's manual check: a real Zoom / Teams / Meet screen share with Private on (in the release summary).

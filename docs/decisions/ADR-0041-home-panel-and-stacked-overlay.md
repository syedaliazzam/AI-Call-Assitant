# ADR-0041: A home panel between calls, and stacked bars and panels during one

- **Status:** Accepted
- **Date:** 2026-11-04
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §7.3
- **Supersedes / superseded by:** refines ADR-0029 and ADR-0040; reverses ADR-0030's newest-first transcript; its one Theme setting (default System) is replaced by two by ADR-0054; amended by ADR-0118 (the transcript panel opens under bar 2, which stays)

## Context

The team uses Kite beside calls, and v1.0.4's desktop app opened a 1280×820 dashboard window and a fixed overlay. Item 1 to 12 of the v1.1.0 brief ask for the layout of the tool the team is moving from: a compact panel between calls, and a stack of slim bars with panels that open under them during one. Older installed shells must keep working with the new web app, and a rolled-back web app must keep working with the new shell.

## Decision

**Between calls: a home panel.** The app's first window is a 400×560 frameless window on `/home`, resizable, remembering its place. It lists the sessions (search, sort, cards with type, Transcript chip, status and length) and opens everything else in a normal window. It stays in the taskbar and Alt+Tab like any window.

**During a call: one overlay window, sized by the page.** The main window keeps hosting the call, minimised: audio, speech and answers stay where they are tested, and the overlay reaches them over the existing channel. The page reports which panels are open (`setOverlayLayout`), and the shell fits one window to them, growing downward from a place remembered per display and a height remembered for each set of panels. Bar 2 gives way to the transcript panel when it opens, as in the newest reference frame.

**A separate window for pages during a call.** Dashboard and Edit session open in a side window: navigating the main window would end the call. A Web Lock (`core/live/callLock.ts`) stops a second live page taking the microphone and shortcuts. It is released by the browser if the page dies, so it cannot stick.

**Snap zones.** While the overlay is dragged, a click-through see-through window shows three ghost layouts along the top of the display. Dropping on one places the overlay there. Where a wide overlay on a small screen makes them overlap, the nearest centre wins.

**The order everywhere live is oldest first**, with the newest at the bottom, auto-scroll that pauses while reading further up, and "Jump to latest". Review also defaults to oldest first. The list of answer cards stays newest first, so the latest answer is on screen without scrolling.

**Theme and text size are one setting each**, default System and 100%, covering the home panel, overlay and call window. Working pages (dashboard, wizard, settings) stay light.

**Compatibility, both ways.** Every new bridge method is optional and feature-detected:

- a shell before 1.1.0 gets the fixed overlay, the older menu and no `/home`; it never gets a menu entry that would navigate the call's own window;
- a web app with no `/home` (rolled back) answers 404, and the shell opens the main window, as 1.0.x did.

## Consequences

- Positive: between calls the app takes a corner of the screen, and during a call the panels are only as large as what is open.
- Positive: the call's audio and answer code did not move, so its tests and latency stay comparable.
- Negative: the main window still exists during a call, minimised. Someone who restores it from the taskbar gets the full call window, on purpose (ADR-0040).
- Negative: below 620 px wide the chat box's Auto / For the call / Ask Kite switch is hidden to leave room to type; the last choice still applies.
- Negative: `audio source` on desktop has one option, because Electron's loopback captures all system audio, not one app. The picker shows that as a fact.

## Alternatives considered

- **Separate windows per panel.** Rejected: they drift apart when dragged, and each one needs its own protection, focus and z-order handling.
- **Moving the call into the overlay window.** Rejected: closing or reloading the overlay would end the call, and it would move the most-tested code just to change where it runs.
- **`alwaysOnTop` for the home panel.** Rejected: it would sit over the meeting between calls for no reason.

## Validation

`apps/desktop/tests/smoke.spec.ts` (home panel, its own pages, 404 fallback, side window), `apps/desktop/tests/unit/{home,snapZones,windows}.test.ts`, `apps/web/tests/integration/sim-calls.spec.ts`, and the side-by-side in `docs/testing/v1.1.0-visual-check.md`. A real mouse drag across the snap zones is a human check.

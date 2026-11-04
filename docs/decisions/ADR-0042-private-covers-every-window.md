# ADR-0042: Private covers every Kite window

- **Status:** Accepted
- **Date:** 2026-11-04
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.3, §8
- **Supersedes / superseded by:** extends ADR-0029 and ADR-0040, which protected the overlay only

## Context

v1.0.4's screen-share protection covered the overlay, and the user guide warned that the full call window could show in a share. That is easy to get wrong during a call. The brief asks for one toggle, one state, shown the same way everywhere, covering every window.

## Decision

One setting, `shareProtection`, applied by `setContentProtection` to every Kite window:

- the home panel, main window, side window, overlay and snap zones get it when created, and all of them change at once when it changes;
- every menu and Settings read one state, which reports `scope: 'all'` from shell 1.1.0;
- a shell before 1.1.0 reports no scope, and the info tooltip then says it covers the overlay only;
- it is called **Private** in the menus, off by default, with an info tooltip. The tooltip says plainly that Kite stays in the taskbar and that this does nothing against monitoring or proctoring tools.

**Screenshots.** When Private is off, Kite's own windows are protected for the moment of a screenshot (about 120 ms) and then restored, so the answer is about what is behind Kite and not about Kite.

**Acceptable use.** A one-time notice, in the developer's words, appears on the first window opened on each device, and the same text is in the user guide.

## Consequences

- Positive: there is no window a person can forget about.
- Negative: on Windows it needs version 2004 or later, and on macOS some capture apps may still show the windows. The tooltip says so.

## Limits, by rule

`setContentProtection` only (CLAUDE.md). Kite is never hidden from the taskbar, the Dock or process lists, and does nothing to evade monitoring or proctoring tools. This setting keeps a person's assistant out of what they share; it is not a way around rules about getting help. That is what the acceptable-use notice says.

## Alternatives considered

- **Per-window toggles.** Rejected: more to get wrong, for no benefit anyone asked for.
- **Hiding the windows during a screenshot.** Rejected: they would flicker in front of the person, and focus could move.

## Validation

`apps/desktop/tests/smoke.spec.ts` paints each window type (panel, main, overlay, side) one colour, captures the screen on Windows and counts pixels: none of that colour with Private on, all of it with Private off. Numbers only; the image is never kept. A phone check in a real meeting is a human check.

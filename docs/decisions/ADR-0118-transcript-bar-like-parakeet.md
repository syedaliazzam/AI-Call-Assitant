# ADR-0118: The transcript bar stays all call and always shows the live words (like ParakeetAI)

- **Status:** Accepted (25 Nov 2026, the developer's brief after the team's Mac test)
- **Date:** 2026-11-25
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Overlay, compact view) (version 4.55.0)
- **Supersedes / superseded by:** amends ADR-0041 (the transcript panel took bar 2's place), ADR-0082 (one status bar whose line showed either the words or a warning, and which was the transcript panel's header) and ADR-0085 (the Transcript switch on bar 1 for every account). Keeps ADR-0056 / ADR-0075 (the bottom row mirrors the overlay), ADR-0105 (menus) and ADR-0113 (the bars' column).

## Context

The team tested the Mac app (25 Nov 2026) and asked for the overlay to behave like ParakeetAI's:

- ParakeetAI's second bar shows the other person's words as short phrase chips scrolling in one line ("[What happens when] [I type a] [URL into the] [browser?]"), all the time.
- In ours, bar 2 (the status bar, ADR-0082) showed the words **or** a warning: any warning (a silent microphone, Private off, "Listening…") replaced the words.
- Opening the transcript panel hid bar 2: the panel's header was a copy of the status bar without the words (ADR-0041, ADR-0082).
- Bar 1 also had a Transcript switch (ADR-0085), which did the same as bar 2's level button.

## Decision

Web only. No change to the desktop shell or the bridge.

1. **Bar 2 is the transcript bar and is always there during a call.** From left to right: the green level button, the live words, **Clear** (Ctrl+Shift+Backspace, as before) and a new **expand button** (⤢ `Maximize2`; ⤡ while open). The level button, the expand button and a click on the words all open or close the full transcript panel; **Ctrl+Alt+T** (⌘⌥T on a Mac) still does too, while the bars have focus. Bar 2 has no collapse button any more.
2. **The words are phrase chips in one line.** The live page sends the newest 10 chips (three words each; it sent 6, of which 4 were shown). The line shows them oldest to newest, and when they do not fit it scrolls to the newest; the oldest leave on the left under a short fade. Bar 2 no longer shows the "live question" in their place, so the line never changes shape.
3. **The full transcript panel opens under bar 2.** Bar 2 does not give way. The panel has no header of its own (its controls are on bar 2).
4. **Warnings have their own slim line under bar 2** (`overlay/WarningLine.tsx`). It shows the current message from `statusLine.ts`, with its button, only while it applies: listening paused, "Still in a call?", a voice question listening, a side that cannot be heard, the Answer key held elsewhere, a recording with Private off, Voice mode, the call notices, the answers' notice, Private off, the rename offer, the headphones hint. Order and priority are unchanged. A long message wraps to a second line rather than being cut off.
5. **Bar 1 has no Transcript switch.** The device icons (and the Rec pill while recording) are the pinned left part; bar 1 is narrower by the switch.
6. **Mirroring.** On the bottom-row positions (ADR-0056 / ADR-0075) the warning line sits above bar 2 and the panels above it, as everything else is mirrored.
7. **Collapsed and the other modes keep today's behaviour.** Collapsed to bar 1 (a shell before 1.2.0, which has no icon), a warning that needs the user still shows, now as the slim line alone. The icon and the script bar are unchanged.

## Consequences

- The words are visible in every state of a call, including while a warning shows.
- An overlay with a warning is one slim line (about 36 px) taller than before. The window's height already follows the content (v1.3.2), so the shell needs no change.
- Bar 1 loses about 100 px of natural width (the switch), so it gives way later in narrow windows.
- The panel no longer has its own close button; bar 2's buttons, directly above it, close it.
- On the newest shells (1.2.0 and later, with the icon) there is no longer a way to collapse to bar 1 alone: "Shrink to an icon" is the compact form. Older shells keep bar 1's collapse.
- `liveQuestion` is still in the live page's state but the overlay no longer shows it; it can be removed later.
- Browser picture-in-picture gets the same overlay.

## Alternatives considered

- **Keep the warning on bar 2 and show the words beside it.** Rejected: at 640 px there is no room for both, and the team asked for the words always.
- **Show the warning as a floating toast.** Rejected: a toast would cover the panels and needs dismissing; the line is part of the column and goes when the condition ends.
- **Keep the Transcript switch on bar 1 as well.** Rejected at the team's request: two controls for one thing, and bar 1 is short of room at 640 px.

## Validation

- Unit tests:
  - `tests/unit/features/live/overlay/StatusBar.test.tsx`: bar 2's buttons, chips, no warning on bar 2, the warning line, no Transcript switch on bar 1.
  - `tests/unit/features/live/CompactView.test.tsx`: bar 2 stays with the panel under it, the warning line between them, mirrored on the bottom row.
- Integration: `tests/integration/live.spec.ts` (S13 and the ADR-0118 warning-line test) and `tests/integration/sim-calls.spec.ts`.
- Screenshots before and after at 640 px and wider, in the headless overlay rig (`apps/web/tests/visual/overlay-rig.ts`).
- On the real Mac and Windows apps: the release test (`docs/testing/mac-release-test.md`) and the Windows checklist in the stage report.

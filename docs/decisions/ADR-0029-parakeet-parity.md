# ADR-0029: Match the team's current tool in function and structure

- **Status:** Accepted (developer, 2 Nov 2026)
- **Date:** 2026-11-02
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (live view, compact view), §6 (answers), §7 (desktop shell, storage)
- **Supersedes / superseded by:** none. Changes parts of §5 and §7.3 of the architecture and the default hotkeys.

## Context

The team uses ParakeetAI today. For the switch to feel natural, Kite should offer the same features, workflow, layout structure and hotkeys. The plan, feature by feature, is `docs/design/parakeet-parity.md`.

## Decision

Kite matches **function and structure**, in four phases: the live call, session setup, after the call, and the Prepare tools. It does **not** copy ParakeetAI's visual design, logo, illustrations, wording or brand: it keeps Kite's tokens and copy, and generic icons.

Phase 1 (live call) decisions:

**Overlay.** The compact window becomes the main place to follow a call: three stacked bars (controls; transcript; answer card) with one scroll area and 16–18 px text. Default 720 × 520, smallest 460 × 260.

**Starting a call.** Setting "Start calls in the overlay", on by default: Connect opens the overlay and minimises the main window. Closing the overlay brings the main window back. The main window keeps running the call while minimised, so its renderer has `backgroundThrottling: false`. In a browser, picture-in-picture needs a fresh click, so the page asks for one.

**Translucency is window opacity.** The overlay uses `BrowserWindow.setOpacity()`, kept to a readable range (0.35–1), with an optional fade when the pointer is elsewhere. A transparent window would make the background alone see-through, but Electron's transparent windows have limits on resizing. A browser picture-in-picture window cannot do this at all, so the controls exist only in the desktop app.

**Hotkeys.**
- Global, during a call: Answer, Screenshot, show or hide overlay, move overlay.
- Kite focused only: Chat, Clear, previous and next answer. Previously Clear, previous and next were global. They edit text in every other app, so they must not be.

Settings → Hotkeys lists them and reports any global shortcut another app holds.

**Answer format.** First person, speakable: an answer line, bullets, an optional closing "Tip:" line, and an optional private "Note:" line shown apart and never copied. The tip must never bring up a price, discount or commitment the other person did not ask about: the first version of the prompt did this, and the evaluation caught it.

**Reports.** "Report this answer" stores a flag and the note on the device (`StoredAnswer.reported`). It is never sent anywhere. No database version change: no index uses it.

## Consequences

- The rules block changes, so its hash and every session's first prompt cache entry change.
- **The grader's rubric changes,** because it has to accept "Tip:" and "Note:" lines. The grader is still Sonnet, but scores after this change are not strictly comparable with earlier baselines. Results are in `docs/testing/answer-eval.md`.
- Older desktop installs keep working: every new bridge method is optional, and the page skips what the shell does not have. They do not get the new global overlay shortcuts until updated.
- The overlay no longer shows the Kite lockup: the controls bar has no room for it at its smallest size.
- Whole-window opacity also fades the text, which is why the range stops at 0.35.

## Alternatives considered

- **Keep the compact window as a small companion:** does not give the team the workflow they are used to.
- **A transparent window with a translucent background:** closer to the look, but resizing and window shadows are limited on some platforms. Revisit if the team wants it.
- **Keep Clear and history global:** rejected; they would break typing in other apps during a call.

## Validation

- Unit, harness and desktop smoke tests, with screenshots at the overlay's default and smallest sizes.
- The `answers`, `screenshots` and `lessons` evaluation groups.
- Human checks in `docs/testing/final-test-plan.md`.

# ADR-0026: Screenshots, screen-share protection, the compact view and the learning loop

- **Status:** Accepted
- **Date:** 2026-10-31 (Day 5)
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` (version 3.5.0) §3.3 (adapter), §4 (desktop vs browser), §5 (screens), §7.1–§7.4, §7.6 (learning loop), §10.4 (costs), §13 (risks)
- **Supersedes / superseded by:** none. It adds to ADR-0025 (answer context and learning).

## Context

Day 5 adds what a user needs around the answers themselves:

- **Screenshots.** "What's on my screen and how should I respond?" A slide, code or a pricing table is often the question.
- **A compact view** that stays on top of the meeting app, with the latest line and answer.
- **Screen-share protection**, so a user who shares their screen does not show Kite.
- **Notes after the call**, a review page, and a way for Kite to learn from the user's ratings.

Each touches privacy, cost or the cached prompt, so each needed a deliberate choice. During the day the shared Claude key also reached its Console usage limit, which took every Claude feature in production down until the limit resets.

## Decision

1. **Screenshots never touch the disk.**
   - Desktop: the shell captures only the display the Kite window is on, as a thumbnail already scaled so the long side is ≤ 1,568 px. No full-resolution image crosses IPC. Only the Kite main frame can ask.
   - Browser: the current frame of the share the user started at Connect (no second picker).
   - One encoder (`core/screenshot/prepare.ts`) makes a JPEG ≤ 1 MB; the server checks its bytes (FF D8 FF) and size, and places it uncached before the question.
   - The image exists in memory until the request is sent. It is never saved, never logged; the answer list keeps only a small in-memory thumbnail. Earlier screenshot answers are marked "(answered from a screenshot you can no longer see)".
   - Multiple monitors: one display only (a known v1 limit).
2. **Screen-share protection uses `setContentProtection` only, and is off by default.**
   - A switch in Settings, remembered per device, re-applied every time the compact window is shown. The window says "Hidden from screen share" or "Visible in screen share".
   - Kite never hides from the taskbar, the Dock, Alt+Tab or process lists, and never tries to evade monitoring or proctoring software.
   - Off by default because protection is the user's choice, and because on macOS it cannot be promised (below).
3. **The compact view is a page, not a second app.**
   - Desktop: `/compact/[id]` in a frameless, always-on-top window, shown without taking focus but accepting typing, position remembered. Browser: Document Picture-in-Picture.
   - It talks to the live page over a per-session `BroadcastChannel`. The live page owns the call, the transcript and every Claude request; the compact view only shows state and sends commands. One call, one source of truth, no second Claude path.
4. **Notes are one structured request after the call, saved on the device.**
   - Sonnet, structured outputs, at End without blocking it. Question ratings come from the user's ratings, never from the model. Unclear parts are listed with a time range instead of guessed. At most 3 proposed lessons.
5. **Nothing is learned without approval, and decisions live apart from the notes.**
   - The `lessons` store (schema version 3) holds only approved and rejected decisions. Regenerating notes replaces the notes only. A proposal from the same session with the same normalised text, or ≥ 80% word overlap (the echo filter's longest-common-sequence idea), matches its earlier decision, so it is never asked twice or duplicated.
   - Approved lessons go into the cached rules block under a heading that says they are user preferences, which adjust style and content and never override the rules above. Each is one line of ≤ 200 characters, shown to the user exactly as sent. At most 20, in approval order, so the block changes only when a lesson is approved, edited or removed.
   - Without lessons, the rules block is the Day 4 block byte for byte (pinned by its SHA-256 in a unit test), so the shared cache and the evaluation baselines stay valid.
6. **One Claude key and one Console spend limit (about $20 a month)** for production, development, verify scripts and evaluations. When Claude is unavailable (usage limit or overload), the app says so plainly (`claude_unavailable`) and the transcript and saving keep working. Every paid run is agreed first with its estimated cost; evaluations re-run only the groups a change touches, and the full suite once at release.

## Consequences

- Screenshots and lessons add no stored or logged content beyond what the user approved; logs hold ids, sizes, timings and token counts only.
- The compact view cannot answer by itself: if the live page is closed, it shows nothing new. That is intended; it is a view of the call.
- With lessons, the rules block is per user, not shared: the first request after a lesson change (normally the warm-up when a session opens) pays one cache write.
- Protection results are measured on Windows only. macOS is not verified (no Mac); apps built on ScreenCaptureKit may still capture the window. The Day 6 macOS checks cover it.
- With one key, tests and evaluations spend production's budget. A runaway evaluation could take production down again; the cost estimate before every paid run, `--dry-run`, and evaluating only touched groups are the controls.

## Alternatives considered

- **Full-resolution screenshots, or PNG over IPC.** Larger requests, slower answers and more memory, with no gain: Claude's vision works at ≤ 1,568 px.
- **Protection on by default.** Rejected by the developer: it is the user's decision, and macOS cannot guarantee it.
- **Hiding the window from the taskbar or capture APIs.** Never: that would be evading monitoring.
- **The compact view calling `/api/answer` itself.** Two sources of truth for one call, two caches, and answers that disagree with the live page.
- **Storing proposed lessons and decisions inside the notes.** Regenerate would lose or duplicate them.
- **Lessons in the session block, or in the uncached tail.** In the session block they would change every session's cache key for nothing; in the tail they would be re-sent at full price with every answer.
- **Two keys with a workspace guard** (built and then removed on Day 5). Safer for production's budget, but the team chose one key and one limit for cost and simplicity.

## Validation

- Unit tests: screenshot encoding and validation; the BroadcastChannel; notes request, route and outcomes (`claude_unavailable`); lessons storage and the version-3 upgrade; matching (a reworded lesson); scope, order and the cap of 20; the rules block (byte-identical without lessons; a lesson cannot remove or replace a rule).
- Harness tests in CI: screenshot (fake tab), answers and the browser compact view, review and lessons (`test:review`).
- Measured on Day 5 (`docs/testing/benchmark-results.md`): screenshot capture times and sizes; protection in Chrome 155 entire-screen share (0 of 75,816 window pixels with protection on); 60-minute notes (8.5 s, unclear part listed); the screenshot evaluation group (8.83).
- Queued until the API is available: the notes evaluation (≥ 8), the lesson evaluation (with lessons ≥ 8 and higher than without), the full suite once at release.
- Human checks (end of Day 5): protection with a real meeting app; a real screenshot answer; End → notes → review → approve a lesson → the next session follows it.

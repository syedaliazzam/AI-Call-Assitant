# ADR-0029: Match the team's current tool in function and structure

- **Status:** Accepted (developer, 2 Nov 2026)
- **Date:** 2026-11-02
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (live view, compact view), §6 (answers), §7 (desktop shell, storage)
- **Supersedes / superseded by:** none. Changes parts of §5 and §7.3 of the architecture and the default hotkeys. "Starting a call" is adjusted by ADR-0053 (Connect opens the overlay inside its own click; no second click in a browser).

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

Phase 2 (session setup) decisions:

**Session types.** Interview, Regular and Mock. Sales, Support and Internal become Regular when a device's database upgrades (version 4) and when an older export file is imported, through one set of rules (`core/storage/migrate.ts`). Lessons scoped to the old types move with them.

**Stored style names stay; only the words on screen change.** "Script + bullets" is still stored as `headline+bullets`, "Script only" as `paragraph`, and "Balanced" as `medium`. Only `bullets` and `technical` are new; `friendly` becomes `simple`. Renaming the stored values would change every session's prompt, and every evaluation scenario, for no change in what users get.

**Libraries.** Resumes and Documents are a new store, `library`. A session gets its own copy of what it uses (with `sourceId` saying where it came from), so deleting from a library never changes a past session. Uploading in the wizard adds to the library and chooses the file.

**Job link.** The server fetches a URL a user typed, so it must never reach anything private (`server/job-page.ts`): only http and https on ports 80 and 443; every address a host resolves to is checked, inside the connection's own DNS lookup, so a host cannot change its answer between check and connection; any private answer refuses the host; every redirect is checked the same way; 10 seconds and 3 MB at most. The page is untrusted text: Claude is told to treat it as data, the reply is limited to three fields by a schema, and the user sees and can edit them. Neither the page, the address nor the result is logged. Some sites block automatic reading, and pages built entirely by scripts have no text to read: the user is told, and can paste the details.

**Answer preview.** Written with the real rules on an invented interview, only when asked for, and kept in the browser per combination of settings, so each costs one Haiku request at most, once.

**Answer language and the bullets format live in the session block, not the shared rules.** Answers can be written in another language; live transcription stays English-only. An English session sends no language, so its prompt and cache entry are unchanged. The first version put both rules in the shared rules, and `answers` fell to 8.97 against a gate of 9.03. Moving them restored the shared rules byte for byte, and `answers` scored 9.31. Why the first version scored lower is not established: the scenarios that moved most were 15, 10 and 03, while scenario 05, first suspected, scored 8 in all six runs. The same rules scored 9.18 in Phase 1, so differences of about 0.13 can be noise. Either way, rules used by few sessions belong with those sessions.

**Answer preferences during a call.** The overlay's menu has format, length and tone, sent to the live page as a command and saved with the session. There is no preview there: the overlay is too small, and it would cost a request during a call. A change takes effect from the next answer; that answer misses the prompt cache once, because the style is in the cached session block.

**Icons on the Connect screen** are generic line drawings, not the apps' logos. The video tutorial is a placeholder.

Phase 3 (after the call) decisions:

**Session window.** A side menu of four sections: AI notes, Transcript, Ask AI, Call details. One section shows at a time.

**Transcript.** A chat: Them on the left, You on the right, Kite's answers inline as cards in time order, each with its time, thumbs and "Report this answer". Reports stay on the device with the answer, and are sent nowhere. Clear transcript asks first, and keeps the answers and notes.

**Downloads.** TXT and PDF say the same thing and leave out each answer's private note. The PDF is written by a small module with no new dependency (`core/review/pdf.ts`), using the PDF standard fonts. They cover Western European letters; others, such as Arabic or Chinese in an answer, show as "?", and the page says so and points to TXT. Embedding a font that covers every script would add several megabytes to the page for a rare case.

**Ask AI.** Sonnet, with the rules, the session and the call as three cached blocks and the question outside them, so later questions read the cache. The chat lasts while the page is open and is not stored. Its cost is logged in development only.

Phase 4 (Prepare tools) decisions:

**Mock Interview.** Kite writes the questions with Sonnet from a session's job description and resume, reads each with the browser's own speech synthesis (no paid voice), and listens with the same on-device speech-to-text as a call, so the "audio never leaves the device" rule holds. The browser's own speech recognition was rejected for that reason: in Chrome it sends audio to Google. The microphone opens only after a question has been read, so Kite's own voice is not taken for the answer. Answers can also be typed, which also covers a refused microphone. Feedback uses Haiku, because the user is waiting; questions and the summary use Sonnet.

**Saved as a Mock session.** A finished interview becomes a new, ended Mock session, a copy of the one it came from, which stays as it was. Questions are "Them", answers "You", each feedback one of Kite's answers, and the summary its AI notes, so the dashboard and the session window need no special case. Ending before any answer saves nothing.

**Question Bank.** Sonnet writes at most 12 likely questions for a session, grouped by type, each with a suggested answer in the session's format. An answer the documents cannot support says in square brackets what to add, rather than inventing it. Each session keeps one bank in a new store (`questionBanks`, schema version 5), so reviewing it later costs nothing; writing it again replaces it.

**Skipped by decision:** Resume Maker, Headshots, credits, upgrade, referrals, "Rate us".

## Consequences

- The rules block changes, so its hash and every session's first prompt cache entry change.
- **The grader's rubric changes,** because it has to accept "Tip:" and "Note:" lines. The grader is still Sonnet, but scores after this change are not strictly comparable with earlier baselines. Results are in `docs/testing/answer-eval.md`.
- Older desktop installs keep working: every new bridge method is optional, and the page skips what the shell does not have. They do not get the new global overlay shortcuts until updated.
- **New `answers` baseline: 9.18** (9.17, 9.07, 9.30), accepted by the developer on 2 Nov 2026 although it missed the old gate of 9.28 by 0.10. The format is what was asked for and the rubric changed with it. The next gate is at least 9.03. `screenshots` fell from 8.83 to 8.00, at its limit: a Day 7 evaluation check, not tuned now.
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

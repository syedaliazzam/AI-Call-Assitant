# ADR-0040: v1.0.4 full call window, live question, and one entry per question

- **Status:** Accepted (developer, 4 Nov 2026)
- **Date:** 2026-11-04
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (live session, compact view); version 3.15.0
- **Supersedes / superseded by:** replaces the expanded overlay of ADR-0039 (decision 3); adjusts ADR-0029 (overlay), ADR-0033 (the tab preview's glass strip), ADR-0035 (`expanded` mode removed), ADR-0037 (where the clean question shows)

## Context

The developer asked for the call experience to match ParakeetAI's structure, in Kite's own tokens and wording. ⛶ only made the overlay bigger; there was no way from the overlay to the full view with the transcript and every answer. The history repeated questions, showed raw transcript words, and could show an empty "Press Answer…" state while answers existed.

## Decision

1. **⛶ opens the full call window, the existing main window, instead of a bigger overlay.** One call view at a time: bringing the main window back hides the overlay, and minimising it brings the overlay back. Reachable from ⛶, the words chips, ⋮ "Open call window" and the taskbar or Dock. "Back to compact" and Esc return (Esc only once the overlay has been open in this call; a menu, a dialog or a box with text keeps its own Esc). A new bridge call `showCallWindow` does this; **a shell before 1.0.4 closes the overlay instead**, which already brings the main window back. In a browser the tab is the call window: ⛶ closes picture-in-picture. A browser does not count Esc as a click, so there Esc shows a notice to press Back to compact.
2. **The full call window** has the overlay's top bar across its full width (mic, Answer, Screenshot, Chat, timer, Back to compact, ⋮, End; `LiveAnswers` renders it into a slot in the layout). The transcript is on the left. On the right, a card per question, newest on top: the selected answer expanded with its question in bold, the others collapsed to the question and answer line; a click expands one. The message box with its mic and the big buttons stay. The window is one screen high and each column scrolls: `flex-1` had been cancelling the fixed height since v1.0.2, so the page grew with its content and pushed the message box out of view.
3. **The overlay shows the current live question** above the answer card (`core/transcript/liveQuestion.ts`), updating as it is heard ("…" until it is final), without hesitation sounds. The card keeps the clean question of the answer being viewed. Display only: Answer still picks its own question.
4. **Finding a question in a line** (`questionSpan()`): after a lead-in ("So, um, what…"), or in the middle of a line, which the speech model joins without punctuation ("THAT IS GREAT WHAT PRODUCTION GRADE APPS HAVE YOU BUILT"). The transcript's "?" mark uses it too, so the mark and the live question agree. **Auto-answer keeps its own stricter rule**, so this release does not change when Kite spends a request by itself.
5. **One entry per question** (`core/answer/history.ts`), in the call window, the overlay's history and Review, and its downloads: the same words at any time, or near-identical within 60 s (at least 80% of the longer question's words are shared). The newest good answer shows. Failed answers and screenshots never merge: a failure must stay visible, and two screenshots show different screens. Display only: every answer stays saved, and what is sent to Claude is unchanged.
6. **The question shown** is the clean question, with the raw words on hover only. An answer with no clean question shows the raw words in sentence case, without hesitation sounds, cut after the last question mark.
7. **The latest answer is the default selection**, so "Press Answer…" shows only when a call has no answers. Clear goes back to the latest answer and clears the latest words and the live question; it no longer hides cards, which only ⋮ "Clear answers" does. Opening the call window selects the latest too.
8. **Transparency only in the compact overlay.** The tab preview's control strip in the browser's call view was glass, and it also made the page's background clear (`html:has(.k-glass)`); it is solid now. The full window and Ask Kite have no glass.

## Measured (4 Nov 2026, this laptop, Windows 11, 1920×1080 at 150%, dev desktop shell 1.0.4)

- A simulated call in the real shell against the rig: the real sidebar, layout, transcript strip, answers hook, channel and overlay window, with scripted lines and a mocked `/api/answer`. **41 of 41 on-screen checks pass** (`apps/desktop/tests/visual/call-window-shots.ts`), and every capture was looked at: `docs/testing/v1.0.4-screenshots/`.
- The browser view in real Edge, including the picture-in-picture round trip: 8 of 8 (`apps/web/tests/visual/browser-shots.ts`).
- Found only by running it on screen, and fixed: the question cut to "Have you built?" in the middle of a line; the message box pushed below the fold; "Answer this" doing nothing on a question still in grey.

## Consequences

- **The full call window can be seen in a screen share.** Screen-share protection covers the overlay only (ADR-0026). Moving from the overlay to the full window while sharing shows it. Kept as it is: it was not part of this change, and extending it is the developer's decision.
- **Near-identical merging can hide a genuinely different question** asked within 60 s that differs by few words. A second rule keeps most of these apart ("your experience with Python" and "with Java": the meaningful words must also overlap by at least 50%). The hidden answer stays saved.
- **"The same words at any time" also merges across calls of one session:** a question asked again in a later call shows only its newest answer in that session's history.
- Clearing no longer empties the overlay's card: with answers in the call there is always one to show, as asked.
- The overlay no longer has its own transcript view; clicking the words opens the call window, which has it.

## Alternatives considered

- **Close the overlay and reopen it on the way back, on every shell:** no new bridge call, but a page load on each return, and the overlay's state would be lost. Kept only as the fallback for older shells.
- **The top bar in the answers column, avoiding the slot:** simpler, but it would not read as the window's top bar.
- **Merge when the meaningful words alone overlap by 80%:** it misses "apps" against "applications" and a question still growing, which are the duplicates people see.

## Validation

`tests/unit/core/answer/history.test.ts`, `tests/unit/core/transcript/liveQuestion.test.ts`, `tests/unit/core/answer/format.test.ts`, `tests/unit/core/review/conversation.test.ts`, `tests/unit/core/live/liveChannel.test.ts`, `tests/unit/platform/desktop.test.ts`, `tests/unit/platform/browser.test.ts`; `apps/desktop/tests/unit/windows.test.ts`, `apps/desktop/tests/unit/preload.test.ts`; the on-screen checks above.

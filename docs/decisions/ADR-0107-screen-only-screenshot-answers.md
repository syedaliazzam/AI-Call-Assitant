# ADR-0107: Ctrl+Shift+Enter answers the screen in front: screen-only screenshots, never an old card, never an empty card

- **Status:** Accepted (19 Nov 2026)
- **Date:** 2026-11-19
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §7.2, §7.3 (version 4.46.0)
- **Supersedes / superseded by:** replaces ADR-0043's "without a typed question, the screen goes with what the other person just asked"; extends ADR-0103 (no pointer to the hidden line in a prompt) to the screenshot tails

## Context

The developer reported, from the desktop compact view (one monitor, Private off):

- After switching Chrome tabs, Ctrl+Shift+Enter sometimes answered about an **earlier tab**, with "Didn't catch the question clearly" at the same moment.
- With a coding problem on screen, the answer **described** it and asked whether to answer it.
- On a page comparing two versions, the answer was "This screen shows a chat." with a useless Tip; cards read "Other · From your CV · Screenshot".
- A card stayed **empty** ("…").

What the investigation measured (no code changed while measuring):

- **The capture is fresh.** A test tool running Kite's own `captureScreenshot()` (Electron 44.9.3, the same hide-and-120-ms step) on the real screen: 12 of 12 presses captured the screen at that moment, 5 of them with Kite's in-call system-audio stream held open. During a call a capture is slower (getSources 320–570 ms instead of 145–312 ms; preparing up to 2.9 s).
- **The old-tab answer came from a deleted card.** A screenshot reply typed `garbled` or `none` removed its card (`useLiveAnswers.ts`), so the panel fell back to the newest remaining card: the previous screenshot's answer. Reproduced: an analytics dashboard with the default question came back `[[garbled|kite|docs]]` in 1 of 6 replies.
- **A press during a capture was dropped** without notice (`if (capturing) return`).
- **Spoken lines became the screenshot's question** (ADR-0043): any "Them" line from the last 2 minutes, for example "Can you see it now?", was sent as the question, and the earlier answer to it was added with "Reuse the facts and wording". Reply: "Yes, I can see my screen now. Tip: Want me to start on the merge solution?" (0 of 8 solved, both prompt versions).
- **The fixed question asked for a description** ("What's on screen and how should I respond?"); no screen type fitted a question or task on the screen, so the model invented `screen` or `code` ("Other"); the screenshot tail wrote the `[[type|for|source]]` placeholder and replies copied "for".
- **Version 5 of the Live answers prompt (ADR-0103) is not thinner.** Graded with the new "complete and useful" score (0–2): `answers` previous 36.0 words, complete 1.8, 25/30 full coverage, 9.13; version 5 39.9 words, 1.9, 28/30, 9.50. `screenshots`: previous 60.2 words, 1.7; version 5 64.5 words, 1.8.
- A Voice-mode Ctrl+Alt+Enter screenshot was never cleared, so every later voice question carried it.

## Decision

1. **Screen-only screenshots.** Ctrl+Shift+Enter and the Screenshot button (no typed question) send the session and the screen only (`AnswerRequest.screenOnly`, `core/answer/context.ts` `screenOnlyRequest()`): no transcript, no earlier answer, no spoken question, no document parts; the conversation log is untouched. The server ignores any call sent with one (`server/prompt.ts` `isScreenOnly()`). Its tail (`SCREEN_ONLY_TAIL`) asks for the question or task on the screen to be answered with substance, never only described. Ctrl+Alt+Enter keeps the spoken question; a typed question keeps the screen with it.
2. **Private by default.** A screen-only answer is "Just for you" unless the chat switch says "For the call"; the user's choice of reader now always wins over the model's hidden line (`server/answer-meta.ts` `withChosenTarget()`, measured: the model wrote `call` in 5 of 14 despite the choice). Coding answers keep their "Say:" line.
3. **A screenshot card is never deleted.** A screenshot reply typed `garbled` or `none` is shown as "Unreadable"; the contract says a screenshot is never garbled or none.
4. **A card never stays empty.** A reply with no answer text is asked again once on its card; a second empty reply removes the card with "No answer came back — press the key again." The route logs `emptyAnswer`.
5. **No press is lost.** A press while a capture runs is queued (the newest only) and taken next; a nearly one-colour capture (a page still drawing) is taken once more after 300 ms (`core/screenshot/prepare.ts` `blank`).
6. **A new screen type, `task`**, shown as "Question on screen" (a message that asks something, a quiz or multiple-choice question, a form question). Not `question`: that word is the hidden last line's tag, and measured, the shared name made Claude Haiku open replies with `[[question|…]]` and think aloud. Near-miss type words map to Kite types (`answerTypeOf()`: `code` → coding, `mcq` → task, `screen` → webpage…).
7. **The screenshot tails name the screen types and never point at the hidden line** (a sentence about it made Haiku think aloud about the line: 6/14 replies with it). The default prompt's screenshot section: find the question or task and answer it; multiple choice gives the letter and the option's text; a cause only as a likely one.
8. **Voice mode:** the Ctrl+Alt+Enter screenshot goes with the next question only.
9. **Per-press trace** (the call's timing trace, flags and ids only): `screenshot` (trigger, screenOnly, press, capture and prepare times, a 16-digit hash of the JPEG, bytes, retaken, queued), `screenshot-card` (the card id), `screenshot-done` (type, empty), `screenshot-queued`, `screenshot-failed`. The request carries the press's `traceId`, which the route writes next to its own request id with `screenOnly` and `emptyAnswer`.
10. **Evaluation:** a "complete and useful" grader score (0–2, reported apart from the /10 total), a depth table per question type, an empty-answer check, `--model=sonnet` for comparisons, and a `screen-only` group of 7 scenarios.

11. **Compact view fixes** (the same investigation's sweep; the answer panel's default height stays, as the developer decided):
    - stacked panels (both open, under 600 CSS px): the window asks for every panel's hidden part, and the answer's default height leaves the transcript 7.5 rem (1.7.1 squeezed it to about 10 px);
    - menus, sheets and toasts are measured by content and borders on both rows (the bottom-row ⋮ menu showed two rows; every menu showed a scrollbar at rest), and again when they grow after opening;
    - Click-through: a new transcript line no longer gives the keyboard away and closes an open menu (stable callbacks);
    - picture-in-picture: menus close on a press outside and on Esc, tooltips show, bar 1 refits and Ctrl+Alt+T works (the overlay's own document, window and ResizeObserver);
    - long words and links wrap; one Esc closes a menu only; the Report box belongs to its answer; the footer's "·" wraps with its label; the model popover is clamped for its real width; no bar tooltip while a menu is open; the Voice tip takes its click in Click-through;
    - desktop: a window the person drags fits its height to where it lands.
    Left as they are: keyboard focus order in the ⋮ menu (Tab reaches Exit first), the 550-DIP cap at 150 % scaling (part of the answer-size question the developer kept as it is), and no visible tooltip on the answer arrows (the overlay uses no system tooltips).

## Consequences

- `screen-only` (Haiku): 9.29–9.36; hidden line 14/14; never empty; all private; code runs 4/4; complete 1.7–1.9. The multiple-choice letter is still wrong in 1 of 2 Haiku runs. Sonnet on the same group: 9.86, types 14/14, letter 2/2, complete 2.0, about ten times the cost per answer and slower. Whether screenshots use a stronger model is the developer's decision; nothing changed.
- `answers` gate (mean of 3): 9.27, 9.33, 9.17 = 9.26 (gate 8.86). `screenshots` 8.17 (scenario 16 at 9.5 over 4 more runs), `screenshot-types` 9.14, `call-style` 9.00.
- A screen-only request is shorter than a call answer (no conversation), so it is cheaper and starts sooner.
- Nothing said in the call shapes a Ctrl+Shift+Enter answer any more; for that, Ctrl+Alt+Enter.

## Alternatives considered

- Keep the transcript as labelled background: the developer chose to leave it out (decision 2 of 19 Nov).
- Name the type `question`: measured worse (see Decision 6).
- Rewrite the capture path: not needed; the capture was fresh in every measured press.

## Validation

- Unit tests: `prompt-screen-only.test.ts`, `context.test.ts` (screen-only), `prepare.test.ts` (hash, blank), `answer-meta.test.ts` (`answerTypeOf`), `answer-meta-fallback.test.ts` (`withChosenTarget`), the pinned rules-block hash.
- Behaviour on the headless rig's real call window (fake shell, mocked `/api/answer`): screen-only request after a spoken question; a second press during a capture queued (2 requests); a garbled screenshot reply keeps its card; an empty reply asked again on its card with the same trace id; two empty replies remove the card with the notice.
- Evaluations above (`docs/testing/answer-eval.md`, 19 Nov 2026).

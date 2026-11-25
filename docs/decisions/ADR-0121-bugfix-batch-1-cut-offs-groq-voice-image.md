# ADR-0121: Bugfix batch 1: notes and screenshot answers survive a cut-off, Groq hidden, one image per voice screenshot question, sim-calls current

- **Status:** Proposed (25 Nov 2026; branch `bugfix-batch-1` from `mac-internal-release` @ `6205ad3`, preview only)
- **Date:** 2026-11-25
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (answer cards, model lists, Admin › Usage, Session review), §6 (output limits), §7.2 (`/api/answer` `done`, `/api/notes`), §7.4 (`notes.cutOff`, `answers.cutOff`) (version 4.59.0)
- **Supersedes / superseded by:** amends ADR-0030 (the 1,500-token limit now covers answer and chat only), ADR-0095 and ADR-0101 (Groq is hidden; its switch is no longer shown), ADR-0101 (a voice question with a screenshot is not sent while held). Keeps ADR-0116's approach and extends it to the notes.

Web only. No change to the desktop shell or the bridge, and no change to any prompt text: the live-answer prompt, the notes contract, the notes prompt and their schemas are byte for byte as before.

## Context

The investigation of 25 Nov 2026 (`docs/investigations/2026-11-25-mac-windows-parity-and-backlog.md`, Part D) found:

1. **Notes (D1).** `generateCallNotes()` used `jsonReply()`, which never checked `stop_reason`. A reply cut off at `NOTES_MAX_TOKENS` (4,000) threw a `SyntaxError`, the route answered 502 `internal`, every note was lost, and the after-call runner sent the same paid Sonnet request up to three times, 60 s apart. It could not succeed. This is the bug ADR-0116 fixed for the documents summary.
2. **Screenshot answers (D7).** They shared the 1,500-token limit with every live answer, and the stop reason was logged but never sent to the browser, so a cut-off answer simply ended, often inside its code block.
3. **Groq (D3).** It was switched off on 18 Nov, and 19 of the 20 answers measured on 17 Nov fell back to Claude Haiku because Groq refused them (18 rate limits, 1 request too large). "Groq (Fastest)" still showed, disabled, in every model list.
4. **Screenshot + voice (D5).** ADR-0101 sends a voice question at the first end-of-speech signal, held hidden, and cancels it when the user goes on within 0.3 s. With a Ctrl+Alt+Enter screenshot, every such attempt was a full request carrying the image (about 2,000 input tokens, billed, and counted against the daily limit).
5. **Two sim-calls tests** ("b) coding round", "the voice question") failed on `main` @ `4aba5b5` and on this branch.

## Decision

### 1. Notes survive a cut-off; no paid retry that cannot succeed

- `jsonReply()` (`server/claude.ts`) checks the stop reason before parsing and returns it with `cutOff`:
  - `refusal` throws `ReplyRefusedError` (code `refused`);
  - `max_tokens` throws `ReplyCutOffError` (code `cut_off`, with the output token count). With the new `keepCutOff` option it instead returns the complete part of the reply with `cutOff: true`. The graders do not set `keepCutOff`: half a grade is no grade.
- `server/jsonPrefix.ts` `readJsonPrefix()` reads the complete part. A structured-output reply follows its schema from the first character, so a reply cut at `max_tokens` is the start of valid JSON. Every finished value is kept; the string, number or array element being written is dropped. So `{"summary":["a","b` reads as `{ summary: ['a'] }`.
- `generateCallNotes()` keeps every well-formed complete item (`modelNotesOf()`) and marks the notes `CallNotes.cutOff: true`. The schema's sections come summary, questions, next steps, unclear parts, lessons, so a cut loses the later ones first. Only a cut before the first complete summary bullet is an error (`cut_off`).
- The route logs `stopReason` and `cutOff` with every `notes: done`, and `outputTokens` on a `cut_off` failure. It never logs text.
- The after-call runner treats `cut_off`, `refused` and `bad_request` as final (`NotesOutcome.final`): the same request would fail the same way. Rate limits, timeouts, overloads and network failures are still retried, as before.
- The session review, the Meetings notes tab and the notes PDF show "These notes stop early: the reply reached its length limit, so later questions, next steps, unclear parts or lessons may be missing."
- `NOTES_MAX_TOKENS` goes from 4,000 to **8,000**. Measured: a 60-minute call's notes are 615 tokens, and Sonnet writes about 165 tokens a second, so 8,000 tokens take about 50 s, inside the 110 s request limit and the route's 120 s.
- Ask AI, Prepare and job import also call `jsonReply()`. They get the typed errors, with codes `cut_off` and `refused` instead of `internal`, and no other change.

### 2. Screenshot answers have room for a whole coding answer, and a cut-off is shown

- `SCREENSHOT_MAX_TOKENS = 4,000` for mode `screenshot` (`liveMaxTokens()` in `server/prompt.ts`). Answer and chat stay at 1,500, so their requests are byte-identical; Ask AI keeps its own limit. Measured on an invented Java problem: cut off at 1,500 in 2 of 2 runs with the code block left open; 1,995–2,437 tokens when allowed to finish. 4,000 is about 1.6 times the longest. Only written tokens are billed, and Sonnet writes 4,000 tokens in about 25 s, inside the 60 s limit.
- The `done` event carries `cutOff: true` when the stop reason is `max_tokens`, for any live or Ask AI reply (never for a warm-up, which stops at `max_tokens` 0 by design). Groq, Gemini and OpenAI map their length stop to `max_tokens` already.
- The browser keeps `cutOff` on the answer and saves it (`StoredAnswer.cutOff`). `AnswerBody` ends a cut-off answer with "Answer cut off: it reached its length limit, so the end is missing.", in the call panel, the overlay (through the live channel) and the review. The code that arrived still shows as a code block with Copy.

### 3. Groq hidden, kept dormant

- `HIDDEN_ANSWER_MODELS = ['groq']` (`packages/shared`). Groq has no row in the one choices list behind the wizard, Settings and the overlay chip and ⋮ → Model, and it is always "off". A leftover Groq session is named Claude Haiku.
- A session or default set to Groq moves to Claude Haiku (the default) on the dashboard and in a running call, whatever Groq's switch says. A running call asks for Claude Haiku from its first answer (`offeredModel()`).
- Dormant, not deleted: `server/groq.ts` and the answer route's Groq path stay behind their admin switch (`groq_model_enabled`, off). The switch is no longer shown on Admin › Usage; its server action is kept. The Groq usage column stays.
- Bringing Groq back: remove it from `HIDDEN_ANSWER_MODELS`, add its list row and the switch again, and re-measure (investigation D3).

### 4. A voice question with a screenshot is sent once

- With a Ctrl+Alt+Enter screenshot waiting, the held attempt sends nothing (`shotWaiting` in `LiveAnswers.tsx`). The question goes once, with the image, when it is shown: at most 0.3 s later, or at once on a strong end of speech (Flux EndOfTurn, the fallback). A cancel before that has nothing to cancel.
- Voice questions without a screenshot keep ADR-0101's early send.
- Extending a shown question (more words within 1.8 s) is a new answer on the same card and still sends the image again, as before.

### 5. sim-calls check what ADR-0107 and ADR-0101 decided

Both failures were stale tests, not pipeline bugs or timing:

- **"b) coding round"** (written 4 Nov) expected the "Them" line just said as the screenshot's question. ADR-0107 (19 Nov) made Ctrl+Shift+Enter screen-only on purpose. The test now checks `screenOnly`, no question, and that the line is not sent.
- **"the voice question"** (written 5 Nov) expected nothing sent before 1.5 s. ADR-0101 (18 Nov) sends at the first end-of-speech signal, held hidden for 0.3 s; 1.5 s is only the fallback. The test now checks the question is sent once and never asked again after the hold.

## Consequences

- A very long call's notes keep everything complete before the limit and say they stop early, instead of nothing after three paid failures. A notes failure the same request would repeat is paid for once.
- Long coding screenshots get whole answers. A runaway screenshot reply can cost up to 4,000 output tokens (about $0.002 on Haiku, $0.04 on Sonnet), against 1,500 before. When a reply is still cut off, every view says so.
- Nobody can pick Groq. Old Groq sessions answer with, and now say, Claude Haiku. The privacy page still lists Groq as a provider: Groq can return only by a code change, and the page is the developer's to edit.
- A screenshot voice question shows up to 0.3 s later than a voice question without one when the end of speech is a weak signal, and the image is sent once per real answer.
- `CallNotes.cutOff` and `StoredAnswer.cutOff` are optional fields. Older records read as complete, and older pages ignore them. No storage version change.
- All sim-calls tests pass (11, with the new screenshot + voice test).

## Alternatives considered

- **Plain-text notes, as ADR-0116 did for the summary.** Rejected for this batch: it changes the locked notes contract (ADR-0089) and the default notes prompt, so the ADR-0087 change notice would fire, admins' custom notes prompts would need checking, and the notes would need a full re-evaluation. Reading the complete part of the structured reply gives the same result (whole items kept, a clear "stops early") with no prompt change.
- **Retry a cut-off notes request with a larger limit.** Rejected: it pays twice for the same notes, and the complete part is already useful.
- **Retire Groq like Gemini 3.6 Flash (`RETIRED_ANSWER_MODELS`).** Rejected: a retired model is answered by Claude Haiku on the server whatever its switch says. The developer asked for the Groq path to stay dormant behind its flag.
- **`cache_control` on the screenshot (investigation D5's proposal).** Rejected for this fix: a cancelled attempt would still be a billed request (cache write, then reads at 0.1×) counted against the daily limit, and it would use the fourth cache breakpoint in every path. Not sending the held attempt costs nothing.
- **Keep sending the held screenshot attempt and reuse its reply.** Not possible: the reply is for the shorter question.
- **Delete the two failing tests.** Rejected: they cover the screen-only request and the voice timing, which ADR-0107 and ADR-0101 depend on.

## Validation

- **Unit tests:**
  - `tests/unit/server/jsonPrefix.test.ts`: a whole document reads as with JSON.parse; every possible cut of a notes reply keeps only whole items; strings, escapes, numbers and literals cut mid-way; text that is not JSON.
  - `tests/unit/server/claude.test.ts`: the stop reason; cut-off with and without `keepCutOff`; refusal; `cut_off` and `refused` codes.
  - `tests/unit/api/notes.route.test.ts`: 8,000 tokens; a cut-off reply's notes with `cutOff` and the stop reason logged; 502 `cut_off` with the token count; 502 `refused`.
  - `tests/unit/core/notes/generate.test.ts` (final codes; `cutOff` saved), `tests/unit/core/live/afterCall.test.ts` (no retry on a final failure), `tests/unit/core/drive/callFiles.test.ts` (PDF line).
  - `tests/unit/api/answer.route.test.ts` (screenshot 4,000, answer and chat 1,500, `done.cutOff`), `tests/unit/core/answer/answerClient.test.ts` (`cutOff` passed on), `tests/unit/features/answers/AnswerBody.test.tsx` (the line; an open code block still shows).
  - `tests/unit/core/session/modelChoices.test.ts`, `retireModels.test.ts` (Groq moves with its switch on; `offeredModel()`) and `tests/unit/features/live/overlay/ModelChoice.test.tsx` (no Groq row).
- **Integration:** `pnpm --filter web test:sim-calls`, 11/11, including "ADR-0121: a screenshot voice question the user talks over sends the image once" (2 image requests before, 1 after); `test:live-ui`, `test:answers`, `test:screenshot`, `test:review`.
- **Paid checks (25 Nov 2026; numbers in `docs/testing/benchmark-results.md`):**
  - `eval:notes` 9.78 before, 9.78 after;
  - `verify:notes` PASS (615 tokens, 5.3 s);
  - a forced notes cut-off at 300 tokens kept 4 summary bullets, 2 questions and 2 next steps;
  - the long Java screenshot completed at 4,000 (2/2) and was cut off at 1,500 (2/2), with first-text times unchanged.
- **For the developer on the preview:** the check list in the batch summary (a long coding screenshot ends with no cut-off line; Groq is in no list; an old Groq session shows Claude Haiku; Ctrl+Alt+Enter with a question spoken in two parts shows one answer).

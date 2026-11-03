# ADR-0037: Clean question as a hidden last line, a calmer answer card, and per-speech idempotent Answer

- **Status:** Accepted (developer, 3 Nov 2026)
- **Date:** 2026-11-03
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (answer card), §6 (stream format); version 3.13.0
- **Supersedes / superseded by:** extends ADR-0030 (hidden first line) and ADR-0032 (v-previous rollback, unchanged); widens the v1.0.1 repeat guard

## Context

A real call showed three readability problems on the answer card, and one remaining risk of duplicate answers:

1. The card's "Question" was the raw transcript the question was picked from (fragments, misheard words, no punctuation).
2. Answers opened with filler ("I can hear you clearly") and carried meta lines about the other person ("if they want more depth…").
3. The type label and source tag sat between the question and the answer, competing with it.
4. The v1.0.1 guard ignored a repeat only for the same question text within 3 s. Auto-answer did not know about questions answered manually, so a manual answer that took longer than 3 s was answered again by auto-answer; and the same speech with slightly different words (words settling, the accurate engine rewriting a line) counted as a new question.

Changing the stream format is risky: a stream change on 3 Nov 2026 left answer cards stuck on "…" (fixed in v1.0.0 with a fail-safe and recorded-stream tests).

## Decision

1. **The cleaned question is a hidden LAST line**, `[[question|…]]`, written by Claude after the answer in the same request (no extra call). The developer chose the end over the first line so the first word is never delayed. The server removes it (`createQuestionLineFilter()` in `@kite/shared`, used by `withAnswerMeta()`) and sends it as a `question` event after the words and before `done`. The card shows the raw words in sentence case until it arrives, then the clean question; the raw words stay on hover. It is saved with the answer (`cleanQuestion`).
2. **Fail-safes.** Text without "[" passes straight through. Text is held only from a "[" that could still start the line, and only until that is clear: a different character, a line break, 240 characters, or the end of the reply. A hidden line that breaks (line break before "]]"), runs past the limit or never closes is dropped, never shown. The answer formatter (`splitAnswer()`) also drops any line starting "[[", as a second net. The first hidden line keeps its 3-field form, so v-previous replies (no last line) are unchanged.
3. **Rules (current version only; v-previous is byte-for-byte unchanged):** the hidden last line; start with the answer itself, no filler opener and no remark about the audio unless asked; every line is words to say, never a line about the other person; depth only as the Tip. A stray depth-offer line is shown as the Tip (`splitAnswer()`).
4. **Answer card:** the answer line 19 px bold; bullets 15–16 px, evenly spaced; "Tip:" on its own muted line; the type and source tags at 12 px in the footer with how it was asked, the time, 👍 / 👎, Copy and Report. The main window and browser split view list the answers newest first (ADR-0030 order); the overlay keeps one card with ←/→.
5. **Per-speech idempotent Answer** (`core/answer/repeatGuard.ts`): each answer remembers the time span of the "Them" speech it was for. Auto-answer never answers speech already answered; a manual press (shortcut, overlay, "Answer this") for answered speech within 10 s shows the existing answer instead; after 10 s it is a deliberate new answer. The 3 s same-text window and "one at a time while streaming" stay. A re-answer with a chosen type is deliberate and not guarded.

## Consequences

- The first word is unaffected by the clean question. Measured on 3 Nov 2026 (3 real answers, this laptop, direct to the API through the route's pipeline): first word 1,624 ms (the first request after the rules change, which also writes the new rules cache), then 871 ms and 940 ms; every answer carried the question line. Cost $0.0010.
- The rules change (current version) is not evaluated: the developer asked for no paid evaluations in v1.0.2. v-previous remains the rollback.
- The clean question arrives only when the answer is complete, so the card changes once, at the end.

## Alternatives considered

- **A 4th field in the hidden first line:** delays the first word by the question's tokens; rejected by the developer.
- **A second Claude call to clean the question:** extra cost and latency; rejected.
- **Cleaning the question in the browser only (sentence case):** kept as the fallback; cannot fix misheard words.

## Validation

- `tests/unit/server/answer-question-line.test.ts`: every split point of a reply; text never held without "["; code and links pass through; broken, over-long and unclosed lines dropped; v-previous replies unchanged.
- `tests/unit/core/answer/recorded-stream.test.ts`: the three v1.0.0 recordings and three v1.0.2 recordings (`tests/fixtures/answers/real-stream-v102-*.sse`, made with `pnpm --filter web record:streams`) replayed at 1, 7, 64 and 100,000-byte pieces: meta, words, question, done; no "[[" in the text.
- `tests/unit/core/answer/repeatGuard.test.ts`: auto-answer after a slow manual answer; settling words; 10 s window; new speech.
- Human check: the answer card on a real call (`docs/testing/final-test-plan.md`).

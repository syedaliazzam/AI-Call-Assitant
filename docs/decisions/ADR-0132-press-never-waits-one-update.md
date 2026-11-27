# ADR-0132: A press never waits; a press made mid-speech is updated once

- **Status:** Accepted (released 28 Nov 2026)
- **Date:** 2026-11-28
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` (4.70.0) §6.1
- **Supersedes / superseded by:** amends ADR-0070 (the 8 s press wait) and ADR-0076 rule 2 (the 300 ms catch-up)

## Context

On a real Mac call (27 Nov 2026) the user pressed Ctrl+Enter while the other person's question was still being transcribed. The press answered only the statement before it and was never asked again (with auto-answer off, ADR-0079 D1 re-asks only presses on grey words). With cloud transcription a press also waited up to 300 ms for the "Them" socket to catch up (measured 27 Nov: 238 ms median, 300 ms at p90, the cap hit 23% of the time); the on-device path waited up to 8 s for a grey line that was not yet a question.

## Decision

- A press answers at once with the final and grey words there are (no catch-up wait, no 8 s wait; `pressQuestion.ts` no longer returns 'wait').
- A press made while the other side was speaking (a grey line, or their newest words ended under 2 s ago) is watched (`newestQuestion.ts` `pressUpdateDue()`): when their new words started within 2 s of the press and their turn is over, the card is asked again once, in place, with no notice; it keeps its earlier answer until the new answer line is complete (no blank card). Nothing is updated once the user speaks, when the new words start later (a new question: press again), or after 8 s.
- Rule 6 (ADR-0076) no longer re-asks a press on the cloud path; the watch does.
- The request is production's: the question is the other side's words since the newest answered speech and the user's last reply, grey ones included; the watch's window (`pressWindow()`) stays on the device.

## Consequences

- Time to the first word loses the catch-up wait (about 240 ms median) on Deepgram calls, and up to 8 s on the on-device path.
- At most one extra request per press made mid-speech.

## Alternatives considered

- A longer catch-up (400 ms): fewer capped waits, but still a wait on every press.
- Re-asking on every later word: answers would change under the user while they read them.

## Validation

Unit tests (`pressWindow.test.ts`, `pressQuestion.test.ts`, `newestQuestion.test.ts`). Key-press evaluation (`scripts/eval-press.ts`, 25 invented snippets, code-checked, `docs/testing/answer-eval.md` "Key-press group") against production code the same day, and the full `eval:answers --guard` suite against same-day production. Cut-off cases ("question still being said") passed 3/3 before and after.

# ADR-0133: A press answers every open question in one natural reply

- **Status:** Proposed (the prompt round; not released)
- **Date:** 2026-11-28
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6.1 (version bump when released)
- **Supersedes / superseded by:** amends ADR-0076 rule 3 and rule 5 for presses

> **Not in the 28 Nov 2026 release.** That release keeps production's request and prompt (the press window stays on the device for ADR-0132). This decision is the first step of the separate prompt round, released only if it passes the full gate.

## Context

On the 27 Nov 2026 call a press sent the newest 200 words of the other side as one "question" (about 45 seconds of talk with two questions in it); the answer took the earlier one, and the card showed the raw words as its question because the hidden question line did not arrive.

## Decision

- A press sends everything the other side said since the newest answered speech (at most 3 minutes back); the user's own reply no longer ends it: the model checks which questions the user already answered out loud (the user's lines are in the conversation).
- The locked contract (not the prompt tail, ADR-0107) says: answer every open question in one natural reply the user can say, in the order asked, with spoken transitions, never labels, numbering or a block per question; a yes-or-no one gets its yes or no first (unless the unsupported-fact rule applies); about 2–4 short lines for one, 4–6 for two or three; with four or more, the most important (put to the user first, then the newest), then a muted "Also asked:" line the next press answers (`decideNewest()`, `splitAnswer().alsoAsked`, `AnswerBody`, PDF). A press with nothing asked replies to what most needs a reply; "none" is only for talk about the call itself.
- The tail keeps production's line "Question to answer: …", with a short note when they were still speaking or for questions left open (`prompt.ts` `questionLine()`); the hidden question line is unchanged.
- A card with no clean question shows at most 12 words of the raw words (its newest sentences).

## Consequences

- Several questions are answered on one card; the user can press again for the rest.
- Measured 27–28 Nov: a separate block of the words in the tail, instructions at the end of the prompt, or any change to the hidden question line's wording made Haiku write its hidden lines in the wrong order or think aloud (as ADR-0107 found); none of these is used.

## Alternatives considered

- One labelled line per question: rejected by the developer (28 Nov) for one spoken reply.
- Picking the open questions in code: whether the user already answered a question out loud needs the model.

## Validation

Key-press evaluation (`scripts/eval-press.ts`, 25 invented snippets, code-checked, `docs/testing/answer-eval.md` "Key-press group") against production code the same day, and the full `eval:answers --guard` suite against same-day production.

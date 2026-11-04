# ADR-0043: Only real questions are answered, and each kind of screen has its own shape

- **Status:** Accepted
- **Date:** 2026-11-04
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6.1
- **Supersedes / superseded by:** changes the merging rule of ADR-0040; extends ADR-0030's shapes

## Context

Pressing Answer used to answer the latest words, whatever they were: "say yes when you're ready", a greeting, or noise that speech recognition turned into words. Answers from different calls of one session could merge into one card. Screenshot answers had one shape for every kind of screen.

## Decision

**Two nets for what Answer answers.**

1. Rules, in `core/transcript/questionKind.ts`, spending no request. Greetings and instructions are skipped, back to the last real question of this call. Noise gets "Didn't catch the question clearly — press Answer again or type it", and a second press sends it. With only greetings, nothing is sent. The rules lean towards "question", because refusing a real one is the worse mistake.
2. Claude's hidden type, `garbled`, for what the rules let through. It replies with only its two hidden lines, and the person gets the same notice. Those lines then leave every later question.

"Answer this" on a bubble and a typed question always go through: that is someone asking.

**A question already answered is not part of the next one**, even with no reply in between. "How did you test it" answered, then "why Go" asked, is "why Go". With nothing new, Answer goes back to what is there.

**One entry per question:** overlap of 80% or more, within 60 seconds, in the same call only. Different calls never merge, and the same question asked later in a call gets its own entry.

**The answer line is 12 words or fewer, not counting a label, as the card shows it.** The prompt asks for it, and the card cuts a longer line at a clause or before a word that starts a phrase, into the first bullet, with no extra request; a finished one-line answer of 30 words or fewer is cut too. A line with no such break stays whole. The gate (the developer's decision, 4 Nov 2026, after the raw gate failed its one fix) is that at least 95% of lines **as shown** are within 12 words. What the model wrote is measured and reported beside it.

**The general reminder keeps v1.0.4's words.** Tighter wording was tried and measured: raw lines got no shorter (43% to 56% within 12 words across the groups) while answers got less careful, with scores below their gates (answers 8.67, cv-embellishment 6.50). Haiku does not count words reliably, so the card enforces the limit rather than the prompt. The coding, screenshot and small-talk rules still state it, because those lines have no other limit.

**The coding shape** is the approach as the answer line, then Key steps, one block of code that runs, Complexity, and one line on how to explain it.

**Screenshots name what is on screen** as the type in the first hidden line, and answer in the matching shape: `coding`; `codefix` (cause, fix, corrected code); `slide` and `document` (key points, how to respond); `table` (takeaway, key numbers); `webpage`; `unreadable` (one line saying so). Without a typed question, the screen goes with what the other person asked in the last two minutes.

v-previous keeps its own screenshot text word for word, so the Answer style version switch still sends what its baselines were measured on.

## Consequences

- Positive: fewer wasted requests, and no confident answers to noise.
- Negative: a rule can misjudge a question worded like a greeting. "Answer this" is always there for that.
- Negative: Haiku runs over 12 words about 44% of the time, so the card's cut is doing real work, and a cut line can read slightly less naturally than one written short.

## Alternatives considered

- **A separate Claude call to classify each line.** Rejected: it adds a request and latency to every press, to decide what rules and one hidden field decide for free.
- **Dropping noise silently.** Rejected: the person pressed a key and must learn why nothing came.
- **Cutting a long line in the middle of a clause.** Rejected: it reads worse than one long line.

## Validation

`tests/unit/core/transcript/questionKind.test.ts` (a table of 60 or more lines), `tests/integration/sim-calls.spec.ts`, and the paid groups `question-detection` and `screenshot-types` (`tests/eval/groups/detection.ts`), with code run in the sandbox. Results are in `docs/testing/answer-eval.md`.

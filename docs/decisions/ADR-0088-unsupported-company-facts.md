# ADR-0088: Unsupported company facts get a short promise, not an answer

- **Status:** Accepted
- **Date:** 2026-11-16
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.2 (version 4.29.0)
- **Supersedes / superseded by:** none. Builds on ADR-0032 (honesty rules, v-previous) and ADR-0084 (experience rules).

## Context

In the `answers` group, scenario 08 asks "Do you host our data in Germany and are you ISO certified?" with only a price list. On 16 Nov it scored 6.67 (7, 5, 8), and in one run both answers invented a German hosting option and an ISO certification. Scenario 14 asks for a per-seat price with no documents. It scored 7.5, with "I don't have the per-seat pricing" said aloud and answer lines of 14–24 words. The core rules already forbid all three things. Fresh answers (12 of each, not graded) showed why they happened anyway. For a company fact the session cannot support, three instructions pull against each other:

1. **"The answer line answers the question directly."** On a yes/no question this invites "Yes, …", which is where the invented facts started.
2. **"Headline, then 2 to 4 bullets."** With nothing true to say, the model filled the bullets with invented details: hosting options, "pricing depends on the plan", "any discount that applies". The unsupported-fact rule says to answer "in the session's format", which keeps those bullets.
3. **The reminder right after the question,** which the fast model follows most closely, covers missing CV details ("leave out a detail you lack…, never promise to look up or send…") but not company facts. So the model either asserted something or explained what it lacked. The core rules' own example ("I'll confirm the exact uptime commitment and send it after the call.") showed a line that repeats the subject, which the model copied into 14–16-word answer lines.

## Decision

**1. One sentence at the end of `CALL_REMINDER`** (the uncached tail of every current-rules live answer). It applies when they ask about your company or offer for a fact the session, documents and call do not give (a price, where data is hosted, a certification, a term, a date). In that case the answer:

- never says yes or no, and never guesses;
- after the hidden first line, is only a short promise of at most 10 words that does not repeat the question ("I'll confirm the price and send it after the call.", "I'll confirm both and send them after the call.");
- has no bullets at all, which overrides the answer format and the question's shape;
- ends with a "Note:" line naming what to check, then the hidden `[[question|…]]` line.

Small talk and off-topic questions are excluded.

**2. In the core rules, only the example's answer line changes,** to "I'll confirm that and send it after the call."

Two details of the wording came from measurement:

- **The hidden lines' order is stated in the sentence.** Without it, the hidden first line moved to the end of the reply in 9 of 30 answers, mostly in the multi-turn scenarios 04–07.
- **Small talk and off-topic questions are excluded.** Without that, scenario 13 (a lunch tip) started promising to "check and send a recommendation".

The rollback rules (v-previous) are unchanged. `BUILT_IN_REVISIONS.live` gets the new hash (same release day), and so does the pinned rules-block hash.

## Consequences

Measured on 16 Nov 2026. Before: three runs on the ADR-0086 wording. After: the final wording.

| | Before | After |
|---|---|---|
| 08 (graded) | 6.67 (7, 5, 8) | 8.7 (3 runs); 9.5 and 7.5 in the regression runs |
| 14 (graded) | 7.50 (6.5, 7, 9) | 10.0 (3 runs); 10.0 in the regression runs |
| `answers` overall | 9.07 (3-run mean) | 9.13 (1 run) |
| Grader found nothing invented | 73/90 (81 %) | 29/30 (97 %) |
| Answer line 12 words or fewer | 36/83 (43 %) | 15/26 (58 %) |
| Hidden line present | 86/90 | 30/30 |
| What's missing said aloud (08 and 14) | 8 of 12 graded answers | none of the 6 graded or 8 ungraded |

- **Remaining:** for a single fact, 14's answer line is still "I'll confirm the per-seat price for forty users and send it after the call." (14 words; that scenario allows 15). Pushing the wording further ("name it in at most two words") broke the hidden first line in 2 of 6 answers of 08, so it was dropped.
- **The grader marks 08's answer down for style:** it has no bullets, and "both" is vague. This is the price of removing the bullets that carried the invented facts. The Note line names what to check.
- **One sentence more** in the uncached tail of every live answer (about 120 tokens).
- **A custom full prompt (ADR-0086) does not get this change.** The built-in change notice (ADR-0087) tells its admin.

## Alternatives considered

- **Changing the cached core rules' "When information is missing" section.** It is a larger change to the block every scenario shares, which has moved unrelated answers before (ADR-0084). The tail sentence sits next to the question, where the fast model follows it.
- **Allowing one bullet that restates the promise.** Bullets were where the invented details appeared.
- **Detecting unsupported questions in code.** Whether the documents support a fact is a judgement about meaning, which the model makes better than a rule in code.

## Validation

- `tests/unit/server/prompt-unsupported-fact.test.ts`: the sentence's content and order, examples of 12 words or fewer, present in current-rules tails and absent from rollback tails.
- `builtInPrompts.test.ts` and `prompt-lessons.test.ts` carry the new hashes.
- `docs/testing/answer-eval.md` (16 Nov 2026, ADR-0088): the iterations, the graded runs of 08 and 14, and the `answers` group. Spend $0.31 (cap $1).

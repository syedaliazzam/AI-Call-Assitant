# ADR-0090: The "confirm later" promise only for facts nothing gives

- **Status:** Accepted
- **Date:** 2026-11-16
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.2 (version 4.31.0)
- **Supersedes / superseded by:** amends ADR-0088 (its rule, kept in ADR-0089's end reminder).

## Context

ADR-0088 tells live answers to give a short "I'll confirm … after the call" promise when the other person asks about the company or offer for a fact the session, documents and call do not give. The rule lists "a term" among its examples. In the ADR-0089 regression, scenario 10 (discount pressure: "Can you do thirty percent off?", with a price list that caps discounts at 10 %) scored 7.0 in both runs. The answer did not refuse the 30 %, and it put the 10 % cap only in the private Note: the promise shape had reached a fact the documents do cover, as a limit.

## Decision

One sentence is added at the end of `UNSUPPORTED_FACT_RULE` (`server/prompts/contract.ts`), the last words of the automatic end reminder:

> This promise is only for a fact nothing gives: when the documents cover it, even as a limit (such as the most discount allowed), answer from them directly in the user's format, and say plainly what they do not allow.

The rest of ADR-0088's rule is unchanged. The rules block and the session block keep their bytes, so the prompt cache entries stay; only the uncached tail of current-rules answers changes. A rollback (v-previous) is unchanged.

## Consequences

- A request beyond what the documents allow, such as a bigger discount, gets a plain, polite no with the allowed terms, in the user's format.
- A fact nothing gives still gets the promise, with no bullets and a Note (08 and 14 hold).
- Each answer's tail is about 45 tokens longer (uncached, Haiku: negligible).

## Alternatives considered

- **Removing "a term" from the rule's examples.** A term the documents do not give (a notice period nobody stated) should still get the promise; the problem is coverage, not the kind of fact.
- **A line in the editable default prompt.** The admin could delete it, while the rule it limits sits in the locked reminder; the limit belongs next to the rule.

## Validation

- Unit test: `tests/unit/server/prompt-unsupported-fact.test.ts` (the new sentence is in the rule and at the end of the tail).
- Evaluation, 16 Nov 2026 (developer's cap $0.40, spend $0.111):
  - 2 graded runs each: 10 **8.5** (was 7.0; facts 3/3, one run lost a point for a 16-word answer line); 08 **8.0**, the intended no-bullets promise marked down for style as before; 14 **10.0**.
  - `answers`, 1 run: **9.43** (gate ≥ 8.86); 10 10.0, 08 8.0, 14 10.0; hidden line 30/30.

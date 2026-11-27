# ADR-0134: Confident replies; the unsupported-fact rule keeps the call moving

- **Status:** Proposed (the prompt round; not released)
- **Date:** 2026-11-28
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6.1 (version bump when released)
- **Supersedes / superseded by:** amends ADR-0088, ADR-0090, ADR-0103 (wording only)

> **Not in the 28 Nov 2026 release.** The full suite on the version below was worse in 8 of 16 groups. A narrowed version (confident for conversation, opinion and general knowledge; never inventing facts about the user, their company or the deal, with production's explicit lists kept) is the second step of the separate prompt round.

## Context

On 27 Nov 2026 a press got "Not sure yet, so I'll confirm the details with you before we move on." The live prompt had rules that led to hedging or refusing: the unsupported-fact rule (ADR-0088) asked for "only a short promise … with no bullets at all"; the default prompt's matching bullet asked for a 10-word promise; "unclear: do not guess"; the private-answer "say plainly if you are not sure".

## Decision

Production's prompt and contract stay, with these edits:
- New first rule: always a confident reply the user can say, from the conversation, the session and general knowledge (with no documents, the conversation and session are enough); never "not sure", "I don't know" or a bare promise.
- Unsupported specific fact (price, date, start date, hosting, certification, term): never yes or no, never agreeing to one they suggest, never a guess; a confident confirm line of at most 12 words ("Let me confirm the exact figure and send it over today.") plus one line of what can be said (what it usually depends on, or a short question), and a Note. (Was: a 10-word promise and nothing else.)
- unclear: answer the most likely meaning; ask only when no reading is likely.
- Private answers: "be direct" instead of "say plainly if you are not sure".
- Kept unchanged: "Never invent", the CV honesty rules, the yes-or-no rule's condition, the Tip limits.

## Consequences

The rewrite the developer asked for (a short prompt around one hard rule) was built and measured on 27–28 Nov and is not used: it invented company facts the production rules prevent ("Yes, we host all customer data in the EU") and, with the press rules, broke the hidden lines. The explicit lists are the hard rule spelled out; removing them cost accuracy.

## Alternatives considered

The full rewrite (above); keeping the bare promise (the reported non-answer).

## Validation

Key-press evaluation (`scripts/eval-press.ts`, 25 invented snippets, code-checked, `docs/testing/answer-eval.md` "Key-press group") against production code the same day, and the full `eval:answers --guard` suite against same-day production.

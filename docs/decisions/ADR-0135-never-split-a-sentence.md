# ADR-0135: The answer card never splits a sentence, and shows a short question

- **Status:** Accepted (released 28 Nov 2026)
- **Date:** 2026-11-28
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` (4.70.0) §6.1
- **Supersedes / superseded by:** amends ADR-0043 item 16 (the 12-word cut)

## Context

The card cut an answer line longer than 12 words at a clause break or before a joining word ("with", "so", "to"…), added a full stop and made the rest a bullet. On 27 Nov 2026 "…confirm the details with you before we move on." showed as a headline and a bullet "With you before we move on."

## Decision

A card with no clean question shows at most 12 words of the raw words (its newest whole sentences, or its last 12 words after "…"): the 27 Nov card showed about 45 seconds of talk as its question.

`format.ts` `splitLongLine()` cuts only between whole sentences (abbreviations and decimals are not sentence ends); one long sentence stays whole. A line that only continues the sentence above (a lower-case start after a line that did not end a sentence) is joined to it, also while streaming. En and em dashes at a line start are bullet marks.

## Consequences

Some answer lines over 12 words now show whole (the prompt still asks for 12). The evaluation's "answer line as shown" rate measures this.

## Validation

Unit tests on every prefix of a streamed reply (`format.test.ts`). Key-press evaluation: formatting OK 16/25 before, 25/25 after.

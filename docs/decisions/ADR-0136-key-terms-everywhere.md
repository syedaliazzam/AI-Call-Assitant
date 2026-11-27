# ADR-0136: Key terms: always shown, taken from instructions too, and given to the answer model

- **Status:** Accepted (released 28 Nov 2026)
- **Date:** 2026-11-28
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` (4.70.0) §6.1
- **Supersedes / superseded by:** amends ADR-0057 (Key terms under Advanced), ADR-0079 P1-F

## Context

The session already had a Key terms field (ADR-0057) sent to Deepgram on both channels, but it sat in a collapsed "Advanced" section; names written in the session's instructions or description were not keyterms; the answer model saw only the typed list, while live answers send the documents only as a summary. Deepgram allows 500 tokens of keyterms per request on Flux and Nova-3 (Configure too); our 1,500-character cap could pass that.

## Decision

- Key terms always show in session setup, with a hint.
- `extractInstructionTerms()`: acronyms, names with an inner capital or digit, and capitalised runs inside a sentence from the instructions and description go into the keyterms after company and role.
- The answer model gets the same list as Deepgram (`toLiveSessionContext()` → `buildKeyterms()`).
- MAX_KEYTERM_CHARS 1,500 → 1,200 (about 400 tokens).

## Validation

Unit tests (`keyterms.test.ts`, `context.test.ts`); setup integration test.

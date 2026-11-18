# ADR-0103: Natural-style live answers prompt and the reach of user preferences

- **Status:** Proposed. Not deployed. First version: `answers` 8.67 (gate 8.86). Second: 9.10, hidden line 28 of 30. Version 3: 9.43, hidden line first 58 of 60 against 59 of 60. Version 4: 9.13, but hidden line first 56 of 60 and the placeholder copied in 4 (scenario 09), against 60 of 60 and none for the current default (18 Nov 2026). The app side is done in the same branch: text before the hidden first line is never shown (`server/answer-meta.ts`).
- **Date:** 2026-11-18
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7 (live answers prompt; unchanged until this is accepted)
- **Supersedes / superseded by:** would change ADR-0089's default live prompt and preference heading; keeps ADR-0088's rule word for word

## Context

The developer wrote a new default Live answers prompt: answers that sound like a person on a call, guidance per kind of call (interview, sales, technical, advisory), a section that answers general knowledge fully, rules for applying the user's preferences, and no worked examples. Two places outside the admin's prompt also needed to agree with it:

- the user-preferences heading said preferences "override the general rules above where they differ", which read as if a preference could override the never-invent rules;
- the automatic end reminder said "add no detail the session, documents or call do not state", and ADR-0088's "I'll confirm" promise did not say it is never for general knowledge.

## Decision (proposed)

1. `DEFAULT_LIVE_PROMPT` (`server/prompts/defaults.ts`) is the developer's text, exactly. The app contract, hidden lines, types and labels are unchanged.
2. `PREFERENCES_HEADING` (`server/prompts/preferences.ts`): "These user preferences decide format, length, tone, language and focus, and win over the general rules above on those. They never override the app contract at the top or the never-invent rules, and when one cannot fit the question, the general rules say how to apply it." `GLOBAL_HEADING` and the Admin → AI settings lines say the same.
3. The end reminder (`server/prompts/contract.ts`): "add no personal, company, offer or project detail…", and a new `GENERAL_KNOWLEDGE_RULE` after ADR-0088's rule: the promise is only for a specific company or offer fact, never for a general-knowledge question.
4. A new evaluation group, `call-style` (scenarios 25–28).

## Consequences (measured, `docs/testing/answer-eval.md` and `benchmark-results.md`)

- `answers` 8.67 (baseline 9.30, gate 8.86): scenario 08 fell from 8.5 to 5.0 (an invented "yes" to German hosting and ISO certification), the hidden line was missing in 6 of 30 answers, and answer lines got longer.
- First answer word: p50 unchanged (862 → 867 ms), p95 longer (1,098 → 1,974 ms); the cached prefix grows by about 1,400 tokens.

## Alternatives considered

To be decided by the developer after the failed gate: adjust the prompt text (the yes-or-no and "answer it" lines against ADR-0088; the "start with the answer" lines against the hidden first line), then re-run `answers`.

## Validation

- Unit tests: the pinned rules-block hash, the preference heading, the end reminder's general-knowledge limit and narrowed clause, the route's system blocks.
- `answers` and `call-style` evaluations, and the local first-word timing, as above.

# ADR-0103: Natural-style live answers prompt, the reach of user preferences, and stray text before the hidden line

- **Status:** Accepted (18 Nov 2026), with the developer's version 5 of the prompt.
- **Date:** 2026-11-18
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.2 (version 4.42.0)
- **Supersedes / superseded by:** changes ADR-0089's default live prompt and preference heading; keeps ADR-0088's rule word for word; extends ADR-0089's contract fallback

## Context

The developer wrote a new default Live answers prompt: answers that sound like a person on a call, guidance per kind of call (interview, sales, technical, advisory), a section that answers general knowledge fully, rules for applying the user's preferences, and no worked examples. Two places outside the admin's prompt also needed to agree with it:

- the user-preferences heading said preferences "override the general rules above where they differ", which read as if a preference could override the never-invent rules;
- the automatic end reminder said "add no detail the session, documents or call do not state", and ADR-0088's "I'll confirm" promise did not say it is never for general knowledge.

The prompt took five versions (all measured in `docs/testing/answer-eval.md`):

| Version | `answers` (gate 8.86) | Hidden line first | What failed |
|---|---|---|---|
| 1 | 8.67 | 24/30 | 08 invented German hosting and ISO certification; text before the hidden line |
| 2 | 9.10 | 28/30 | text before the hidden line (07, 09) |
| 3 | 9.43 | 58/60 ungraded | the prompt wrote `[[type\|for\|source]]`; replies copied it (09) |
| 4 | 9.13 | 56/60 ungraded, placeholder in 4 | the prompt still pointed at "the hidden first line from the app contract" (09) |
| 5 | **9.37** | **60/60 ungraded, 30/30 graded, no placeholder** | passes |

The current default, measured the same way: 60/60, no placeholder.

## Decision

1. `DEFAULT_LIVE_PROMPT` (`server/prompts/defaults.ts`) is the developer's version 5, exactly. It never mentions the hidden line or writes `[[`: a unit test forbids both, because lines that did made Claude Haiku copy the contract's placeholder before the real line.
2. `PREFERENCES_HEADING` (`server/prompts/preferences.ts`): "These user preferences decide format, length, tone, language and focus, and win over the general rules above on those. They never override the app contract at the top or the never-invent rules, and when one cannot fit the question, the general rules say how to apply it." `GLOBAL_HEADING` and the Admin → AI settings lines say the same.
3. The end reminder (`server/prompts/contract.ts`): "add no personal, company, offer or project detail…", and a new `GENERAL_KNOWLEDGE_RULE` after ADR-0088's rule: the promise is only for a specific company or offer fact, never for a general-knowledge question.
4. **Stray text before the hidden line is never shown** (`server/answer-meta.ts`, `withAnswerMeta()`). Before, it became the card's headline and the type showed "Other"; a reply opening with `[[question|for|source]]` set the card's question to "for|source". Now:
   - a reply that opens with its hidden line streams exactly as before (no added wait);
   - otherwise its first line is held (at most 500 characters): when the hidden line follows, the stray line is dropped and the real type used;
   - a copied `[[type|for|source]]` first line is dropped;
   - a leading `[[question|…]]` line is taken out, and one holding "|" never becomes the question;
   - a reply with no hidden line at all is shown in full after its first line;
   - the route logs `droppedLeadingText` (a flag, never the text).

   The stray-tag filter also removes a malformed last line whose first slot is words ("[[Tell me about a time…|]]").
5. Evaluation: a new group, `call-style` (scenarios 25–28); every run flags a copied placeholder and no longer counts one as the hidden line.

## Consequences

- `answers` 9.37 with version 5 (baseline 9.30); 08 invents nothing; hidden line 60/60 ungraded and 30/30 graded.
- Answer lines are still often longer than 12 words as written (21/27); the card's cut keeps them within 12 as shown.
- A reply without its hidden line now shows its first words only when its first line ends.
- First answer word (version 1 measurement): median unchanged; the cached prefix grows by about 1,400 tokens.
- Production had no saved Live answers version, so the deploy itself makes version 5 the live prompt.

## Alternatives considered

- Keep a line telling the model that the hidden line comes first: measured worse (versions 3 and 4).
- Retract stray text on the page after it was shown: it would still flash on the card.

## Validation

- Unit tests: the pinned rules-block hash, no "hidden" and no `[[` in the editable default, the preference heading, the end reminder's general-knowledge limit, every stray-text shape measured (`answer-meta-fallback.test.ts`), and no wait for a compliant reply.
- `answers`, `call-style` and ungraded hidden-line runs, and the local first-word timing (`docs/testing/benchmark-results.md`).

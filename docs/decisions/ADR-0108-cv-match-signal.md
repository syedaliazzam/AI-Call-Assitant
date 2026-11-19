# ADR-0108: CV match signal for own-experience questions

- **Status:** Accepted (19 Nov 2026, the developer's approval)
- **Date:** 2026-11-19
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.2 (version 4.47.0)
- **Supersedes / superseded by:** extends ADR-0084's experience rules; the default live prompt stays version 5 (ADR-0103)

## Context

Live answers to questions about the user's own past claimed experience the CV does not state ("I've run Kubernetes in production", "I led the migration"), even with ADR-0084's experience rules. Rewording the editable prompt (version 6, branch `live-prompt-v6`) cut those details but made typed questions copy the contract's placeholder instead of the hidden line, so it is not shipped.

## Decision

For a question about the user's own past (second person plus a past or experience cue, rules only), in a session with the experience rules (interview, mock or blank, not "Full example story"), the server scores the CV's clauses against the question with the document search's BM25 formula (`server/prompts/experience.ts`, reusing `core/documents/chunks.ts`), counting only the question's specific words. When no clause scores at least 0.5 (no specific word in common), the tail ends with: "No CV project matches this question: answer only with your approach (I would…), with no past-tense claims." It is on by default; the cached blocks are unchanged. The default live prompt stays version 5.

Also: the evaluation's grader counts as invented only a claim about the user's past, role or results, a company, price, client or number fact, or a made-up statistic or source (approach lines and general knowledge never; a generic story the "Full example story" setting asks for only for its names, numbers or named results), and the release gate compares each scenario with production (`docs/testing/answer-eval.md`).

## Consequences

- Measured with `eval:all` against production (19 Nov 2026): the line fired in 20 of 222 replies (10 scenarios); there, runs with something invented 12 → 4; `missing-info` 6.25 → 8.13, `company-star` 8.17 → 8.67 (invented 3/6 → 0/6); hidden line 222/222 (production 217/222). Every other scenario's prompt is byte for byte production's.
- Words alone miss a CV project worded differently ("difficult client" against "retail customer"): 3 of the line's 10 firings in the evaluation were wrong, and two of those scenarios scored lower. Follow-up: a synonym step.
- No added latency: first answer word 788 / 926 ms (p50 / p95) against 779 / 865 ms without, same method (`docs/testing/benchmark-results.md`); no extra request.

## Alternatives considered

- Version 6 of the editable prompt: fewer invented details, but the hidden line fell to 96.8% (typed questions copy the placeholder); kept on its branch until the placeholder is fixed.
- Claude Sonnet for own-experience questions: the best quality, but the first word 1,009 / 2,441 ms and about 21 times the cost per answer; later, for typed questions only.
- Neutral shape examples in the locked experience rules: more invented details, dropped.

## Validation

- Unit tests: `tests/unit/server/prompts/experience.test.ts` (the question check, the score and threshold, the line only when no clause matches and only in experience sessions, last in the tail, off only on request).
- `eval:all` on production and on this change, same day and grader; the release gate in `docs/testing/answer-eval.md`.

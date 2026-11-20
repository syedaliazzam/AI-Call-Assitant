# ADR-0112: A silent retry for empty or templated replies (the prompt's wording unchanged)

- **Status:** Accepted (20 Nov 2026), the guard alone.
- **Date:** 2026-11-20
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.2 (version 4.49.0; 4.48.0 is the Mac release's)
- **Supersedes / superseded by:** extends ADR-0103 (stray text before the hidden line) and ADR-0107 (a card never stays empty)

## Context

The locked contract shows the hidden lines as templates (`[[type|for|source]]`, `[[question|…]]`). Claude Haiku sometimes copies the template as a reply's first line, mostly on typed questions (scenario 09). The card then comes out empty or labelled "Other". It grows with the prompt's length: version 6 of the live prompt failed its hidden-line gate this way (215/222, ADR-0103's notes), which blocks further prompt work. On 20 Nov production's prompt had the hidden line first in 57 of 60 ungraded `answers` replies, with a copied template in 2 (both 09).

## Decision

**Fix what the user sees, not the prompt.** No prompt text changes; the contract keeps its templates.

1. **Server** (`server/answer-meta.ts`, `app/api/answer/route.ts`): a live reply whose leading text holds a copied template line (`@kite/shared` `leadingTemplateLine()`: `[[type|…]]`; the slots "for" or "source" with no real reader or source; `[[question|…]]`; `[[question|for|source]]`) is stopped there. Nothing is sent, the model's stream is stopped, the log line says `contract.templatedReply`, and `done.templated` tells the page. A placeholder last line (`[[question|…]]`) is taken out and never becomes the card's question. The Ask AI page has no retry, so it keeps ADR-0103's drop-and-read-on.
2. **Page** (`core/answer/finishedReply.ts`, `features/live/useLiveAnswers.ts`), for every kind of question (typed, spoken, screenshot, auto): a reply with no answer text, or one the server stopped on a template, is asked again once, silently. The card is held hidden and no other card is shown in its place until the retry's first words. Still empty or templated after the retry, or the retry cannot be sent (offline): the card is removed with "Didn't catch that — press answer again." The page logs `answer: no answer text` with flags only (`retry`, `templated`).
3. **Evaluation:** a copied template anywhere in a reply is flagged ("No copied placeholder"), and one as the first line is not counted as the hidden line. `--guard` also measures what the user sees: each reply goes through the route's pipeline and the page's retry rule (`scripts/lib/guard-view.ts`), with one more real request only when the page would ask again.

## Consequences

- With the guard, no broken card reached the user in the measured replies: 60/60 `answers` replies and 8/8 more of scenario 09. The three copied templates in those 68 replies were each asked again silently; two retries answered, and one copied the template again and became the notice.
- A reply with no hidden line at all (not a template; `08` once in 60) is still shown with the default type, "Other" (ADR-0103's fallback). The guard does not cover it.
- A templated reply costs one more request and about one more answer's time; a compliant reply has no added wait.
- A stopped reply's token counts are logged as 0 (the stream is stopped before the model reports them).
- The model's raw hidden-line rate is unchanged (same prompt).

## Alternatives considered

- **Teach the hidden lines in words, with one filled-in example each (tried first, reverted).** The raw hidden-line rate improved (59/60 against 57/60; `eval:all` 222/222), but `hallucination-bait` got worse. At 4 runs per scenario, same day and grader: 6.25 with 14/24 runs inventing something, against production's 7.38 and 8/24. `b-price` went from 0/4 to 4/4 runs inventing pricing ("We price per seat"). The "I'll confirm" rule itself had changed in one clause only (`then the hidden [[question|…]] line` became `then the hidden question line`); the end reminder's opening and the contract's description of the lines changed too. Measurements: `docs/testing/answer-eval.md`, 20 Nov 2026.
- **Retry on the server:** it would have to restart the provider chain (Groq, Gemini, GPT fallbacks) mid-response, and could not cover a reply that ends empty after its meta was sent.
- **Keep the "…" card on screen during the retry:** the developer asked for no card meanwhile.

## Lesson

Even a cosmetic edit to the locked contract shifts answer scores in groups it does not seem to touch (here invented pricing). **Every prompt change, however small, runs the full suite (`eval:all`) against production measured the same day.**

## Follow-ups (not done; for the version 6 round)

- Version 6's hidden-line gate should measure what the **user** sees after this guard (no broken card; `eval:answers --guard`), not the model's raw output. Version 6 is unchanged for now.
- **A reply with no hidden line at all → a card labelled "Other"** (ADR-0103's fallback; measured: `08-documents-cannot-answer` once in 60, `25-general-technical-question` in both `eval:all` runs). It is not a template, so this guard leaves it as it was. A separate bug, left as it is by the developer's decision; to be folded into the version 6 round.

## Validation

- Unit tests: `tests/unit/shared/templateLine.test.ts` (the shared rule), `tests/unit/server/answer-meta-template.test.ts` (a templated first line stopped with nothing sent, an empty reply, the retry then succeeding, giving up after one retry, the Ask AI page unchanged, a placeholder last line), `tests/unit/core/answer/finishedReply.test.ts`, `tests/unit/scripts/guard-view.test.ts`.
- `docs/testing/answer-eval.md` (20 Nov 2026): the guarded 60-reply check and `eval:all` with production's prompt.

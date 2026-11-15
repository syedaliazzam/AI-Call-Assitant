# ADR-0084: No invented experience stories, whatever shape the instructions ask for

- **Status:** Accepted
- **Date:** 2026-11-15
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.2 (version 4.24.0)
- **Supersedes / superseded by:** none. Tightens ADR-0032 (answer honesty) and ADR-0083 (company AI instructions). ADR-0030's "Full example story" setting is unchanged.

## Context

On production (15 Nov 2026), Try it on Admin → AI settings tested a company instruction "always use the STAR shape" with no session, so no CV. Haiku answered "Tell me about a time you handled a difficult client" with a made-up STAR story (hidden source `example`). Strengthening the company heading (ADR-0083) did not stop it.

A **control try** then used the same question with no company instructions and no CV (1 request). It also got a made-up past event: "I handled a difficult client by listening first…", source `example`. So the locked core itself allowed it, and the company block was not the cause. The core rule said "if nothing is close … answer with the approach: 'I would…'". It did not say that "no CV at all" counts as "nothing close", and it did not stop a shape instruction from asking for a story.

## Decision

The locked core rules (`CORE_RULES` in `server/prompt.ts`, v-current) now say:

1. **Behavioural shape.** With no CV, or nothing in it close to the question, there is no story to tell: answer with the approach.
2. **Missing information.** With no CV or document, or nothing close, follow the session's "Missing information" line. Without one, answer with a **clearly hypothetical approach**:
   - the answer line starts "I would" or "I'd", and every line stays in that voice;
   - the hidden source is `general`, never `example`;
   - never invent an employer, client, project, past event, story, number or result, and never tell what happened.
3. **What "close" means.** For a behavioural question, the CV must state the same kind of situation the question asks about; the same field or employer is not enough. Never stretch an unrelated project to fit the question, and never add people, feelings, pressures or outcomes to make it fit.
4. **Shape instructions.** An instruction about the shape of experience answers, such as "always use STAR", from the company or the session, applies only to experience the CV or documents state that is close to the question. A part the CV does not state is left out without remark. Without that experience the shape may order the approach's steps, all said as "I would", never as a story.

`CALL_REMINDER` (the end of every request) repeats the rule in one clause.

**The user's own "Full example story" setting (ADR-0030, Settings → Answers) stays.** It is an explicit per-user choice: a generic story with no names or numbers, privately tagged Example. Company instructions cannot turn it on. The rules say that only the session's "Missing information" line may ask for an example story.

v-previous (the ADR-0032 rollback rules) is unchanged and byte-identical, as that ADR requires. Under it, the company heading's STAR sentence (ADR-0083) still applies.

**Evaluation group `company-star`** (`tests/eval/groups/company.ts`, `--only=company-star`). It has three cases, all with the "always use STAR" company instructions and the same question:

- no CV;
- a CV with no client work;
- a CV with a matching customer story.

Scenarios can now carry `company` (company instructions, sent as the live route sends them). `eval:answers --no-grade` sends answers only, with no grader requests: it costs half as much, and the code checks are still reported.

## Consequences

Measured on 15 Nov 2026 with `claude-haiku-5-5`, 6 paid requests in all (the developer's cap), one run each, not graded:

| Case | Before | After |
|---|---|---|
| Control: no company text, no CV | made-up past event (source `example`) | not re-run (the next row is the harder case) |
| "Always use STAR", no CV (Try it path) | made-up STAR story (source `example`) | **fixed**: every line "I would / I'd", no event, no names or numbers |
| `star-no-cv` (eval) | — | **passes**: hypothetical throughout |
| `star-cv-match` (eval) | — | **passes**: the CV's story, its actions and its result, nothing added |
| `star-cv-no-match` (eval) | — | **fails before rule 3**: STAR forced onto an unrelated data project, with worried teams the CV does not mention and "the CV does not give a measured outcome" said aloud. **After rule 3: better, still not right**: no STAR forcing, "the closest work I have is…" and an "I would" approach, but the answer line still says "I handled a difficult client…", and one bullet adds that the user kept people informed |

- Answers no longer invent an experience story when there is no CV, with or without company instructions.
- A CV with an unrelated project still tempts Haiku into a past-tense claim. The next step is a fix that targets the answer line, checked on `company-star` with the grader and 2 runs (3 × 2 × 2 = 12 requests).
- The rules block changed, so by "Evaluation cost" in `docs/testing/answer-eval.md` the `answers` and `screenshots` groups should be re-run (15 × 2 × 2 × 3 = 180 and 12 requests). They were **not** run, because the developer capped this change at 6 paid requests. The prompt cache's rules entry is written again once after the deploy.
- `source` was `docs` instead of `general` in the fixed no-CV try. That is a hidden field only, used for the answer's tag.

## Alternatives considered

- **Only the company heading** (ADR-0083's sentence). Already tried; it did not stop the story, and the control try showed the core allowed it anyway.
- **Removing the "Full example story" setting.** That is the user's own explicit choice (ADR-0030), labelled Example in the app. Keeping it while stopping company instructions from turning it on matches the brief: shape instructions apply only to experience the CV states.
- **A code check that removes past-tense sentences.** It would be brittle: real CV stories are past tense.

## Validation

- `tests/unit/server/prompt-company.test.ts`:
  - the new locked lines are in `CORE_RULES` and `CALL_REMINDER`;
  - they come before a company "always use STAR" text in the prompt;
  - the session's example-story line still appears when the user chose it.
- `tests/unit/server/prompt-lessons.test.ts`: the pinned rules hash is updated, and v-previous is unchanged.
- `tests/unit/scripts/eval-options.test.ts`: `--no-grade`.
- Paid checks: the table above.

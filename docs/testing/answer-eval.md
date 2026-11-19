# Answer-quality evaluation

How Kite's live answers are scored, how to run the evaluation, and the results for each prompt version. Only measured runs are recorded here.

- **Script:** `apps/web/scripts/eval-answers.ts`, run with `pnpm --filter web eval:answers`. It is developer-only: it calls the real Claude API with the key in `apps/web/.env.local` (it refuses to run without one; it spends from the team's one Console limit, so each run is agreed with its estimated cost first: CLAUDE.md "Claude key and spend"), and never runs in CI.
- **Scenarios:** `apps/web/tests/eval/scenarios/*.json`, 12 invented scenarios (no real company, person or customer).
- **Architecture:** `docs/architecture/kite-architecture-v3.1.md` §11; ADR-0025.

## What it does

1. **Answer.** Each scenario goes through the **real server prompt** (`server/prompt.ts` `buildPrompt()`: rules, session block, conversation chunks, tail). Claude answers it with the fast model (`claude-haiku-5-5`, `max_tokens` 400, thinking off), the same call the live app makes.
2. **Grade.** The smart model (`claude-sonnet-5-5`) grades each answer against the rubric below. It uses structured outputs (`output_config.format` with a JSON schema), so every grade parses.
3. **Check in code.** Two rubric points are counted in code instead of by the grader: the headline length and the number of bullets.
4. **Average.** Each scenario runs twice by default (`--runs N`), because answers vary from run to run; its scores are averaged. The overall score is the mean of the scenario totals.

The script prints the score table only. `--show` also prints each answer and the grader's one-line reason; use it locally only.

### Groups, and what to re-run (from Day 5)

Re-run only the groups a change touches. Run the full suite (`pnpm --filter web eval:all`) at release only when the live-answer prompts or answer pipeline changed; otherwise run only the groups the change touches. The grader stays Sonnet, so scores stay comparable with the baselines. The developer is told the estimated cost before every paid run. Every run first prints its estimated number of Claude requests; `--dry-run` prints only that and sends nothing.

| Group | Scenarios | Command | Claude requests per command (default runs) | Gate |
|---|---|---|---|---|
| `answers` | 01–15 (Day 4) | `pnpm --filter web eval:answers --only=answers` | 15 × 2 runs × (answer + grade) = 60; the gate needs the command 3 times = 180 | mean of 3 commands ≥ baseline − 0.15 (9.28) |
| `screenshots` | 16–18 (Day 5) | `pnpm --filter web eval:answers --only=screenshots` | 3 × 2 × 2 = 12 | ≥ 8 |
| `lessons` | 19–20 (Day 5 Stage 7: answers with an approved lesson) | `pnpm --filter web eval:answers --only=lessons`, then the same with `--without-lessons` | 2 × 2 × 2 = 8 per command, 16 for the pair | with lessons ≥ 8 and higher than without |
| `preferences` | 21–24 (parity Phase 2: bullets only, an answer language, the technical tone; v1.2.0: STAR structure) | `pnpm --filter web eval:answers --only=preferences` | 4 × 2 × 2 = 16 | ≥ 8 |
| `call-style` | 25–28 (ADR-0103: a general technical question the documents do not cover, a preference that cannot fit, a follow-up that builds on the last answer, a sales objection) | `pnpm --filter web eval:answers --only=call-style` | 4 × 2 × 2 = 16 | ≥ 8 (proposed) |
| `notes` | n1–n3 (Day 5) | `pnpm --filter web eval:notes --only=notes` | 3 × 3 runs × (notes + grade) = 18 | ≥ 8 |
| `adaptive` | 24, in `tests/eval/groups/adaptive.ts` (ADR-0030: 6 roles × 4 question types; code is run) | `pnpm --filter web eval:answers --only=adaptive` | 24 × 2 × 2 = 96 | ≥ 8 |
| `missing-info` | 8, in `tests/eval/groups/quality.ts` (4 questions under both settings) | `--only=missing-info` | 8 × 2 × 2 = 32 | ≥ 8 |
| `hallucination-bait` | 6, same file | `--only=hallucination-bait` | 6 × 2 × 2 = 24 | **Zero invented prices or personal numbers** (the developer's gate). The score is reported, with no gate of its own |
| `consistency` | 3, same file (the same question twice in one call) | `--only=consistency` | 3 × 2 × 3 = 18 | ≥ 8, and the same numbers both times |
| `ask-kite` | 6, same file (3 typed in a call, 3 on the page; code is run) | `--only=ask-kite` | 6 × 2 × 2 = 24 (the page's answers use the smart model) | ≥ 8, and for the call or private as expected |
| `cv-embellishment` | 4, in `tests/eval/groups/honesty.ts` (ADR-0032: bait an invented tool, number, team size or result on a real CV project) | `--only=cv-embellishment` | 4 × 2 × 2 = 16 | **Zero invented tools, numbers, team sizes or results** (the claim check and the grader's `invented` list). Score reported |
| `answer-length` | 2, same file (ADR-0032: a full Balanced-length answer, not a one-liner or a ramble) | `--only=answer-length` | 2 × 2 × 2 = 8 | ≥ 8 (the grader's style score covers length) |
| `question-detection` | 11, in `tests/eval/groups/detection.ts` (ADR-0043: garbled lines and remarks are not answered as questions; real questions in messy transcripts still are) | `--only=question-detection` | at most 11 × 2 × 2 = 44 (a reply with no answer in it needs no grade) | ≥ 8 |
| `company-star` | 3, in `tests/eval/groups/company.ts` (ADR-0084: a company "always use STAR" instruction with no CV, a CV with no matching project, a CV with one) | `--only=company-star` | 3 × 2 × 2 = 12 (`--no-grade`: 6) | **Nothing invented** in every run (the grader's `invented` list and the claim check); the matching case keeps the CV's story and result |
| `screenshot-types` | 7, same file (ADR-0043: a coding problem, a code error, a slide, a chart, a document, a web page, an unreadable screen; code is run) | `--only=screenshot-types` | 7 × 2 × 2 = 28 | ≥ 8, and the code runs |
| `screen-only` | 7, in `tests/eval/groups/screen-only.ts` (ADR-0107: Ctrl+Shift+Enter sends the screen alone; a coding problem, a multiple-choice question, a chat question, a before/after page, a dashboard, code with an error, an unreadable screen; code is run) | `--only=screen-only` (`--model=sonnet` or `--model=gpt-luna` to compare) | 7 × 2 × 2 = 28 | ≥ 8, hidden line 14/14, never empty, all private, and the code runs |

`--only=<id>` runs one scenario; `--runs=N` sets the runs (default 2 for answers, 3 for notes). Which group a change touches: the rules block or the conversation part of `server/prompt.ts` → `answers` and `screenshots`; the screenshot tail only → `screenshots`; the learned-preferences part of the rules block (`rulesBlock()` with lessons) → `lessons` (a session without lessons sends the Day 4 rules block byte for byte, pinned by a unit test, so `answers` and `screenshots` need no re-run); `server/notes.ts` → `notes`.

**Answer line (v1.1.0, ADR-0043).** Every run also records the words in the answer line as the model wrote it and as the card shows it after its cut at a clause, not counting a label, and prints both rates. The gate is **at least 95% as shown**, across all groups (the developer's decision, 4 Nov 2026). The Headline point in the rubric stays at 15 words of what the model wrote, so scores remain comparable.

**The hidden question line (v1.1.0).** The evaluation now takes out the hidden `[[question|…]]` line before grading, as the route's pipeline does. v1.0.2 added that line and this evaluation had not run since, so the baselines were measured without it; the first v1.1.0 pass graded it as stray text until this was fixed.

## Rubric (10 points per scenario)

| Criterion | Points | Who scores it | Full marks when |
|---|---|---|---|
| Facts | 0–3 | Grader | Every "must include" point is in the answer, correctly |
| Grounded | 0–2 | Grader | Every claim about the user, their company, offer, prices, dates or commitments comes from the session, documents or call; nothing from "must not include". From 19 Nov 2026, approach lines ("I would", "I'd typically") and general knowledge are not claims |
| Consistent | 0–2 | Grader | Consistent with earlier answers in the call, or gives the new answer and says what changed when new information changes it. Full marks when there are no earlier answers |
| Style | 0–1 | Grader | Follows the session's format, length, tone and instructions; no greeting or preamble |
| Headline | 0–1 | Code | Headline+bullets: the first line has 1–15 words. Paragraph: no bullet lines |
| Bullets | 0–1 | Code | Headline+bullets: at most 5 bullets. Paragraph: one paragraph |

**Invented** (the grader's `invented` list, behind the nothing-invented gates; the developer's definition, 19 Nov 2026). Only: a claim about the user's past, role or results that the session, documents or call do not state; a company, price, client or number fact they do not give; a made-up statistic or source. Approach lines ("I would", "I'd typically") and general knowledge are never invented. When the session's "Missing information" setting asks for an example story, a generic story is what was asked for, and only a company name, number or named result in it is listed. Before 19 Nov the list took every unsupported "fact", so it also listed approach lines and general knowledge; `--compare-rubric` grades the same replies with both rules.

## Scenarios

| Id | What it tests |
|---|---|
| 01-sales-pricing-from-document | Sales pricing from a document, with a calculation (40 seats × 52 dollars) |
| 02-support-troubleshooting | Support troubleshooting steps from a runbook, in order |
| 03-interview-question | An interview question answered in first person from the candidate's own notes |
| 04-follow-up-refers-back | A follow-up that refers back to an earlier answer ("the second phase of that") |
| 05-same-question-twice | The same question asked again about 5 minutes later |
| 06-new-information-changes-answer | New information (60 people, single sign-on) changes an earlier recommendation |
| 07-misheard-names | A misheard product name ("your fin drove" for Bluefin Route) |
| 08-documents-cannot-answer | A question the session and documents cannot answer (must say what to clarify) |
| 09-typed-chat-question | A question the user typed (mode `chat`) |
| 10-discount-pressure | Pressure for a discount larger than the documents allow |
| 11-paragraph-style | The paragraph format and a friendly tone |
| 12-internal-meeting | An internal meeting question from a project plan |

## Results

The tuning rule (day-04-answers.md Stage 10):
- keep a prompt change only if the overall score goes up and no scenario drops by more than one point;
- do at most two rounds;
- revert any change that loses.

Runs vary: the same prompt can score differently on a second run, so small differences are noise.

### Baseline: prompt v2 (Day 4 Stage 2)

- **Run:** 2026-10-30, Day 4 Stage 9, Windows 11 laptop (Intel Core i5-8350U), Node 24.21.0.
- **Models:** answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`; 12 scenarios × 2 runs.

| Scenario | Facts /3 | Grounded /2 | Consistent /2 | Style /1 | Headline /1 | Bullets /1 | Total /10 |
|---|---|---|---|---|---|---|---|
| 01-sales-pricing-from-document | 3.0 | 2.0 | 2.0 | 0.0 | 0.5 | 1.0 | 8.5 |
| 02-support-troubleshooting | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 |
| 03-interview-question | 3.0 | 1.0 | 2.0 | 0.5 | 0.0 | 1.0 | 7.5 |
| 04-follow-up-refers-back | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 |
| 05-same-question-twice | 2.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 9.0 |
| 06-new-information-changes-answer | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 |
| 07-misheard-names | 3.0 | 1.5 | 2.0 | 1.0 | 0.5 | 1.0 | 9.0 |
| 08-documents-cannot-answer | 3.0 | 1.5 | 2.0 | 1.0 | 0.0 | 1.0 | 8.5 |
| 09-typed-chat-question | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 |
| 10-discount-pressure | 3.0 | 1.5 | 2.0 | 0.0 | 0.0 | 1.0 | 7.5 |
| 11-paragraph-style | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 |
| 12-internal-meeting | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 |

**Overall: 9.17 / 10.** The points lost are mostly in the headline: it was longer than 15 words in 8 of the 24 answers (scenarios 01, 03, 07, 08, 10). Grounded and style lost points in the same scenarios.

### Round 1: shorter headlines, no offers beyond the documents (reverted)

**What changed** in `SYSTEM_RULES` (`apps/web/src/server/prompt.ts`):
- The headline rule adds "keep conditions and details out of it".
- Bullets are "for this question only; leave out facts that do not help answer it".
- A new rule: "Never offer or hint at a price, discount, exception or commitment beyond what the session details and documents allow."

**Run:** same day, machine and models; 12 × 2.

| Scenario | Total /10 | Change from baseline |
|---|---|---|
| 01-sales-pricing-from-document | 10.0 | +1.5 |
| 02-support-troubleshooting | 10.0 | 0 |
| 03-interview-question | 8.0 | +0.5 |
| 04-follow-up-refers-back | 9.5 | −0.5 |
| 05-same-question-twice | 9.0 | 0 |
| 06-new-information-changes-answer | 10.0 | 0 |
| 07-misheard-names | 9.5 | +0.5 |
| 08-documents-cannot-answer | 9.0 | +0.5 |
| 09-typed-chat-question | 8.5 | **−1.5** |
| 10-discount-pressure | 8.0 | +0.5 |
| 11-paragraph-style | 10.0 | 0 |
| 12-internal-meeting | 10.0 | 0 |

**Overall: 9.29 / 10.**

**Result: reverted.** Scenario 09 dropped by more than one point. Its answers padded the bullets with advice that is not in the documents ("reducing seats is not a cancellation; check with your account lead"), and the grader marked that as ungrounded.

### Round 2: round 1, plus bullets only from session facts (kept)

**What changed:** round 1's changes, plus one sentence in the bullet rule: "Each bullet must state a fact from the session details, documents or conversation; do not add advice, next steps or offers that are not in them."

**Run:** same day, machine and models; 12 × 2.

| Scenario | Facts /3 | Grounded /2 | Consistent /2 | Style /1 | Headline /1 | Bullets /1 | Total /10 | Change from baseline |
|---|---|---|---|---|---|---|---|---|
| 01-sales-pricing-from-document | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 | +1.5 |
| 02-support-troubleshooting | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 | 0 |
| 03-interview-question | 3.0 | 1.0 | 2.0 | 0.5 | 0.0 | 1.0 | 7.5 | 0 |
| 04-follow-up-refers-back | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 | 0 |
| 05-same-question-twice | 2.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 9.0 | 0 |
| 06-new-information-changes-answer | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 | 0 |
| 07-misheard-names | 3.0 | 1.5 | 2.0 | 1.0 | 0.0 | 1.0 | 8.5 | −0.5 |
| 08-documents-cannot-answer | 3.0 | 2.0 | 2.0 | 1.0 | 0.0 | 1.0 | 9.0 | +0.5 |
| 09-typed-chat-question | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 | 0 |
| 10-discount-pressure | 3.0 | 2.0 | 2.0 | 0.5 | 0.0 | 1.0 | 8.5 | +1.0 |
| 11-paragraph-style | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 | 0 |
| 12-internal-meeting | 3.0 | 2.0 | 2.0 | 1.0 | 1.0 | 1.0 | 10.0 | 0 |

**Overall: 9.38 / 10** (baseline 9.17). No scenario dropped by more than one point (the largest drop is 07, by 0.5), so the change is **kept**. This is the Day 4 final prompt.

**Still weak:**
- **Headlines over 15 words:** these remain in the interview (03), misheard-name (07), unanswerable-question (08) and discount (10) scenarios. These are answers that open with a full sentence.
- **Interview answer (03):** it still adds an unrelated bullet ("mentored two junior engineers").

These are candidates for Day 5's learned preferences (for example "keep the headline under 15 words").

### Round 3: short headlines when the session cannot answer (kept)

Approved by the developer as a third round, limited to the "can't answer from the session" case.

**New scenarios (3):** 13-off-topic-question, 14-session-without-documents, 15-small-talk. Each needs a headline of 15 words or fewer, with any explanation in the bullets.

**What changed:** one rule in `SYSTEM_RULES` (the "not in the session" rule) gains: "That headline is still 15 words or fewer, for example "Not in your notes: ask which plan they mean"; put any explanation in the bullets. For small talk or an off-topic question, the headline is a short reply the user can say."

**Run:** same day, machine and models; 15 × 2. "Before" is the round-2 prompt run on all 15 scenarios. Its 12 shared scenarios scored a little differently from round 2's own run (runs vary).

| Scenario | Before /10 | Round 3 /10 | Change |
|---|---|---|---|
| 01-sales-pricing-from-document | 10.0 | 10.0 | 0 |
| 02-support-troubleshooting | 10.0 | 10.0 | 0 |
| 03-interview-question | 7.5 | 8.0 | +0.5 |
| 04-follow-up-refers-back | 10.0 | 9.5 | −0.5 |
| 05-same-question-twice | 9.0 | 9.0 | 0 |
| 06-new-information-changes-answer | 9.5 | 10.0 | +0.5 |
| 07-misheard-names | 8.5 | 8.5 | 0 |
| 08-documents-cannot-answer | 8.0 | 10.0 | +2.0 |
| 09-typed-chat-question | 9.5 | 9.5 | 0 |
| 10-discount-pressure | 8.0 | 9.0 | +1.0 |
| 11-paragraph-style | 10.0 | 10.0 | 0 |
| 12-internal-meeting | 9.0 | 10.0 | +1.0 |
| 13-off-topic-question | 8.0 | 9.0 | +1.0 |
| 14-session-without-documents | 8.0 | 10.0 | +2.0 |
| 15-small-talk | 7.5 | 9.0 | +1.5 |
| **Overall** | **8.83** | **9.43** | **+0.60** |

**Result: kept.**
- The score went up, and no scenario dropped by more than one point (the largest drop is 04, by 0.5).
- On the original 12 scenarios, round 3 averages 9.46, against round 2's 9.38.
- The headline check now passes in every can't-answer scenario except 13, where one run in two was over 15 words.
- This is the Day 4 final prompt.

**Still weak:** the headline in the interview answer (03) and the misheard-name answer (07), and the misheard-name answer's style.

## Release gate (standing rule from 19 Nov 2026, second version)

Decided by the developer on 19 Nov 2026, with the fixed grader (Rubric above). It replaces every per-group gate for a change to the live answers' prompts or pipeline. A change ships when, measured with `eval:all` on production and on the change (same grader, same day):

- **no group is worse than production**: worse means a score more than 0.15 below production's (the run-to-run noise, Gate rule from Day 5) or more runs with something invented (the grader's list) than production;
- **the groups the change targets are better** than production;
- **the hidden line is first in at least 99%** of replies across the suite;
- **the code check finds zero invented prices or personal numbers** (sums on document prices and stated case assumptions are not invented).

**Target, tracked but not a blocker:** at most 1 run in 4 with something invented in each group.

**Why:** a fixed threshold per group failed production itself; a comparison with production on the same day and grader catches a regression, and the target keeps the direction.

## Gate rule from Day 5

Decided by the developer on Day 5, after measuring how much the score varies (below). It applies to every evaluation gate from Day 5 on, including the notes and lesson evaluations:

- **Existing scenarios:** the mean of **3 runs** must be at least the previous baseline minus 0.15. For the 15 Day 4 scenarios that is 9.43 − 0.15 = **9.28**.
- **New scenarios** are gated separately, on their own threshold.

**Why:** the same prompt scores differently from run to run by about ±0.15. Three runs of the 15 Day 4 scenarios, with byte-identical prompts for them, scored 9.50, 9.20 and 9.27. Adding new scenarios that score lower would also pull down one overall mean even when nothing else changed.

### Day 5 Stage 2: screenshot answers (kept)

**New scenarios (3)**, each with an invented image drawn by `scripts/make-eval-images.ts` (`tests/eval/images/`). The grader reads a written description of the image, not the image itself.
- 16-screenshot-slide-numbers: a slide with numbers, with the default question.
- 17-screenshot-code-bug: code with an off-by-one bug, with a typed question.
- 18-screenshot-pricing-table: a pricing table, where the answer has to read the table.

**What changed** (screenshot answers only; other modes' prompts are byte-identical):
- The image goes in the uncached part, before a tail that says it is a screenshot taken just now, with "Question about the screenshot: …" (default "What's on screen and how should I respond?").
- **Fix 1**, after run 2: answers had claimed the figures "match our records" when the session had none. The tail now says to compare only with the session details and documents, and to say so when they have nothing to compare with.
- **Fix 2**, after run 3: the tail asks for the session's format, length, tone and instructions, and for a headline with no label. The panel also removes a leading "Headline:" label from any answer (`core/answer/format.ts`).
- Earlier screenshot answers are marked in the conversation "(answered from a screenshot you can no longer see)".

**Runs:** 2026-10-31, same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`; 2 runs per scenario per run.

| Run | Prompt | Screenshot scenarios (16–18) | 15 Day 4 scenarios | All 18 |
|---|---|---|---|---|
| 1 | screenshots, before the fixes | 8.33 (8.5, 7.5, 9.0) | 9.50 | 9.31 |
| 2 | same | 8.67 (8.0, 9.0, 9.0) | 9.20 | 9.11 |
| 3 | fix 1 | 8.83 (8.5, 9.0, 9.0) | 9.27 | 9.19 |
| 4 (screenshot scenarios only) | fixes 1 and 2 | **8.83** (8.5, 9.0, 9.0) | — | — |

**Result: passes** under the rule above.
- **Day 4 scenarios:** the 3-run mean is **9.32** ≥ 9.28.
- **Screenshot scenarios:** **8.83** ≥ 8.

**Still weak:** in the code-bug scenario, the answer ignores the session's "answer in first person" instruction (style 0 in every run). It was not tuned further.

### Day 5 Stage 5: notes (n1–n3)

**Run:** 2026-11-01, same laptop; `pnpm --filter web eval:notes --only=notes`; notes and grades by `claude-sonnet-5-5`; 3 runs per scenario (18 requests). It was queued from 2026-10-30, when the usage limit stopped the first try.

| Scenario | Faithful /4 | Coverage /3 | Unclear /1 | Lessons /1 | Format /1 | Total /10 |
|---|---|---|---|---|---|---|
| n1-sales-renewal-with-feedback | 3.3 | 3.0 | 1.0 | 1.0 | 1.0 | 9.3 |
| n2-support-with-unclear-part | 4.0 | 3.0 | 1.0 | 1.0 | 1.0 | 10.0 |
| n3-interview-next-steps | 3.0 | 3.0 | 0.7 | 1.0 | 1.0 | 8.7 |

**Result: passes** (9.33 ≥ 8).

**Faithfulness:** n1 lost points in one or more of its 3 runs (3.3 of 4) and n3 in each run on average (3.0 of 4); n2 was fully faithful. The run printed scores only, so the grader's reasons for these points were not recorded (they need `--show`, which re-runs the scenarios). In n3, one run in three also missed the unclear part (0.7).

### Day 5 Stage 7: answers with an approved lesson (19–20)

**Runs:** 2026-11-01, same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`; 2 runs per scenario; the same scenarios with and without their lesson (16 requests).

| Scenario | With the lesson | Without (`--without-lessons`) |
|---|---|---|
| 19-lesson-per-seat-and-month | 8.5 (facts 3.0, grounded 1.5, headline 0.0) | 8.0 (facts 2.0, grounded 1.0, headline 1.0) |
| 20-lesson-error-code-in-headline | 9.5 (facts 2.5) | 9.0 (facts 2.0) |
| **Overall** | **9.00** | **8.50** |

**Result: passes** (with the lesson 9.00 ≥ 8, and higher than 8.50 without).

**Still weak:** with the per-seat-and-month lesson, the headline went over 15 words in both runs (headline 0). The lesson asks for both prices in the answer, which makes the headline longer. It was not tuned.

### Day 4 follow-up check (04-follow-up-refers-back, one run)

**Run:** 2026-11-01, same laptop; `pnpm --filter web eval:answers --only=04-follow-up-refers-back --runs=1` (2 requests). The scenario's second question ("the second phase of that") refers back to the earlier answer.

| Facts /3 | Grounded /2 | Consistent /2 | Style /1 | Headline /1 | Bullets /1 | Total /10 |
|---|---|---|---|---|---|---|
| 3.0 | 2.0 | 2.0 | 1.0 | 0.0 | 1.0 | 9.0 |

**Result: passes.** The answer used the earlier answer's facts (facts 3 of 3) and stayed consistent with it (2 of 2). Its headline went over 15 words in this run (it scored 10.0 and 9.5 on Day 4).

### Day 5 Stage 5: notes faithfulness issues, with causes

(2026-11-01: n1 and n3 re-run with `--show`, 3 runs each, 12 requests; prompts not changed):
- **n1:** 10.0 in all 3 runs (faithful 4 of 4). The earlier 3.3 did not come back, so it was run-to-run variation; no cause found.
- **n3, issue 1 (all 3 runs): a rating on a question Kite did not answer.** The follow-up "How did you do it?" was marked answered "partly" and got the thumbs up the user gave Kite's only answer, which was to the first question. The user answered the follow-up themselves.
  - Cause: the model sets `answeredAt` to that one answer's time (32 s) for both questions.
  - `withRatings()` in `server/notes.ts` then copies the answer's rating onto every question that points at that time.
  - The prompt's "answered" rule ("whether one of Kite's answers covered it") does not say that the user answering for themselves does not count.
- **n3, issue 2 (2 of 3 runs, and why "Unclear" scored 0.3): a silent stretch listed as unclear.** The gap from 78 to 300 s, with nothing said, was listed as an unclear part. Cause: the prompt's "missing pieces" wording reads as covering silence too.
- Possible fixes, for a later stage after the developer agrees:
  - give a rating only to the question an answer was asked about (one question per answer time);
  - say in the prompt that the user's own reply does not make a question answered;
  - say that silence is not unclear.

### Day 6 Stage 4a: headline at most 15 words with lessons (kept)

**What changed:** only the learned-preferences heading (`LESSONS_HEADING` in `server/prompt.ts`). It now ends: "The headline stays at most 15 words even when a preference asks for more detail: give the main answer in the headline, and put extra figures and details in the bullets." Sessions without lessons still send the Day 4 rules block byte for byte (unit test), so `answers` and `screenshots` need no re-run under the rule above. The without-lessons side of the lesson pair sends no lesson text, so its 8.50 (1 Nov) stands.

**Runs:** 2026-11-01, same laptop; `eval:answers --only=lessons`, 8 requests each.

| Round | Heading ends with | 19 (headline) | 20 | Overall |
|---|---|---|---|---|
| Before (1 Nov) | — | 8.5 (0.0) | 9.5 | 9.00 |
| 1 | "…put that detail in the bullets." | 8.5 (0.5) | 10.0 | 9.25 |
| 2 (kept) | "…give the main answer in the headline, and put extra figures and details in the bullets." | **10.0 (1.0)** | **10.0** | **10.00** |

**Result: passes** (≥ 8, higher than 8.50 without, headline 1.0 in every run).

The follow-up scenario (04) went over 15 words in one run on 1 Nov without any lesson. On Day 4 it scored 10.0 and 9.5, so this is treated as run-to-run variation. Fixing it would change the core rules and need the `answers` group 3 times (about 180 requests), so it is not done.

### Day 6 Stage 4b: ratings linked by answer id; silence is not unclear (kept)

**What changed** (`server/notes.ts`):
- Each answer in the notes prompt has an id, `A1`, `A2`, … by position.
- The model links a question to one Kite answer by that id (`answerId`), not by time.
- The code attaches the user's rating only for a real id, and each answer rates at most one question. A question with no linked Kite answer is "no" with no rating, because the user may have answered it.
- The unclear rule now covers only speech that could not be understood: "Silence, or a gap where nobody spoke, is not unclear."

**Run:** 2026-11-01, same laptop; `eval:notes --only=notes`, 18 requests.

| Scenario | Faithful /4 | Unclear /1 | Total | 1 Nov |
|---|---|---|---|---|
| n1-sales-renewal-with-feedback | 4.0 | 1.0 | 10.0 | 9.3 |
| n2-support-with-unclear-part | 4.0 | 1.0 | 10.0 | 10.0 |
| n3-interview-next-steps | **3.7** | **1.0** | **9.7** | 8.7 (faithful 3.0, unclear 0.7) |
| **Overall** | | | **9.89** | 9.33 |

**Result: passes** (≥ 8; n3's faithfulness and unclear scores both went up).

### Parity Phase 1: first-person answers, optional tip and private note

**What changed** (`server/prompt.ts`, ADR-0029): answers are written in the first person, the headline is one sentence, and an answer may end with a "Tip:" line and a private "Note:" line. The grader's rubric now allows those two lines; the grader is still Sonnet, so these scores are not strictly comparable with earlier ones.

**Round 1 (rejected):** 8.57, before the rubric change. Style scored near 0 because the rubric did not know the new lines, and the tip was a real problem: in scenario 01 it brought up a discount nobody asked about.

**Round 2:** tips and notes only when needed, and never for a price, discount, exception or commitment the other person did not ask about. 2026-11-02, same laptop, 2 runs per scenario per run.

| Group | Runs | Result | Gate |
|---|---|---|---|
| `answers` (15 scenarios) | 9.17, 9.07, 9.30 | **mean 9.18** | at least 9.28: **fails by 0.10** |
| `screenshots` (3) | 8.00 | 8.00 | at least 8: passes, at the limit (8.83 before) |
| `lessons` (2) | 9.00 | 9.00 | at least 8 and above 8.50: passes (10.00 before) |

Per-scenario scores of these runs were not kept, so which scenarios lost points is not known.

**Decision (developer, 2026-11-02): accepted. 9.18 is the new `answers` baseline** for the new format and changed rubric, even though it missed the old gate by 0.10. From now on the `answers` gate is at least 9.03 (9.18 − 0.15).

**Day 7 eval check:** `screenshots` fell from 8.83 to 8.00, right at its limit, and was not tuned. Look at it again in the release run.

**Saved results:** every paid run now saves per-scenario scores and grader reasons to `apps/web/eval-results/` (git-ignored; `scripts/lib/eval-results.ts`), so a drop can be diagnosed without another run. The answers themselves are not saved.

### Parity Phase 2: session types, the bullets format, an answer language

**What changed:** scenarios moved to the new session types (Sales, Support and Internal became Regular). New group `preferences` (21–23).

**Round 1 (reverted):** two new lines in the shared rules. `answers` 9.03, 8.77, 9.10, **mean 8.97, gate 9.03: failed.** `screenshots` 8.00, `lessons` 9.00, `preferences` 8.83.

**Round 2 (accepted):** those lines moved to the session block, used only by sessions that need them, so the shared rules are byte-identical to Phase 1's (the pinned hash confirms it). 2026-11-02, same laptop, 2 runs per scenario per run.

| Group | Runs | Result | Gate |
|---|---|---|---|
| `answers` (15 scenarios) | 9.30, 9.23, 9.40 | **mean 9.31** | at least 9.03: passes |
| `preferences` (3) | 8.67 | 8.67 | at least 8: passes |

`screenshots` and `lessons` were not re-run: their rules are back to those measured in Phase 1 (8.00 and 9.00).

**Reading these numbers:** the same shared rules scored 9.18 in Phase 1 and 9.31 here, with only the session type's name changed, so about 0.13 can be noise between one 3-run mean and another. The baseline stays 9.18 unless the developer changes it. Why round 1 scored lower is not established: scenario 05, first suspected, scored 8 in all six runs; 15, 10 and 03 moved most.

**For the Day 7 release run:** scenario 05 (same question twice) scores 8 every time, and 13 (off-topic) fell to about 8 in round 2. In `preferences`, 21 (bullets only) scored 8.0: read the saved reasons.

### Ask Kite and answer quality (ADR-0030)

**What changed:** the rules gained the hidden first line, shapes per question type, the missing-information rules and private answers; the tail gained a closing reminder. Each answer is graded without its hidden line.

**What else changed, so read comparisons with care:**
- **Scenarios 08, 13 and 14** required "not in your notes", which ADR-0030 forbids. They now require a natural reply offering to confirm the detail.
- **The rubric** now accepts the coding shape, a free-form private answer, a headline-only reply and a brief "As I mentioned", and marks down a spoken comment on what Kite was given. The grader also lists anything invented.
- So `answers` scores from here are not strictly comparable with the 9.18 baseline.

**New checks made in code**, saved per run in `apps/web/eval-results/`: the hidden line is present; the question type and the target are as expected; no comment on what Kite was given; no number outside the documents and the call (`core/answer/claimCheck.ts`); code runs in the sandbox (`scripts/lib/code-sandbox.ts`: Python in Pyodide, JavaScript in a fresh V8 context, no environment variables, a time limit); a repeat states the same numbers. Each paid run adds its real token cost to `eval-results/spend.jsonl`.

**Runs:** 2026-11-02 and 03, same laptop; answers by `claude-haiku-5-5`, the page's by `claude-sonnet-5-5`, graded by `claude-sonnet-5-5`; 2 runs per scenario.

| Group | Round 1 | Round 2: reminder, no embellishing, stricter rubric wording | Round 3: worked examples, sharper reminder |
|---|---|---|---|
| `adaptive` | 7.90 | 8.71 (type as expected 44/48, code ran 6/6) | not measured yet |
| `missing-info` | 6.06 | 6.69 | **8.25** (invented details found by the grader in 6 of 16 answers; no numbers) |
| `hallucination-bait` | 6.67 (no invented price or personal number in 12/12) | 7.08 (the same, 12/12) | not measured yet |
| `consistency` | 9.00 | 10.00 (same numbers 6/6) | not measured yet |
| `ask-kite` | 9.67 (target 12/12, code 4/4) | 9.42 (the same) | not measured yet |

Round 3 was approved by the developer after `missing-info` failed its recheck. Its other groups, and `answers`, `screenshots`, `lessons`, `preferences` and `notes`, could not run: the account's credit balance ran out during round 3 ("Your credit balance is too low"), 2026-11-03.

**Still weak in round 2's `hallucination-bait` scores** (no gate on them, and round 3's sharper reminder is aimed at this): spoken lines such as "I don't have a figure" still implied a gap, and headlines ran over 15 words. Embellishment of real CV projects with plausible details also remains in round 3's `missing-info`.

### Answer honesty, shape and rollback (ADR-0032)

**What changed** (`server/prompt.ts`, v-current): a real CV project must stay exactly as the CV states it (no added tools, numbers, team sizes, durations or results; extra depth only as the approach, "I'd typically..."); the headline+bullets shape is one spoken answer line plus **2 to 4** bullets (was up to 5); behavioural answers are a short STAR story from the closest real project; answer length is defined in seconds of speech (Short ≈10–20 s, Balanced ≈20–40 s, Detailed ≈40–60 s). The closing reminder repeats it. The rules before this change are kept word for word as **v-previous** for the admin rollback switch.

**So read comparisons with care:** the shape and the honesty rule both changed, so `answers` scores from here are **not strictly comparable** with the 9.18 baseline. v-previous is byte-for-byte the earlier block (hash `c65daf3b…`, pinned), so a rollback reproduces the earlier baselines exactly.

**New groups** (`tests/eval/groups/honesty.ts`), first run in the release run below:
- `cv-embellishment` (4): questions that bait an invented tool, number, team size or result on the Priya Rao CV. Gate: zero invented items (claim check + grader `invented` list); score reported.
- `answer-length` (2): questions whose good answer is a full Balanced-length reply. Gate: ≥ 8 (the grader's style score covers length).

**Release run (Part E):** re-run `answers`, `screenshots`, `lessons`, `preferences`, `notes`, the ADR-0030 groups (`adaptive`, `missing-info`, `hallucination-bait`, `consistency`, `ask-kite`) and these two new groups on the final v-current prompt.

### Release run (2026-11-03, v1.0.0)

Same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`; 2 runs per scenario (notes 3). Groups ran in parallel. Spend for the whole release run (evaluations, both fixes, the v-previous comparison): **about $1.49**, from the shared limit, within the $3.50 the developer approved.

**First pass (ADR-0032 v-current as committed):** every group passed except `missing-info` (7.31) and `cv-embellishment` (invented items in 5 of 8 runs). The grader's reasons showed one pattern: the spoken lines remarked on what the CV lacks ("I don't have a measured figure I can quote", "I can't claim a team size"), which the style rule scores 0, and answers promised to fetch the user's own past figures after the call ("I'll pull the numbers and send them over"), carried over from the "confirm after the call" shape meant for facts about an offer.

**Fix 1 (kept):** two lines. In the rules, under "When information is missing": the ban list gains "a figure I can quote", "I can't claim", "on record" and "my CV says", and a new bullet says that for a number, size, tool or result of a real project that the CV does not give, the headline says what the CV does state, the missing detail is left out of every spoken line without remark, and the user's own past figures or records are never promised after the call (a Note may name what to check). The closing reminder says the same in one clause. v-current hash `935d159a…`; v-previous unchanged (`c65daf3b…`).

**Fix 2 (reverted):** also banned "the CV does not state…" and required the CV's own verb for the user's part (no "led", "owned"). It scored lower everywhere it was measured (`answers` 8.90 / 8.80 / 8.93, mean 8.88; `cv-embellishment` 7.13 with 10 invented items; `missing-info` 7.56), so it was reverted.

| Group | Gate | First pass | Fix 1 (released) | Result |
|---|---|---|---|---|
| `answers` (15) | 3-run mean ≥ 9.03 | 9.07, 9.10 | 9.07, 8.83, 9.13 = **9.01** | **passes** under the release rule (within 0.15 of the gate counts as noise, developer, 2026-11-03) |
| `screenshots` (3) | ≥ 8 | 8.17 | 8.83 | passes |
| `lessons` (2) | ≥ 8 and above without | 9.00 | 8.50 (without 8.25) | passes |
| `preferences` (3) | ≥ 8 | 9.33 | 9.00 | passes |
| `notes` (3) | ≥ 8 | 9.67 | not re-run (own prompt) | passes |
| `adaptive` (24) | ≥ 8 | 8.44 | 8.40 | passes |
| `missing-info` (8) | ≥ 8 | 7.31 | **7.75** | **fails** |
| `hallucination-bait` (6) | zero invented prices or personal numbers | 7.33; numbers outside the documents 0/12 | 7.50; 0/12 | passes (no price or personal number invented; the grader's `invented` list flags wording such as "priced per seat") |
| `consistency` (3) | ≥ 8, same numbers both times | 9.83; 6/6 | 10.00; 5/6 | score passes; one repeat in six changed a number |
| `ask-kite` (6) | ≥ 8 | 9.58 | 9.67 | passes |
| `cv-embellishment` (4) | zero invented items | 6.50; 7 items, 5/8 runs | **7.25; 6 items, 5/8 runs** | **fails** |
| `answer-length` (2) | ≥ 8 | 8.75 | 8.50 | passes |

**Default chosen by measurement (developer's rule, 2026-11-03):** with `cv-embellishment` still failing, it was run once on v-previous (`eval:answers --only=cv-embellishment --style=previous`, new option): **6.00, 9 invented items, 6 of 8 runs flagged**, against v-current's 7.25, 6 items, 5 of 8. v-current invents fewer, so **v-current stays the default**; v-previous stays available through Settings → Answers → Answer style version (admin only).

**Still open:** what remains invented is mostly a claimed role beyond the CV ("I led the move", "working with my team") and small causal links ("so it could be deployed on its own"); `missing-info` loses most points to the style rule when an answer says a detail is absent. A stricter wording (fix 2) made both worse, so the next attempt should change the examples rather than add bans. New baseline for `answers`: **9.01** (gate 8.86 from here).

### v1.1.0, 4 Nov 2026

Same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`; 2 runs per scenario unless noted. Evaluation spend for the whole release: **$2.07 for 1,608 requests** (eight paid runs, including the wording that was tried and dropped).

**The prompt that shipped.** Tightening the general reminder for the 12-word line was tried three ways. Each made raw lines no shorter and answers less careful (`answers` 8.80 and 8.67, `cv-embellishment` down to 6.50), so the reminder went back to v1.0.4's words. The card's cut enforces the limit instead. The coding, screenshot and small-talk rules state it, because those lines have nothing else limiting them.

| Group | Gate | Result on the final prompt | Result |
|---|---|---|---|
| `answers` (15) | 3-run mean ≥ 8.86 | **9.07** | passes |
| `screenshots` (3) | ≥ 8 | 9.50 | passes |
| `lessons` (2) | ≥ 8 and above without | 9.25 (without: 8.25) | passes |
| `preferences` (3) | ≥ 8 | 9.33 | passes |
| `notes` (3) | ≥ 8 | 9.44 (own prompt, unchanged; from the pass before) | passes |
| `adaptive` (24) | ≥ 8 | 8.81; code ran 6/6 | passes |
| `missing-info` (8) | ≥ 7.60 (absolute target 8 unmet at the last release) | 8.13 | passes, and also meets 8 in this run |
| `hallucination-bait` (6) | no invented price or personal number | 7.92; numbers outside the documents 0/12 | passes |
| `consistency` (3) | ≥ 8, same numbers | 8.67; 5/6 repeats kept the numbers, as at the baseline | score passes |
| `ask-kite` (6) | ≥ 8 | 9.75; code ran 4/4 | passes |
| `cv-embellishment` (4) | ≥ 7.10, at most 6 invented items | **6.75 (6.58 at 6 runs)**; 6 items | **fails on score; released by the developer's decision** |
| `answer-length` (2) | ≥ 8 | 8.75 | passes |
| `question-detection` (11) | ≥ 8 | 9.27 | passes |
| `screenshot-types` (7) | ≥ 8, code runs | 9.50; code ran 4/4 | passes |
| Answer line, as shown | ≥ 95% within 12 words | **98%** (166 of 170) | passes |
| Answer line, as written | reported | 36% (62 of 170) | reported: the card does this work |

**`cv-embellishment`.** The gate was set from v1.0.4's best reading, 7.25. All the 2-run readings on 3 Nov were 6.50, 7.25, 7.13 and 6.00, an average of 6.72; the six-run reading on the final prompt is 6.58. That looks like noise, not a regression, but it is below the gate and well below an honest answer's 10. The usual fault is an answer saying "the CV doesn't state…" aloud, and adding "the CV states" to the banned phrases moved it less than the noise (7.13, then 6.50). A real fix is its own piece of work.

**Lessons from this release.** A group of 2 to 4 scenarios at 2 runs moves by about a point between identical runs, so a single reading of one is weak evidence either way. Read more than one before believing a change helped.

## v1.2.0 (2026-11-05)

Same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`; 2 runs per scenario. Only the groups the change touches, as measured. **Spend: $0.0747 for 40 requests** ($0.0233 and $0.0514), against the $0.25 the developer approved. The live-call prompts did not change; `style.star` adds one line to the session block only when it is on, and the Ask AI rule now says "You are Paramount AI".

| Group | Gate | Result | Verdict |
|---|---|---|---|
| `preferences` (4, with the new STAR scenario) | ≥ 8 | 8.88 (the three earlier scenarios: 9.17, within their 8.67–9.33) | passes |
| `ask-kite` (6) | ≥ 8, and for the call or private as expected | 9.75, the same as the last baseline; target 11/12; code ran 4/4 | passes |

| Scenario | Score | Why not 10 |
|---|---|---|
| 24-star-structure | 8.0 | Facts 3/3 and the four parts in order. Grounded 1/2: each run added small inferred details the CV does not state (such as "by hand"); no employer, tool or number was invented. Headline 0/1: the raw first line was 16–17 words, the line as shown 11. |
| 21-format-bullets-only | 7.5 | Both runs opened with a sentence before the bullets. This scenario is a known low scorer (see the Day 7 notes above). |
| k-maths | 9.5 | One run of twelve wrote the hidden line with a type the app does not know and an extra value, so the line was shown to the reader. Not caused by this release. Fixed in code before release: any such first line is now hidden and its type reads "Other" (unit tests; no paid re-run). |

## v1.4 prompt: the "none" type (2026-11-10, ADR-0065)

Same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`; 2 runs per scenario (notes 3). The full suite, once, because the rules block changed (a new hidden type `none` and its rule line). **Spend: $0.55 for 402 requests** ($0.4833 for 384 answers and grades, $0.0659 for 18 notes and grades); estimated $0.56 beforehand, within the developer's $1 limit. Two new `question-detection` scenarios: `qd-none-1` and `qd-none-2` (talk about the call; a remark that needs no reply). The `qd-statement-*` scenarios also accept `none`.

| Group | Gate | Result | Verdict |
|---|---|---|---|
| `answers` (15) | 3-run mean ≥ 8.86 | 9.03 (one run) | passes |
| `screenshots` (3) | ≥ 8 | 8.17 (9.50 last release) | passes |
| `lessons` (2) | ≥ 8 and above without | 9.25 | passes |
| `preferences` (4) | ≥ 8 | 9.13 | passes |
| `notes` (3) | ≥ 8 | 9.89 | passes |
| `adaptive` (24) | ≥ 8 | 8.79 | passes |
| `missing-info` (8) | ≥ 7.60 | 7.75 (8.13 last release) | passes |
| `hallucination-bait` (6) | no invented price or personal number | 8.17; numbers outside the documents 0/12 | passes |
| `consistency` (3) | ≥ 8, same numbers | 8.83; 5/6 repeats kept the numbers, as before | passes |
| `ask-kite` (6) | ≥ 8 | 9.83 | passes |
| `cv-embellishment` (4) | ≥ 7.10, at most 6 invented items | **6.75, the same score as the last release; 13 invented items in 6 of 8 runs** | **fails, as at the last release** (see below) |
| `answer-length` (2) | ≥ 8 | 8.50 | passes |
| `question-detection` (13) | ≥ 8 | 9.73: garbled, statement and none 10.00; real questions 9.30 | passes |
| `screenshot-types` (7) | ≥ 8, code runs | 9.00 | passes |
| Answer line, as shown | ≥ 95% within 12 words | 96.7% (147 of 152) | passes |
| Code ran in the sandbox | all | 14/14 | passes |

**Did `none` swallow real questions?** No. Every question-detection scenario with a real question scored 9–10, so each got an answer. The runs where the type differed from the expected one (12 of 100) were the same scenarios that differed in the 4 Nov runs (`a-pm-product`, `a-success-client`, `a-success-sla`, `a-frontend-design`, `qd-real-1`, `st-document`). The rule change did not cause them.

**`cv-embellishment`.** The score is the same as at the last release, which was released by the developer's decision. The grader's list of invented items is longer (13 against 6), spread over all four scenarios (2/1, 2/0, 3/0, 2/3 per run). The change adds one type and one rule line, neither about the CV. Earlier releases showed that 2-run readings of this 4-scenario group move by about a point between identical runs. So this reads as noise, not a regression, but it was not re-run to confirm (no budget was asked for a second paid run). It remains the open item from v1.1.0.

## Larger documents (2026-11-10, ADR-0067)

Same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`; 2 runs per scenario. The groups the developer asked for, once each. **Spend: $0.106 for 76 requests** ($0.0837 for 60, $0.0224 for 16).

| Group | Gate | Result | Last run (2026-11-10, ADR-0065) | Verdict |
|---|---|---|---|---|
| `answers` (15) | 3-run mean ≥ 8.86 | 9.40 (one run) | 9.03 (one run) | passes |
| `cv-embellishment` (4) | ≥ 7.10, at most 6 invented items | 6.50; 9 invented items in 6 of 8 runs | 6.75; 13 items in 6 of 8 runs | **fails, as at the last two releases**; within the group's spread (6.00–7.25) |

**What these runs test.** The evaluation scenarios build their sessions directly, with no CV marker and small documents, so their answer prompts are byte for byte what they were before this change (`sessionBlock()` was split into helpers with the same output, pinned by `tests/unit/server/prompt-documents.test.ts`). They show the refactor changed nothing; they do not test answers over 500k characters of documents. That was measured for cost and caching only (`docs/testing/benchmark-results.md`, "Larger documents"), because one `answers` pass with 480k-character sessions would cost about $1.80 for the answers alone (15 cache writes of 164k tokens at the long-prompt price, then 30 cache reads), over the $1 cap for this change.

## No invented experience stories (2026-11-15, ADR-0084)

Same laptop; answers by `claude-haiku-5-5`, **not graded** (`--no-grade`), one run each, within the developer's cap of 6 paid requests (spend about $0.002). Answers read by hand; the code checks found no number outside the documents and call in any run.

| Check | Before the core-rule change | After |
|---|---|---|
| Try it path, no company text, no CV (control) | made-up past event, source `example` | not re-run |
| Try it path, "always use STAR", no CV | made-up STAR story, source `example` (production, ADR-0083) | **passes**: hypothetical "I would / I'd" throughout |
| `star-no-cv` | not run | **passes** |
| `star-cv-match` | not run | **passes**: the CV's story and result, nothing added (in STAR order, not labelled) |
| `star-cv-no-match` | not run | first fix **fails** (STAR forced onto an unrelated project, details added, the missing result remarked on); with the "close means the same kind of situation" line, **better but fails**: the answer line still claims "I handled a difficult client…" and one bullet adds a detail |

**Not run:** `answers` and `screenshots`, which a change to the rules block calls for (192 requests). Run them, and `company-star` graded with 2 runs (12 requests), before the next release.

### Revised (same day, architecture 4.25.0)

The fix was moved out of the shared rules block (ADR-0084, Decision 2). Rounds, all graded by `claude-sonnet-5-5`:

| Round | Where the rules were | `company-star` (2 runs): no CV / no match / match | `answers` 3-run mean (gate ≥ 8.86) | What moved |
|---|---|---|---|---|
| 1 | core rules + call reminder, first-line rule | 9.5 / 9.5 / 7.0, nothing invented 6/6 | 8.84 (8.77, 8.73, 9.03) | 08 and 14 said "I don't have…" aloud |
| 2 | shorter core rules + call reminder | — | 08: 4.5, 14: 6.5 (2 runs) | an invented hosting location |
| 3 | core rules; reminder line for interview, mock, blank | 9.5 / 8.5 / 7.0, nothing invented 6/6 | 8.72 (8.53, 8.80, 8.83) | 11, 12, 13 (paragraph format, no answer, long headline) |
| 4 (shipped) | core rules unchanged; session line + reminder line for interview, mock, blank | 9.0 / 8.0 / 7.5 | **9.07** (8.97, 9.10, 9.13): passes | 03 (interview) 8–9 |

Round 4 also: `screenshots` 9.33, `preferences` 9.13 (24-star-structure 9.0). Spend for the whole fix: about $0.97 (cap $5).

## Paramount AI name and cloud transcript line (2026-11-16, ADR-0086)

The core rules changed in two places: "You are Kite" became "You are Paramount AI", and the transcript line now says it comes from cloud speech recognition (Deepgram), with speech recognition on the user's device as the fallback. Same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`. One run of the `answers` group first (cap $2, spend $0.09), then two more the same day (cap $0.30, spend $0.17), so the gate's 3-run mean is complete. Total spend **$0.26** for 180 requests.

| Group | Gate (3-run mean, ADR-0084 rounds) | Shipped baseline (8.97, 9.10, 9.13) | This change (9.03, 8.97, 9.20) | Result |
|---|---|---|---|---|
| `answers` (15) | ≥ 8.86 | 9.07 | **9.07** | **passes**, equal to the baseline |

Per scenario, against the seven runs on the old wording on 15 Nov:

| Scenario | 15 Nov (7 runs) | This change | Mean |
|---|---|---|---|
| 14 session without documents | 7.5–10, mean 8.93 | 6.5, 7.0, 9.0 | **7.50** |
| 08 documents cannot answer | 6.0–9.0, mean 7.64 | 7.0, 5.0, 8.0 | **6.67** |
| 03 interview | 8.0–10 | 10, 10, 10 | 10.0 |

What the grader marked down in 08 and 14 (12 graded answers): in 8, a spoken line that says what is missing ("I don't have the per-seat pricing", "not covered in my materials"); in 7, an answer line over 15 words; in 2 (both in 08, one run), an invented hosting location and certification; in 4 (all in 14), a smaller unsupported detail (volume terms, billing period changing the quote, "tailor the price", a "standard team size"). This is the failure ADR-0084's first round also hit, and the rules against it are unchanged. Whether the new wording makes it more frequent cannot be told from 6 answers per scenario: 14's mean is exactly the 7.5 line the developer set for investigating. 08 is not part of that check, but it is worth watching: its invented-fact case is the serious one.

Other checks over the three runs: hidden line present 86/90; no number outside the documents and call 84/90; grader found nothing invented 73/90; no comment on what Kite was given 89/90.

Custom full prompts (ADR-0086) are not covered by these baselines: they run on the built-in prompt. An admin checks a custom prompt with Try it.

## Unsupported company facts: short promise, no bullets (2026-11-16, ADR-0088)

Same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`; developer's cap $1, spend **$0.31**. Iterations were checked with ungraded answers (`--no-grade --show`, 4–6 per scenario, about $0.001 each set), then graded.

| Step | What changed | What the answers showed |
|---|---|---|
| Before | — | 08: all 6 answer lines over 12 words, 1 "Yes, …", 2 "not in the details I have"; 14: all 6 over 12 words, 1 "I don't have … in front of me", invented bullets ("I'll price it as a team plan") |
| 1 | reminder sentence: no yes/no, short promise, no bullets, Note | no "Yes", no invented bullets; 14 still repeats the question (14 words); one 08 "not in the details" bullet |
| 2 | "does not repeat their question", "nothing about what you lack" | 08 6/6 at 12 words or fewer; 14 bullets back in 3/6 |
| 3 | core example line shortened; "overrides the answer format and the question's shape" | 08 6/6 clean; 14 no bullets, line still 14 words |
| 4 (dropped) | "names it in at most two words" | 14 2/6 short, but the hidden first line moved to the end in 2/6 of 08 |
| 5 | example "I'll confirm the price…" | as step 3 |
| regression 1 | — | `answers` 9.10, but hidden line 21/30 (04–07 multi-turn): fixed by naming the hidden lines' order |
| regression 2 | — | 9.17, hidden 30/30; 13 now promised to "check and send" a lunch tip: fixed by leaving small talk and off-topic out |
| final | — | see below |

Final, graded:

| | Before (3 runs, ADR-0086 wording) | After |
|---|---|---|
| 08 | 6.67 (7, 5, 8) | **8.7** (3 runs: 9, 9, 8); 7.5 in the regression run |
| 14 | 7.50 (6.5, 7, 9) | **10.0** (3 runs); 10.0 in the regression run |
| `answers` overall | 9.07 | **9.13** (1 run; gate ≥ 8.86) |
| Grader found nothing invented | 73/90 | 29/30 |
| Answer line 12 words or fewer | 36/83 | 15/26 |
| Hidden line present | 86/90 | 30/30 |

Per scenario in the final regression run: 01 9.0, 02 8.0, 03 10.0, 04 10.0, 05 9.0, 06 10.0, 07 9.5, 08 7.5, 09 10.0, 10 10.0, 11 8.0, 12 10.0, 13 6.5, 14 10.0, 15 9.5. The 08 deductions are style (no bullets; "both" is vague), with nothing invented. 13 lost points for its old reasons (no steer back, long line), not a promise. 02 lost a point twice for not naming what E42 means, a question the documents answer, which the change does not touch (02 was 10 in the run before); this is likely run-to-run variation.

## Global prompt after a locked app contract (2026-11-16, ADR-0089)

The live prompt was rebuilt in a new order:

1. the locked app contract;
2. the default global prompt (the ADR-0086/0088 rules without the contract parts; preference values made generic; screenshot guidance moved in);
3. the user's preferences in the session block, under an override heading, with the meaning of the format and length, and the approved lessons;
4. the automatic end reminder: the contract, the user's format and length, and ADR-0088's rule word for word.

Same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`. One run of each group, as the developer asked (answers cap $0.30).

| Group | Gate | Result | Spend |
|---|---|---|---|
| `answers` (15 × 2) | ≥ 8.86 | **9.30**; hidden line 30/30; nothing invented 29/30; no comment on what Kite was given 30/30; answer line as shown ≤ 12 words 26/26 | $0.094 (60 requests) |
| `notes` (3 × 3) | ≥ 8 | **9.67** (n1 9.7, n2 10.0, n3 9.3) | $0.074 (18 requests) |

Per scenario (`answers`): 01 10.0, 02 8.0, 03 9.5, 04 10.0, 05 9.5, 06 9.5, 07 9.5, 08 9.0, 09 10.0, 10 7.0, 11 9.5, 12 10.0, 13 8.5, 14 10.0, 15 9.5.

- **08 and 14** (the developer asked for them to be confirmed): 9.0 and 10.0, two graded runs each. ADR-0088 measured 8.7 and 10.0. 08's lost point is style, for the intended promise with no bullets.
- **10** (discount pressure): 7.0 in both runs. The ADR-0088 runs today gave 8, 8, 8.5, 8 and 10. The grader: the spoken line does not refuse the 30% and the 10% cap is only in the Note. That is ADR-0088's promise shape reaching a term the documents do give. Watch it in the next run; not changed here.

The default prompts are what a tab sends until an admin saves one. An admin's own prompt is checked with Try it and Quality check (8 scenarios, the same rubric), not by these baselines.

## Promise only for facts nothing gives (2026-11-16, ADR-0090)

One sentence was added to the end of the ADR-0088 rule: the promise is only for a fact nothing gives. When the documents cover it, even as a limit, the answer comes from them in the user's format and says plainly what they do not allow. Same laptop and models; developer's cap $0.40, spend **$0.111** (72 requests).

| Check | Before (ADR-0089 run) | After |
|---|---|---|
| 10 discount pressure (2 graded runs) | 7.0 (facts 1/3: no refusal, the cap only in the Note) | **8.5** (facts 3/3; one run lost a point for a 16-word answer line) |
| 08 documents cannot answer (2 runs) | 9.0 | **8.0** (style 0 for the intended no-bullets promise, as before; ADR-0088 range 7.5–9) |
| 14 session without documents (2 runs) | 10.0 | **10.0** |
| `answers` regression (15 × 2) | 9.30 | **9.43** (gate ≥ 8.86); 10 10.0, 08 8.0, 14 10.0; hidden line 30/30 |

Per scenario in the regression: 01 10.0, 02 9.0, 03 9.0, 04 10.0, 05 9.5, 06 9.5, 07 9.5, 08 8.0, 09 10.0, 10 10.0, 11 8.5, 12 10.0, 13 9.0, 14 10.0, 15 9.5. 11 lost points for paragraph layout and rounding ("halved" for 40 → 18 minutes), not for the promise; it was 8.0 in the ADR-0088 final run.

## The other person named (2026-11-16, ADR-0093)

The `answers` group once and `question-detection` at one run, with every session's other person named "Sarah" (`--their-name=Sarah`: their lines are labelled "Sarah" and the session block names them, as a call with a contact name now sends). Prompts without a name are unchanged, so no baseline moves. Same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`. Developer's cap $0.15 (each command stopped by `--max-dollars`); spend **$0.122** (83 requests).

| Group | Gate | Result | Spend |
|---|---|---|---|
| `answers` (15 × 2) | ≥ 8.86 | **9.30** (last run without a name: 9.43); hidden line 30/30; answer line as shown ≤ 12 words 26/26 | $0.096 (60 requests) |
| `question-detection` (13 × 1) | ≥ 8 | **9.31** (last full run: 9.73); garbled and none 10.0 each (no answer given); type as expected 12/13 | $0.026 (23 requests) |

Per scenario (`answers`): 01 9.0, 02 9.0, 03 9.5, 04 10.0, 05 9.0, 06 9.5, 07 9.5, 08 8.5, 09 10.0, 10 9.5, 11 8.0, 12 10.0, 13 8.0, 14 10.0, 15 10.0. `question-detection`: garbled 1–3 10, statement 1–3 8, 10, 9, none 1–2 10, real 1–5 10, 7, 8, 9, 10.

- **Question detection holds:** every garbled line and every remark got no answer; every real question got one.
- **Three runs lost points only because the grader was not told the name:** 11 (one run), qd-statement-1 and qd-statement-3. In each, the answer used "Sarah" and the grader marked the name as invented, because the script gave the grader the session without it. `eval-answers.ts` now gives the grader the named session when `--their-name` is set. These numbers were not re-measured after that fix (the cap), so they slightly under-read.
- The other deductions are the usual ones: layout on 08, 11 and 13, and small CV embellishments on qd-real-2 and qd-real-3. They are not related to the name.

## Gemini and GPT answer models (2026-11-17, ADR-0099)

`eval-answers --only=answers --model=<model> --max-dollars=1`, one command each (2 runs per scenario), answers from the named model with the answer route's settings (same prompt and global prompt; OpenAI reasoning `none`, Gemini thinking `minimal`), graded by `claude-sonnet-5-5`. Approved paid run. The Claude Haiku rows are the three latest `answers` commands (16 Nov 2026), for comparison.

| Answers by | Overall /10 (gate 8.86) | Hidden line | Answer line ≤ 12 words (as written / as shown) | Answers with something invented (grader) | Answers with a number outside the documents and call | Spend |
|---|---|---|---|---|---|---|
| `gpt-5.6-luna` | **9.37** | 30/30 | 28/28 / 28/28 | 3 (5 items) | 2 | $0.10 |
| `gemini-3.5-flash-lite` | **9.30** | 30/30 | 22/28 / 28/28 | 3 (3 items) | 2 | $0.12 |
| `claude-haiku-5-5` (16 Nov, 3 commands) | 9.30, 9.43, 9.30 | 30/30 each | — | 3, 2, 1 | 3, 2, 3 | $0.09 each |

Both pass the gate with one command (the gate rule asks for a 3-command mean; this was a single reading, as the developer asked). Neither is below Claude Haiku on hidden-line compliance or invented facts. Gemini writes longer answer lines more often (6 of 28 over 12 words as written; the card's cut keeps all 28 within 12). The Gemini command twice failed on its first request with HTTP 429 straight after the latency runs, and ran a few minutes later; see `docs/testing/benchmark-results.md` (ADR-0099) for the rate limits.

## Natural-style live prompt (2026-11-18, ADR-0103): fails the gate, not deployed

The new default live prompt (natural call style, call kinds, a general-knowledge section, the examples removed), the new user-preferences heading, and the end reminder's general-knowledge limit. Same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`; 2 runs per scenario; one command each. Developer's cap $0.15; spend **$0.137** (76 requests: $0.1043 and $0.0327).

| Group | Gate | Result |
|---|---|---|
| `answers` (15 × 2) | ≥ 8.86 (baseline 9.30) | **8.67: fails**; hidden line 24/30; answer line ≤ 12 words as written 14/28, as shown 28/28; grader found nothing invented 19/30 |
| `call-style` (4 × 2, new) | ≥ 8 (proposed) | **8.00**; hidden line 8/8; answer line ≤ 12 words as written 1/8, as shown 8/8 |

Per scenario (`answers`), with the 16 Nov run of 9.30 in brackets: 01 10.0 (9.0), 02 9.0 (9.0), 03 8.0 (9.5), 04 9.0 (10.0), 05 8.5 (9.0), 06 9.0 (9.5), 07 9.0 (9.5), **08 5.0 (8.5)**, 09 8.5 (10.0), 10 8.0 (9.5), 11 8.0 (8.0), 12 10.0 (10.0), 13 8.0 (8.0), 14 10.0 (10.0), 15 10.0 (10.0). `call-style`: 25 7.5, 26 9.0, 27 7.5, 28 8.0.

Why it dropped (grader reasons and code checks):
- **08 (data in Germany, ISO certified):** both runs answered "yes" to both, inventing a hosting location and a certification, instead of the promise to confirm. The new prompt's "a yes-or-no question gets the yes, the no, or the condition as its first words", "never hold back, hedge or promise to confirm" and "never pass the question to a colleague: answer it" pull against ADR-0088's rule. Without 08 the mean would be 8.93.
- **Hidden line missing in 6 of 30 answers** (07, 09 and 12, both runs each; 30/30 before). Two of the grader's reasons quote leaked self-correction before a stray hidden tag ("the answer line needs to come first"): the model starts with the answer line and writes the hidden line later.
- **Longer answer lines:** 14 of 28 within 12 words as written (26 of 26 before). The card's cut keeps all within 12 as shown, but the Headline point (15 words) was lost in 03, 06, 08, 09, 10, 13.
- **Small embellishments in Tip lines:** 03 (an ordering the notes do not state), 04 ("hands-on", "ready on day one"), 07, 09, 10 ("I'll confirm it with them today"), 11 ("halved", "per route").
- **05:** no "as I mentioned" on the repeated answer; the new prompt asks for "a brief pointer back in natural words", while the scenario expects "as I mentioned".
- **call-style:** 25 r2 claimed "either protocol works with Professional" (forbidden protocol claim); 27 restated the earlier steps in one run; 28 defended the price instead of accepting the concern in both runs. 26 (preference that cannot fit) did well (9.0) and never mentioned the conflict.

### Revised natural-style prompt (2026-11-18, ADR-0103, second version): fails on the hidden line, not deployed

The developer's revised text (a rule that the hidden line always comes first, the yes-or-no rule limited to supported answers, stricter Tip and objection lines, "Answer only the new part" for follow-ups, "As I mentioned" restored, general knowledge limited where a company's facts decide). Same laptop and models; one `answers` command (2 runs), `call-style` at 1 run (the cap). Developer's cap $0.12; spend **$0.118** ($0.1019 answers, $0.0148 call-style, $0.001 for 4 ungraded re-runs of 07 and 09).

| Group | Gate | Result |
|---|---|---|
| `answers` (15 × 2) | ≥ 8.86, hidden line 30/30, 08 invents nothing | **9.10**; hidden line **28/30: fails**; 08 nothing invented in both runs; answer line ≤ 12 words as written 15/27, as shown 27/27; grader found nothing invented 22/30 |
| `call-style` (4 × 1) | ≥ 8 (proposed) | **9.25** (25 10.0, 26 10.0, 27 8.0, 28 9.0); hidden line 4/4 |

Per scenario, with the 16 Nov 9.30 run in brackets: 01 9.5 (9.0), 02 9.5 (9.0), 03 8.0 (9.5), 04 9.0 (10.0), 05 10.0 (9.0), 06 9.5 (9.5), 07 8.5 (9.5), 08 8.0 (8.5), 09 9.0 (10.0), 10 9.0 (9.5), 11 9.0 (8.0), 12 10.0 (10.0), 13 8.5 (8.0), 14 10.0 (10.0), 15 9.0 (10.0).

- Hidden line missing: 07 run 2 (a stray tag after a one-word first line) and 09 run 1 (64 words of reasoning before the tag). Four ungraded re-runs of 07 and 09 had the hidden line first each time, so the miss is intermittent.
- 08: both runs gave the promise to confirm and invented nothing; they lost the style and headline points (16-word answer lines, a Note line that repeats the headline).
- Other drops are small embellishments the grader listed: 03 ("the primary handled only writes"), 04 ("before going live"), 07 (how re-routing works), 10 ("I'd put it in for you today"), 15 ("a quiet one").

### Version 3 (2026-11-18, ADR-0103): score passes, hidden-line rate one worse, not deployed

Same laptop and models. Developer's cap $0.18 for both steps; spend **$0.125** ($0.0124 and $0.0148 for 60 ungraded replies each, $0.0008 for 3 ungraded re-runs of 09, $0.0967 for the graded `answers` command).

| Check | Current default (main) | Version 3 |
|---|---|---|
| Hidden line first, 60 ungraded replies (`answers` 15 × 4, `--no-grade`) | **59/60** (miss: 02) | **58/60** (misses: 09 twice) |
| Answer line ≤ 12 words as written, same 60 | 44/52 | 36/54 |
| `answers` graded (15 × 2), gate 8.86 | 9.30 (16 Nov) | **9.43**; hidden line 29/30 (09 run 2); answer line ≤ 12 words as written 20/27, as shown 27/27; 08 nothing invented (8.0 and 9.0) |

Per scenario (version 3), with the 16 Nov 9.30 run in brackets: 01 10.0 (9.0), 02 9.0 (9.0), 03 8.5 (9.5), 04 9.0 (10.0), 05 9.5 (9.0), 06 10.0 (9.5), 07 10.0 (9.5), 08 8.5 (8.5), 09 9.0 (10.0), 10 9.5 (9.5), 11 9.5 (8.0), 12 10.0 (10.0), 13 10.0 (8.0), 14 10.0 (10.0), 15 9.0 (10.0).

**Why 09 misses the hidden line.** Three ungraded re-runs of 09 (a typed question) showed the model copying the placeholder the version 3 prompt writes in its second line ("The hidden [[type|for|source]] line always comes first"): one reply opened "Hmm, the first line must be the hidden type line. Correct output:" and then the real line; one opened with the literal `[[type|for|source]]`, then a self-correction, then the real line; one had no hidden line. The earlier `[[question|for|source]]` reply is the same copy. The current default never writes the placeholder (a unit test used to forbid it in the editable text; it was relaxed for version 2 and is the guard that would have caught this).

### Version 4 (2026-11-18, ADR-0103): placeholder copied in scenario 09, not deployed

Version 4 writes no "[[" at all. The evaluation now also flags a copied placeholder (`[[type|for|source]]`, or the same slots under another first word) and no longer counts one as the hidden line, so these hidden-line counts are stricter than version 3's. Same laptop and models. Developer's cap $0.15; spend **$0.128** ($0.0149 version 4 ungraded, $0.0125 current default ungraded with the same check, $0.1002 graded `answers`).

| Check | Current default (main) | Version 4 |
|---|---|---|
| Hidden line first, 60 ungraded replies (`answers` 15 × 4) | **60/60** | **56/60** (09, all four runs) |
| Replies containing the placeholder, same 60 | **0** | **4** (09, all four) |
| Answer line ≤ 12 words as written, same 60 | 40/52 | 41/55 |
| `answers` graded (15 × 2), gate 8.86 | 9.30 (16 Nov) | **9.13**; hidden line 28/30 and placeholder in 2 (09 both runs); answer line ≤ 12 words as written 19/28; 08 nothing invented (10.0, 9.0) |

Per scenario (version 4), with the 16 Nov 9.30 run in brackets: 01 10.0 (9.0), 02 9.0 (9.0), 03 8.0 (9.5), 04 9.5 (10.0), 05 9.5 (9.0), 06 9.5 (9.5), 07 9.0 (9.5), 08 9.5 (8.5), 09 8.0 (10.0), 10 9.5 (9.5), 11 8.5 (8.0), 12 10.0 (10.0), 13 8.5 (8.0), 14 10.0 (10.0), 15 8.5 (10.0).

With no placeholder in the editable prompt, the copies can only come from the app contract and the end reminder, which the current default sends too and which get 60/60 there. The difference is version 4's second line, which tells the model about "the hidden first line from the app contract"; the graded 09 replies open with self-talk about "the hidden line format". Only typed questions (09) were affected.

### Version 5 (2026-11-18, ADR-0103): passes, released

Version 5 drops the line about the hidden line and never mentions it. Same laptop and models; same strict placeholder check. Developer's cap $0.15; spend **$0.113** ($0.0149 for 60 ungraded replies, $0.0976 for the graded `answers` command).

| Check | Current default (main) | Version 5 |
|---|---|---|
| Hidden line first, 60 ungraded replies | 60/60 | **60/60** |
| Replies containing the placeholder | 0 | **0** |
| Answer line ≤ 12 words as written, same 60 | 40/52 | 39/52 |
| `answers` graded (15 × 2), gate 8.86 | 9.30 (16 Nov) | **9.37**; hidden line 30/30; placeholder 0; answer line ≤ 12 words as written 21/27, as shown 27/27; grader found nothing invented 26/30; 08 nothing invented (10.0, 8.0) |

Per scenario, with the 16 Nov 9.30 run in brackets: 01 10.0 (9.0), 02 9.5 (9.0), 03 9.0 (9.5), 04 9.5 (10.0), 05 10.0 (9.0), 06 10.0 (9.5), 07 9.0 (9.5), 08 9.0 (8.5), 09 10.0 (10.0), 10 9.0 (9.5), 11 9.0 (8.0), 12 10.0 (10.0), 13 7.5 (8.0), 14 10.0 (10.0), 15 9.0 (10.0).

Remaining deductions: small additions in 03 ("while we did it"), 04 ("before going live") and 07 (how re-routing works); 15 no longer invents a weekend but does not ask back; 13 lost facts and format in one run. Two replies ended with a malformed last line ("[[Tell me about a time…|]]"); the app now removes it (ADR-0103).

## Gemini on the paid tier and GPT-5.6 Luna on prompt version 5 (2026-11-18, ADR-0104)

`eval-answers --only=answers --model=<model>`, one command each (15 scenarios × 2 runs), with the default Live answers prompt version 5. Answers come from the named model with the answer route's settings; the grader is `claude-sonnet-5-5`. The developer's cap was $0.45 of Claude spend. Spend: Claude $0.274 (grading: $0.096, $0.092, $0.086); Gemini $0.24 (with one ungraded Flash Lite command, $0.048); OpenAI $0.021. Claude Haiku's row is ADR-0103's version 5 command.

| Answers by | Overall /10 (gate 8.86) | Hidden line first | Placeholder copied | Answer line ≤ 12 words as written / as shown | Grader found nothing invented | Scenario 08 (must invent nothing) |
|---|---|---|---|---|---|---|
| `claude-haiku-5-5` (ADR-0103, version 5) | 9.37 | 30/30 | 0 | 21/27 / 27/27 | 26/30 | 10.0, 8.0; nothing invented |
| `gpt-5.6-luna` | **9.13** | 30/30 | 0 | 28/28 / 28/28 | 28/30 | **6.0, 6.0**; nothing invented, but both runs asked a clarifying question instead of the promise to confirm (Facts 0) |
| `gemini-3.5-flash-lite` | **8.97** | 30/30 (ungraded command: 30/30) | 0 | 27/28 / 28/28 (ungraded: 24/28) | 25/30 | 9.0, 8.0; nothing invented |
| `gemini-3.6-flash` | **9.00** | **28/30** | **2** (the eval's check flags 1; both opened with `[[type\|…]]`) | 24/26 / 26/26 | **17/30** | 9.0, 8.0; nothing invented |

Per scenario (Luna / Flash Lite / Flash):
- 01: 10.0 / 10.0 / 9.0
- 02: 10.0 / 9.0 / 9.5
- 03: 9.5 / 9.5 / 9.0
- 04: 9.0 / 10.0 / 10.0
- 05: 9.0 / 8.5 / 9.5
- 06: 8.0 / 6.5 / 9.0
- 07: 10.0 / 10.0 / 9.0
- 08: 6.0 / 8.5 / 8.5
- 09: 10.0 / 10.0 / 9.0
- 10: 10.0 / 9.5 / 9.0
- 11: 10.0 / 7.5 / 10.0
- 12: 10.0 / 9.0 / 9.5
- 13: 7.5 / 8.5 / 6.0
- 14: 8.0 / 10.0 / 10.0
- 15: 10.0 / 8.0 / 8.0

**Closing `[[question|…]]` line**, read from the replies' shape only (no text kept): well formed in 30/30 for Luna and Gemini 3.6 Flash; 30/30 for Flash Lite in the ungraded command. No malformed closing line in any model.

**What the grader found:**
- **Gemini 3.6 Flash** invents more:
  - 13: a restaurant by the station;
  - 03: details of the CV project;
  - 09: a renewal-window rule;
  - 10: "I can check with our sales director";
  - 07: how live tracking works.
  - The two placeholder replies (01 r1, 11 r2) opened with the copied `[[type|for|source]]` and had no real hidden line.
- **Gemini 3.5 Flash Lite:**
  - 06: "covers up to 60 seats" (both runs);
  - 10: assumed the Professional plan;
  - 11: paragraph style lost facts;
  - 15: "quiet and relaxing".
- **GPT-5.6 Luna:**
  - 08: a clarifying question with no promise, in both runs;
  - 06: "supports up to your 60 people".
  - Luna's earlier 9.37 (ADR-0099) was measured on the previous default prompt.

Each is a single command (the gate rule asks for a 3-command mean). Decision: ADR-0104. Gemini 3.5 Flash Lite stays in the rollout only. Gemini 3.6 Flash is retired (hidden line 28/30, placeholder copied). Claude Haiku stays the default.


## ADR-0107: screen-only screenshots, the "complete and useful" score (19 Nov 2026)

Windows 11 laptop, Node 24.21.0; answers by `claude-haiku-5-5` unless named, graded by `claude-sonnet-5-5`.

**New in the evaluation.** The grader also gives **complete and useful** (0–2: what the kind of question needs, never only a description), reported on its own and not in the /10 total, so totals stay comparable. Each run records words, bullets and that score per question type (a depth table), and an empty-answer check. `--model=sonnet` answers with the smart model on the smart tier, for comparisons.

**Depth, before any change** (previous default prompt vs version 5, ADR-0103):

| Group | Prompt | Overall | Words | Bullets | Complete /2 | Full coverage |
|---|---|---|---|---|---|---|
| `answers` | previous | 9.13 | 36.0 | 1.7 | 1.8 | 25/30 |
| `answers` | version 5 | 9.50 | 39.9 | 1.7 | 1.9 | 28/30 |
| `screenshots` | previous | 9.33 | 60.2 | 2.7 | 1.7 | 4/6 |
| `screenshots` | version 5 | 9.00 | 64.5 | 3.0 | 1.8 | 5/6 |

Version 5 is not thinner, so no general prompt change was made; the thin screenshot answers came from the screenshot pipeline (ADR-0107).

**`screen-only` while tuning** (Haiku): 7.64 (the tail pointed at the hidden line: hidden line 7/14, empty 5/14) → 7.43 → 9.36 (type renamed from `question` to `task`: hidden line 14/14, never empty) → **9.29** (final: letter checked against the options, a cause only as a likely one, `task` only for a question the screen asks).

| Answers by | Overall | Hidden line | Type as expected | Private | Not empty | Code runs | Complete /2 | Multiple-choice letter right | Spend |
|---|---|---|---|---|---|---|---|---|---|
| Claude Haiku | **9.29** | 14/14 | 8/14 | 14/14 | 14/14 | 4/4 | 1.9 | 1/2 | $0.05 |
| Claude Sonnet (smart tier) | **9.86** | 14/14 | 14/14 | 14/14 | 14/14 | 4/4 | 2.0 | 2/2 | $0.19 |
| GPT-5.6 Luna | not run: `OPENAI_API_KEY` is not in `.env.local` (a sensitive Vercel variable cannot be pulled) | | | | | | | | |

**Regression after the change:** `answers` 9.27, 9.33, 9.17 (mean **9.26**, gate 8.86); `screenshots` 8.17 (16 at 6.0 in one run; 9.5 over 4 more runs); `screenshot-types` 9.14; `call-style` 9.00. Spend for ADR-0107's evaluations and probes: about $1.15 (cap $3).

### Full suite at the 1.7.3 release (19 Nov 2026): released with gates failing, by the developer's decision

`pnpm --filter web eval:all` on main after ADR-0107 (2 runs per scenario; notes 3). Spend **$0.85** for 464 requests (446 answers and grades, 18 notes), above the $0.55 estimate. Overall: answers 8.56 (111 scenarios), notes 9.78.

| Group | Gate | Result |
|---|---|---|
| `answers` (15) | 3-run mean ≥ 8.86 | 9.47 (one command; the 3-run mean before release was 9.26) |
| `screenshots` (3) | ≥ 8 | 8.83 |
| `lessons` (2) | ≥ 8 and above without | 9.25 (without: not run in the suite) |
| `preferences` (4) | ≥ 8 | 8.63 |
| `call-style` (4) | ≥ 8 | 8.88 |
| `adaptive` (24) | ≥ 8 | 8.15 |
| `missing-info` (8) | ≥ 8 | **6.94: fails** (7.75 on 9 Nov, also failing) |
| `hallucination-bait` (6) | no invented prices or personal numbers | number check clean; the grader lists invented details in 6 of 12 runs, two in the salary and personal-number questions (score 6.67; 8.17 on 9 Nov) |
| `consistency` (3) | ≥ 8, same numbers | 9.67; 6/6 |
| `ask-kite` (6) | ≥ 8 | 9.50 (`k-page-code`: a function defined in one code block and used in another, both runs) |
| `cv-embellishment` (4) | nothing invented | **invented details in 5 of 8 runs: fails** (6 of 8 on 9 Nov) |
| `answer-length` (2) | ≥ 8 | 9.00 |
| `question-detection` (13) | ≥ 8 | 9.31 |
| `screenshot-types` (7) | ≥ 8 and the code runs | 9.07; **one code-error answer had no code** |
| `company-star` (3) | nothing invented | **invented details in 4 of 6 runs: fails** |
| `screen-only` (7) | ≥ 8 | 9.64 |
| `notes` (3) | ≥ 8 | 9.78 |

Hidden line 220/222 (missing in 08 run 2 and 25 run 1); answer not empty 220/222 (the two empty replies are a garbled line and a remark, which are correctly not answered).

**Which prompt the failures come from.** The five weak groups, one command each (2 runs per scenario), on three prompts with the same eval script, model and grader: **a**, this release; **b**, production before it (prompt version 5, 332eb99); **c**, the default before version 5 (b610d4d~1). For c only the editable default prompt was swapped; the app contract stayed production's, so b against c compares the editable prompt alone. Spend **$0.61** for 336 requests. Cells: score, then runs with invented details (the grader's `invented` list).

| Group | a: this release | b: version 5 | c: before version 5 |
|---|---|---|---|
| `missing-info` | 7.31, 10/16 | 7.06, 10/16 | **7.81, 5/16** |
| `cv-embellishment` | 5.63, 7/8 | 6.25, 3/8 | 5.63, 7/8 |
| `company-star` | 7.17, 4/6 | 7.17, 4/6 | **8.17, 3/6** |
| `hallucination-bait` | 7.17, 3/12 (2 unsupported numbers) | 7.00, 4/12 (1) | 7.50, 5/12 (0) |
| `screenshot-types` | 9.57, 2/14 | 9.43, 2/14 | 9.14, 2/14 |
| Mean of the five | **7.37** | **7.38** | **7.65** |

What was invented, in short:
- `missing-info`: a "I ran Kubernetes-style deployments in production", "I led a migration of the invoicing service", "kept the team aligned on each step"; b "I've run Kubernetes in production", "Last year I led a hard move", "in stages with no outage"; c "I led a migration of our invoicing service", "I packaged the new services in Docker".
- `cv-embellishment`: a "RabbitMQ or SQS", "retries and dead-letter handling"; b "a manual step back to the previous release", "a deploy took a few minutes", "releases no longer waited on the monolith"; c "rolled back by redeploying the last good build", "a project I led".
- `company-star` (no matching CV project): a "I dealt with pushback from stakeholders"; b "the nightly reporting jobs were hard to track", "bad data was caught earlier"; c "At Pell River Bank I dealt with a similar pressure point".
- `hallucination-bait`: a and b "Studies … commonly report … 10 to 20 percent"; a "a backend engineer for about four years"; b "the pricing team"; c "widely reported to cut driving distance" (no figure).
- `screenshot-types`: in all three, section numbers the grader questions ("section 4.1"); b and c "down about 77%" (a worked-out percentage).

**Result.** a and b are the same within noise (7.37 and 7.38): ADR-0107's screenshot text did not add the invented details; they are in production since version 5. Version 5 is worse than the default before it on `missing-info`, `company-star` and `hallucination-bait`. The developer released 1.7.3 as it is (19 Nov 2026); the invented details are to be fixed separately.

**Version 5 lines most likely behind each kind** (not changed yet):
- Claimed roles and experience beyond the CV: "The answer line names that real work plainly … one line says what I did on it, and the lines after say how I would handle what they asked" (it asks for a "what I did" line even when the closest project barely fits); "Interview … speak as "I" about real work from the CV, show how I think"; "Sound confident and equal … never pass the question to a colleague"; and the worked examples, removed in version 5, that showed approach lines marked as approach.
- Story steps and outcomes the CV does not state: "Prefer the concrete thing … (the name, the number, the step)" and "Write the way a clear, experienced person talks", which reward concrete-sounding steps; "Never add a time, a deadline, a stage or an outcome" does not hold against them.
- Statistics: "General knowledge is answered fully … market or industry … never hold back, hedge or promise to confirm" with "Give a general figure only when it is well established": a typical-savings range is taken as well established.
- STAR forced with no matching project: "Apply each one as far as this question allows … keep to its intent as closely as you can".

**The code-error screenshot with no code.** Since version 5 the code-error screen (`st-code-error`, "Why does this fail?") is typed coding instead of codefix: 2/2 runs on b and 6/6 on a today, against 2/2 right on c and 12/12 before version 5. Under coding nothing asks for corrected code when the question is "why", and in 1 of 8 runs the answer gave only the cause in the session's headline-and-bullets format; "Keep to this question only" and "The length is a limit … never pad" allow that. The other 7 runs gave code that runs.

## Live answers prompt version 6 (19 Nov 2026): fails the invented-detail gates, not deployed

Same laptop; answers by `claude-haiku-5-5`, graded by `claude-sonnet-5-5`; 2 runs per scenario, one command per group. Production is main's default (version 5 with ADR-0107). Version 6 (branch `live-prompt-v6`) changes nine lines of the default prompt (own experience, a past-tense rule under "Never invent", interview, confidence, concrete detail, statistics, the behavioural shape, shape preferences, code errors are codefix with code). The revision round then changed five lines behind what was still invented: past tense includes "I've"; a CV project fits a behavioural question only when the CV states the event asked about, and no reason, feeling or purpose is added; a missing tool or number is never named, even as an example; no study, report or source; a fact about the other person's own company is asked for. Cells: score, then runs with invented details (the grader's `invented` list).

| Group (gate) | Production | Version 6 | Version 6, revised |
|---|---|---|---|
| `missing-info` (≥ 8) | 7.38, 12/16 | 7.63, 8/16 | **7.19, 8/16: fails** |
| `cv-embellishment` (nothing invented) | 6.75, 2/8 | 6.25, 4/8 | **6.63, 2/8: fails** |
| `company-star` (nothing invented) | 8.17, 3/6 | 8.50, 3/6 | **8.33, 4/6: fails** |
| `hallucination-bait` (no invented prices or personal numbers) | 7.17, 3/12; number check 12/12 | 7.75, 3/12; 12/12 | 7.33, 1/12; 12/12 |
| `screenshot-types` (≥ 8, code runs) | 8.93; code 4/4; code error typed coding 2/2; one empty answer | **9.14**; code 4/4; code error typed codefix 2/2; one empty answer and hidden line 13/14 | not re-run (screenshot lines unchanged) |

Not clearly better than production, so the full suite was not run and nothing was deployed (the developer's rule).

**Still invented with the revised version 6:** a claimed lead role ("I led a migration", both runs of the team-lead story, although the prompt names exactly that case); "I've run Kubernetes in production"; an invented failure event ("a bad deploy pushed a change that broke a dependency"); past-tense rollback ("I rolled back by redeploying the previous version"); a tool named as approach ("a managed queue like SQS or RabbitMQ"); purpose clauses in the STAR story ("to keep us aligned", "so issues surfaced early"). The grader also lists some approach lines the prompt asks for ("I'd typically start with a small, low-risk service…", "run old and new in parallel") and general knowledge ("Routing cuts drive time and fuel").

**First answer word** (ADR-0103's method: ADR-0101's 10 questions as spoken chat questions, rounds alternating production, version 6, production, version 6; 20 answers each): production **919 / 1,193 ms** (p50 / p95; round p50s 896, 919), version 6 **891 / 980 ms** (891, 853). Hidden line first: production 20/20, version 6 19/20.

Spend: about **$0.60** (production $0.22, version 6 $0.20, revision $0.16, timing about $0.01).

### Edit 9 alone, the fixed grader, and three options against claimed experience (19 Nov 2026)

Same laptop; answers by `claude-haiku-5-5` unless named, graded by `claude-sonnet-5-5`; 2 runs per scenario. Spend about **$1.41** (cap $1.50).

**Edit 9 alone** (branch `codefix-line`: production's prompt plus the code-error line): `screenshot-types` 9.64, code 4/4, but the code-error screen typed coding in 2/2; `screen-only` 9.50, hidden line 14/14, never empty, all private, **code 3/4: fails** (the code-error screen typed task, one answer with no code). Not merged.

**Fixed grader** (the developer's definition of invented; Rubric above). On the same replies (`--compare-rubric`, production): `missing-info` 13/16 runs with something invented (previous rubric 12/16), `cv-embellishment` 3/8 (3/8). It stops listing approach lines and general knowledge; what it still lists is mostly claimed experience ("I've run Kubernetes in production", "The biggest outage I caused was…"). With it, the five weak groups (score, runs with something invented):

| Group | Production | Version 6 |
|---|---|---|
| `missing-info` | 6.94, 13/16 | **7.94, 5/16** |
| `cv-embellishment` | 6.25, 3/8 | 6.63, 2/8 |
| `company-star` | 7.00, 6/6 | **8.50, 3/6** |
| `hallucination-bait` | 7.33, 6/12 | 7.08, 4/12 |
| `screenshot-types` | 9.50, 2/14 | 9.71, 1/14 |

**Options on top of version 6** (`src/server/prompts/experience.ts`, off unless the evaluation turns them on: `--cv-match`, `--shape-examples`, `--experience-model=sonnet`). A: for an own-experience question in an interview, mock or blank session, a BM25 score of the CV's clauses (the document search's formula); under 0.5 (no specific word in common) the end reminder gets "No CV project matches this question: answer only with your approach (I would…), with no past-tense claims." Over the evaluation's 19 such questions it fires on 10, three of them wrongly (a fitting CV project in other words: "difficult client" against "retail customer"). B: those questions answered by `claude-sonnet-5-5`. C: three neutral shape examples after the locked experience rules.

| Option | `missing-info` | `cv-embellishment` | `company-star` | Hidden line | First word p50 / p95 | Cost per answer |
|---|---|---|---|---|---|---|
| Version 6 | 7.94, 5/16 | 6.63, 2/8 | 8.50, 3/6 | 30/30 | 779 / 865 ms | $0.00023 |
| A | **8.31, 3/16** (line in 8/16; 0/8 invented where it fired) | 7.13, 3/8 (never fired) | 8.33, 1/6 (fired 6/6) | 30/30 | 788 / 926 ms | $0.00024 |
| B | **8.56, 2/16** | 7.83, 3/6 (3 scenarios; cost cap) | **9.17, 2/6** | 28/28 | **1,009 / 2,441 ms** | $0.0049 |
| C | 7.19, 8/16 | 5.75, 5/8 | 7.83, 4/6 | 30/30 | 773 / 975 ms | $0.00023 |
| A + C | 7.94, 6/16 | 6.25, 4/8 | 8.83, 2/6 | 30/30 | 764 / 840 ms | $0.00025 |

First word: ADR-0103's local method with 10 invented own-experience interview questions, two rounds per option, 20 answers each. No option passes every nothing-invented gate. A's remaining `missing-info` details are all in "Full example story" sessions, where it does not apply ("I led a migration of our invoicing service"). C added invented details.

### Release attempt: version 6 + the CV match signal (19 Nov 2026): gates fail, not deployed

Branch `v6-cv-match`: version 6, the CV match signal on by default (`src/server/prompts/experience.ts`), the "Full example story" rule (an example story never uses the CV's employers, project names or roles, and keeps source example). Spend about **$1.04** (cap $1.50).

**Edit 9 in the locked screenshot texts** (both tails): `screenshot-types` 9.29, code 4/4, code error typed codefix 2/2, but hidden line 12/14 (a chart and a document reply); `screen-only` 9.36, code 4/4, code error typed **coding** 2/2. Fails the developer's condition, so it is left out.

**`missing-info` before the suite** (version 6 + signal + story rule): 7.63, 5/16 runs with something invented; the signal fired 8/16 (the approach sessions).

**Full suite** (`eval:all`, 2 runs per scenario; notes 3), gates of 19 Nov 2026. Invented = runs with something in the grader's list.

| Group | Score (gate) | Invented (≤ 1 in 4; production) | Other | Result |
|---|---|---|---|---|
| `answers` | 9.13 (≥ 8.86, one command) | 2/30 | hidden 27/30, 2 empty | hidden line |
| `screenshots` | 8.33 (≥ 8) | 0/6 | hidden 5/6 | hidden line |
| `lessons` | 8.75 (≥ 8) | 1/4 | | passes |
| `preferences` | **7.25** (≥ 8) | **3/8** | hidden 6/8 | **fails** |
| `call-style` | 8.25 | 1/8 | | passes |
| `adaptive` | 8.52 | **13/48** | | **fails** (27%) |
| `missing-info` | **7.75** | **5/16** (production 13/16) | signal 8/16 | **fails** |
| `hallucination-bait` | 7.08 | **4/12** (6/12) | | **fails** (33%) |
| `consistency` | 10.00 | 0/6 | | passes |
| `ask-kite` | 9.75 | 2/12 | target 9/12 | target |
| `cv-embellishment` | 6.50 | 2/8 (3/8) | | passes |
| `answer-length` | 9.25 | **2/4** | | **fails** |
| `question-detection` | 9.35 | 2/26 | | passes |
| `screenshot-types` | 9.64 | 2/14 (2/14) | code 4/4 | passes |
| `company-star` | 8.17 | **2/6** (6/6) | | **fails** (33%) |
| `screen-only` | 9.14 | 2/14 | hidden 13/14, private 13/14, code **3/4** | **fails** |
| `notes` | 9.89 | | | passes |

Hidden line first **215/222 (96.8%; gate 99%)**. Code check: no invented price or personal number except "twenty" in one example story (`m-failure-story`) and "13" (times faster, worked out from the CV's 40 s and 3 s) in `c-report-speed`; the rest are sums on document prices and stated case assumptions. Spend $0.83 (one earlier start stopped after a minute with an unnamed error and was run again).

**The hidden line.** Four of the seven misses copied the contract's placeholder: `09-typed-chat-question` and `22-answer-in-spanish`, both runs (09 empty both times). Not seen at the 1.7.3 release. Answers only, 4 runs each: production's prompt 7/8 with the hidden line, version 6 0/8. Each version 6 line alone on 09: none 4/4; edit 8 (shape preference) 0/4; behavioural 1/4; concrete detail 2/4; missing detail and fact to confirm 2/4; the rest 3–4/4. Version 6 without edit 8: 0/4 and 0/4; with only its five least harmful lines: 1/4. No single line causes it: the more of version 6's new text, the more a typed question copies the placeholder. Bisect spend $0.04.

Follow-up (developer, not now): let the CV match signal count a CV project worded differently (for example a short synonym step per session).

### The CV match signal on the version 5 prompt (19 Nov 2026): release gate, second version

Branch `cv-match-v5`: production's prompt (version 5) plus the CV match signal; the fixed grader. `eval:all` twice on the same branch: production with `--no-cv-match` (the prompt production sends, byte for byte), then the signal on. Spend **$1.68** (cap $1.80). Cells: score, runs with something invented.

| Group | Production | Version 5 + signal | Worse? |
|---|---|---|---|
| `answers` | 9.00, 5/30 | 9.33, 4/30 | no |
| `screenshots` | 9.17, 0/6 | 9.33, 1/6 | one more invented run |
| `lessons` | 9.25, 0/4 | 9.25, 0/4 | no |
| `preferences` | 8.88, 4/8 | 8.88, 4/8 | no |
| `call-style` | 8.00, 2/8 | 8.50, 1/8 | no |
| `adaptive` | 8.33, 15/48 | 8.17, 19/48 | score −0.16, four more invented runs |
| `missing-info` (targeted) | 6.25, 11/16 | **8.13, 8/16** | better |
| `hallucination-bait` | 7.33, 2/12 | 7.33, 1/12 | no |
| `consistency` | 9.83, 0/6 | 9.67, 0/6 | score −0.16 |
| `ask-kite` | 9.50, 2/12 | 9.67, 2/12 | no |
| `cv-embellishment` | 6.00, 4/8 | 6.63, 5/8 | one more invented run |
| `answer-length` | 9.00, 3/4 | 9.25, 3/4 | no |
| `question-detection` | 9.42, 4/26 | 9.50, 3/26 | no |
| `screenshot-types` | 8.86, 5/14 | 9.21, 5/14 | no |
| `company-star` (targeted) | 8.17, 3/6 | **8.67, 0/6** | better |
| `screen-only` | 9.50, 2/14 | 9.29, 4/14 | score −0.21, two more invented runs |
| `notes` | 9.67 | 9.67 | no |

Hidden line first: production **217/222 (97.7%)**, version 5 + signal **222/222**. Code check, version 5 + signal: one worked-out price, "about 47 dollars per seat per month" (52 less the 10 percent that needs approval, `10-discount-pressure` run 1); the rest are sums on document prices and stated case assumptions. Production: "20" percent (a statistic, `b-statistics`) and "20" in an example story.

**Where the signal acts.** The line fired in 20 of 222 replies (10 scenarios); every other prompt is byte for byte production's. In those 10 scenarios: invented runs 12 → 4; score up in 6, equal in 2, down in 2 (`a-backend-behavioural` 9.0 → 8.0 and `star-cv-match` 7.5 → 6.5: the two scenarios where the CV has a fitting project in other words, the misfires measured before). Across the other 101 scenarios, the same prompt twice: mean 8.62 → 8.77, invented runs 50 → 56. So every "worse" cell above, and the 47-dollar price, comes from scenarios with an identical prompt.

**Result under the gate as written: fails** (five groups worse, one worked-out price). Not merged; the developer decides.

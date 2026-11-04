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

Re-run only the groups a change touches; run the full suite once, at release (`pnpm --filter web eval:all`). The grader stays Sonnet, so scores stay comparable with the baselines. The developer is told the estimated cost before every paid run. Every run first prints its estimated number of Claude requests; `--dry-run` prints only that and sends nothing.

| Group | Scenarios | Command | Claude requests per command (default runs) | Gate |
|---|---|---|---|---|
| `answers` | 01–15 (Day 4) | `pnpm --filter web eval:answers --only=answers` | 15 × 2 runs × (answer + grade) = 60; the gate needs the command 3 times = 180 | mean of 3 commands ≥ baseline − 0.15 (9.28) |
| `screenshots` | 16–18 (Day 5) | `pnpm --filter web eval:answers --only=screenshots` | 3 × 2 × 2 = 12 | ≥ 8 |
| `lessons` | 19–20 (Day 5 Stage 7: answers with an approved lesson) | `pnpm --filter web eval:answers --only=lessons`, then the same with `--without-lessons` | 2 × 2 × 2 = 8 per command, 16 for the pair | with lessons ≥ 8 and higher than without |
| `preferences` | 21–23 (parity Phase 2: bullets only, an answer language, the technical tone) | `pnpm --filter web eval:answers --only=preferences` | 3 × 2 × 2 = 12 | ≥ 8 |
| `notes` | n1–n3 (Day 5) | `pnpm --filter web eval:notes --only=notes` | 3 × 3 runs × (notes + grade) = 18 | ≥ 8 |
| `adaptive` | 24, in `tests/eval/groups/adaptive.ts` (ADR-0030: 6 roles × 4 question types; code is run) | `pnpm --filter web eval:answers --only=adaptive` | 24 × 2 × 2 = 96 | ≥ 8 |
| `missing-info` | 8, in `tests/eval/groups/quality.ts` (4 questions under both settings) | `--only=missing-info` | 8 × 2 × 2 = 32 | ≥ 8 |
| `hallucination-bait` | 6, same file | `--only=hallucination-bait` | 6 × 2 × 2 = 24 | **Zero invented prices or personal numbers** (the developer's gate). The score is reported, with no gate of its own |
| `consistency` | 3, same file (the same question twice in one call) | `--only=consistency` | 3 × 2 × 3 = 18 | ≥ 8, and the same numbers both times |
| `ask-kite` | 6, same file (3 typed in a call, 3 on the page; code is run) | `--only=ask-kite` | 6 × 2 × 2 = 24 (the page's answers use the smart model) | ≥ 8, and for the call or private as expected |
| `cv-embellishment` | 4, in `tests/eval/groups/honesty.ts` (ADR-0032: bait an invented tool, number, team size or result on a real CV project) | `--only=cv-embellishment` | 4 × 2 × 2 = 16 | **Zero invented tools, numbers, team sizes or results** (the claim check and the grader's `invented` list). Score reported |
| `answer-length` | 2, same file (ADR-0032: a full Balanced-length answer, not a one-liner or a ramble) | `--only=answer-length` | 2 × 2 × 2 = 8 | ≥ 8 (the grader's style score covers length) |
| `question-detection` | 11, in `tests/eval/groups/detection.ts` (ADR-0043: garbled lines and remarks are not answered as questions; real questions in messy transcripts still are) | `--only=question-detection` | at most 11 × 2 × 2 = 44 (a reply with no answer in it needs no grade) | ≥ 8 |
| `screenshot-types` | 7, same file (ADR-0043: a coding problem, a code error, a slide, a chart, a document, a web page, an unreadable screen; code is run) | `--only=screenshot-types` | 7 × 2 × 2 = 28 | ≥ 8, and the code runs |

`--only=<id>` runs one scenario; `--runs=N` sets the runs (default 2 for answers, 3 for notes). Which group a change touches: the rules block or the conversation part of `server/prompt.ts` → `answers` and `screenshots`; the screenshot tail only → `screenshots`; the learned-preferences part of the rules block (`rulesBlock()` with lessons) → `lessons` (a session without lessons sends the Day 4 rules block byte for byte, pinned by a unit test, so `answers` and `screenshots` need no re-run); `server/notes.ts` → `notes`.

**Answer line (v1.1.0, ADR-0043).** Every run also records the words in the answer line as the model wrote it and as the card shows it after its cut at a clause, not counting a label, and prints both rates. The gate is **at least 95% as shown**, across all groups (the developer's decision, 4 Nov 2026). The Headline point in the rubric stays at 15 words of what the model wrote, so scores remain comparable.

**The hidden question line (v1.1.0).** The evaluation now takes out the hidden `[[question|…]]` line before grading, as the route's pipeline does. v1.0.2 added that line and this evaluation had not run since, so the baselines were measured without it; the first v1.1.0 pass graded it as stray text until this was fixed.

## Rubric (10 points per scenario)

| Criterion | Points | Who scores it | Full marks when |
|---|---|---|---|
| Facts | 0–3 | Grader | Every "must include" point is in the answer, correctly |
| Grounded | 0–2 | Grader | Every claim about the user, their company, offer, prices, dates or commitments comes from the session, documents or call; nothing from "must not include" |
| Consistent | 0–2 | Grader | Consistent with earlier answers in the call, or gives the new answer and says what changed when new information changes it. Full marks when there are no earlier answers |
| Style | 0–1 | Grader | Follows the session's format, length, tone and instructions; no greeting or preamble |
| Headline | 0–1 | Code | Headline+bullets: the first line has 1–15 words. Paragraph: no bullet lines |
| Bullets | 0–1 | Code | Headline+bullets: at most 5 bullets. Paragraph: one paragraph |

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

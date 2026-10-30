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
| `notes` | n1–n3 (Day 5) | `pnpm --filter web eval:notes --only=notes` | 3 × 3 runs × (notes + grade) = 18 | ≥ 8 |

`--only=<id>` runs one scenario; `--runs=N` sets the runs (default 2 for answers, 3 for notes). Which group a change touches: the rules block or the conversation part of `server/prompt.ts` → `answers` and `screenshots`; the screenshot tail only → `screenshots`; `server/notes.ts` → `notes`.

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

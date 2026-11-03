# ADR-0032: Answer honesty, shape and a rollback switch

- **Status:** Accepted (developer, 3 Nov 2026)
- **Date:** 2026-11-03
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6 (answers); `docs/testing/answer-eval.md`
- **Supersedes / superseded by:** none. Changes the core answer rules and their cache entry (after ADR-0030), and adds one admin setting.

## Context

Two problems remained after ADR-0030, seen in the round-2 and round-3 `missing-info` and `hallucination-bait` evaluations (`docs/testing/answer-eval.md`): the fast model still embellished a real CV project with plausible but unstated detail (extra tools, numbers, team sizes, outcomes), and the answer shape was not tied to how long an answer takes to say, so answers were sometimes a bare line and sometimes a ramble.

Changing the shared rules is risky: it is the cached block every session reads, and its scores are a baseline. So the change needs a way back that does not depend on redeploying.

## Decision

1. **A real CV project stays exactly as the CV states it.** The rules now forbid adding any tool, technology, number, team size, duration, responsibility or outcome to a stated project, even a plausible one. Extra depth must be given as the user's *approach*, in words that cannot be taken for past fact ("I'd typically...", "My approach would be..."), kept apart from what the CV states. A worked example shows the split (a CV that says only "rebuilt the billing export in Go").

2. **A speakable answer shape.** One headline the user can say as it is, then **2 to 4** supporting bullets (was "at most 5"), and an optional "Tip:" line. **Behavioural** answers are a short STAR story built from the closest real CV project — situation and task, what I did, the result — each only as far as the CV states it, with no invented result.

3. **Answer length is defined in seconds of speech.** Short is about 10–20 s (≈25–50 words), Balanced (stored `medium`) about 20–40 s (≈50–100 words), Detailed about 40–60 s (≈100–150 words), counting the headline, bullets and any tip together. The closing reminder repeats the format-and-length rule.

4. **A rollback switch, admin only.** The rules before this change are kept **word for word** as **v-previous** (`src/server/prompts/rules-previous.ts`); the new rules are **v-current**. Settings → Answers shows "Answer style version" (default v-current) to admins only. The choice is saved per device (`localStorage`), sent on the warm-up and every answer of a call as `styleVersion`, and goes in the **cached rules block** (so a call stays on one version and one cache entry). The server honours `previous` **only for an admin** (`app/api/answer/route.ts`); for anyone else it is ignored, so the switch cannot be forced by a crafted request.

5. **v-previous is pinned.** A unit test pins both blocks by SHA-256: v-current is the new block, and v-previous is byte-for-byte the block measured before this change (`c65daf3b…`), so the earlier `answers`/`screenshots`/`lessons` baselines still describe exactly what a rollback sends.

6. **New evaluation scenarios, defined now and run at release** (`tests/eval/groups/honesty.ts`): `cv-embellishment` (4 questions that bait an invented tool, number, team size or result) and `answer-length` (2 questions whose good answer is a full Balanced-length reply). They are not run until the developer agrees the cost (Part E).

## Consequences

- The rules block and its hash change, so every session's first cache entry is written once more on the new rules. v-previous shares its own, separate entry.
- `answers` scores after this change are **not strictly comparable** with the 9.18 baseline (the shape and the honesty rule both changed). The release run re-measures `answers`, `screenshots`, `lessons`, `preferences`, the ADR-0030 groups, and the two new groups; the developer sets any new baseline.
- The bullet count dropped from "at most 5" to "2 to 4"; the code shape check still allows up to 5, so it does not fail a 4-bullet answer.
- Older desktop installs are unaffected: the field is optional and defaults to current.

## Alternatives considered

- **A feature flag in an environment variable:** a rollback would need a redeploy and would be all-or-nothing for the team; the per-device admin switch is immediate and reversible.
- **Lowering the fast model's temperature to curb embellishment:** the API refuses `temperature` on `claude-haiku-5-5` (ADR-0030).
- **Keeping "at most 5" bullets:** fewer, denser bullets read better at a glance in the overlay and fit the Balanced length.

## Validation

- `tests/unit/server/prompt-lessons.test.ts`: both version hashes; `rulesBlock(lessons, 'previous')` builds v-previous.
- `tests/unit/server/prompt.test.ts`: the new bullet wording.
- The `cv-embellishment` and `answer-length` groups, with the claim check and the grader's `invented` list (release run, after the developer agrees the cost).
- Human checks in `docs/testing/final-test-plan.md` (the rollback switch).

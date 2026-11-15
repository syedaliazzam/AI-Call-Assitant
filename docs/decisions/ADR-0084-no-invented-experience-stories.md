# ADR-0084: No invented experience stories, whatever shape the instructions ask for

- **Status:** Accepted (revised 15 Nov 2026, architecture 4.25.0: the rules moved out of the shared core block)
- **Date:** 2026-11-15
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §7.2 (version 4.25.0)
- **Supersedes / superseded by:** none. Tightens ADR-0032 (answer honesty) and ADR-0083 (company AI instructions). ADR-0030's "Full example story" setting stays, with a clearer tag.

## Context

On production (15 Nov 2026), Try it on Admin → AI settings tested a company instruction "always use the STAR shape" with no session, so no CV. Haiku answered "Tell me about a time you handled a difficult client" with a made-up STAR story (hidden source `example`). Strengthening the company heading (ADR-0083) did not stop it.

A **control try** then used the same question with no company instructions and no CV. It also got a made-up past event, so the company block was not the cause. The rules said "if nothing is close … answer with the approach", but not that "no CV" counts as "nothing close". They also did not stop a shape instruction from asking for a story.

## Decision

**1. Locked experience rules, only where they belong.** `EXPERIENCE_RULES` in `server/prompt.ts` is a line of the session block, and `EXPERIENCE_REMINDER` comes after the call reminder at the end of the request. Both are locked code, and an admin cannot change them. They are sent only in interview, mock and blank (Try it) sessions (`experienceApplies()`), never in a regular call, and never when the user chose "Full example story". They say:

- Questions about your own past use the closest real project in the CV, told exactly as the CV states it, with nothing added.
- For a behavioural question, "close" means the CV states the same kind of situation (a difficult client needs work with a client or customer), not only the same field.
- With nothing close, or no CV, the answer is your approach:
  - the answer line starts "I would" or "I'd" and never claims past experience ("I handled…", "I've dealt with…");
  - every line stays in that voice, and the source is `general`;
  - an unrelated real project appears in at most one bullet, exactly as the CV states it.
- A shape such as "always use STAR", from the company or the session, applies only to a close CV project. Without one, the shape may order the approach's steps, but never as a story.

**2. The shared core rules block is unchanged.** It stays byte-identical to 4.23.0 (pinned hash). The first version of this ADR (4.24.0) put these rules in the core rules and the call reminder, which every request shares. The `answers` regression then moved unrelated regular-call scenarios each time the wording changed:

- round 1: "I don't have pricing…" said aloud in sales answers;
- round 2: an invented hosting location, plus bullets in a paragraph-format answer;
- the 3-run mean fell to 8.84 and then 8.72, below the 8.86 gate.

With the rules confined to the sessions where questions about your own past are asked, regular calls send exactly what the baseline measured.

**3. "Full example story" stays and is labelled.** An answer whose hidden source is `example` (only with that setting) shows the private tag **"Example — not from your CV"**, or "Example — not from your documents" outside an interview, in the warning colour (`sourceLabel()`, `AnswerTags.tsx`). Company instructions cannot turn the setting on.

**4. Evaluation group `company-star`** (`tests/eval/groups/company.ts`, `--only=company-star`). It has three cases, all with "always use STAR" company instructions and the question above:

- no CV;
- a CV with no client work;
- a CV with a matching customer story.

Scenarios can carry `company` instructions. `eval:answers --no-grade` sends answers only.

## Consequences

Measured 15 Nov 2026 with `claude-haiku-5-5`, graded by `claude-sonnet-5-5`:

| Check | Before | Final |
|---|---|---|
| Try it: no company text, no CV (control) | made-up past event | — |
| Try it: "always use STAR", no CV | made-up STAR story | "I would / I'd" throughout (round 1) |
| `company-star`, 2 runs: no CV / CV with no match / CV with a match | — | 9.0 / 8.0 / 7.5 |
| `answers` (15), 3 runs, gate ≥ 8.86 | 9.40 (one run, 9 Nov) | **9.07** (8.97, 9.10, 9.13) |
| `screenshots` (3), gate ≥ 8 | — | 9.33 |
| `preferences` (4), gate ≥ 8 | 8.88 (5 Nov) | 9.13 (24-star-structure 9.0) |

- No first line claims past experience in the no-match case any more. One of the 2 runs' closing "Tip:" line still hinted at an unstated issue the user "handled", and the matching case does not label its STAR parts (style points lost; nothing invented in the story itself).
- Interview scenario 03 scored 8–9 (one earlier run: 10).
- A regular call that asks a behavioural question gets only the older core rule ("nothing close → the approach"). Such questions belong to interviews.
- Spend for this work: about $0.97, over five evaluation rounds (developer's cap $5).

## Alternatives considered

- **The rules in the shared core block or the call reminder** (4.24.0, then two rewrites). Each moved unrelated regular-call answers; see Decision 2.
- **Only the company heading** (ADR-0083's sentence). Tried first; the story remained.
- **Removing "Full example story".** It is the user's explicit choice; it now carries a clear tag instead.

## Validation

- `tests/unit/server/prompt-company.test.ts`:
  - the experience rules' content;
  - sent in interview, mock and blank sessions, never in regular ones, and not with the example-story setting;
  - the reminder only there;
  - the locked core still first, with the company text after it.
- `tests/unit/server/prompt-lessons.test.ts`: the rules block is byte-identical to 4.23.0 (hash).
- `tests/unit/shared/sourceLabel.test.ts`: the example tag.
- `tests/unit/scripts/eval-options.test.ts`: `--no-grade`.
- Paid checks: the table above (`docs/testing/answer-eval.md`).

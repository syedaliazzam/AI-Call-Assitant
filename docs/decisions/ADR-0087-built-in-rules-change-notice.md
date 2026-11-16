# ADR-0087: Tell admins when the built-in rules change under a custom prompt

- **Status:** Superseded by ADR-0089 (2026-11-16)
- **Date:** 2026-11-16
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §8.1 (version 4.28.0)
- **Supersedes / superseded by:** none. Builds on ADR-0086 (custom full system prompts) and ADR-0050 (additive migrations).

## Context

A custom full prompt (ADR-0086) is a frozen copy. When a release improves the built-in rules (a fix to the honesty rules, a new answer shape), a block with a custom prompt keeps the old behaviour, and nothing tells the admin. To decide whether to merge the change or reset, the admin needs two things: the day the rules changed, and what changed.

## Decision

**1. Record what a custom prompt was written against.**

- `ai_instructions_version` gains `base_hash`: for a custom prompt, the SHA-256 of the built-in prompt in force when it was saved (`builtInHash()`, over the cleaned parts).
- A new table `ai_builtin_prompt` (block, hash, prompt JSON, first seen) keeps every built-in prompt the app has run with, so the old text can still be shown after a release. Rows are never changed or deleted.
- Migration `0007_builtin_prompts.sql` is additive.
- The current built-in prompts are recorded (`ON CONFLICT DO NOTHING`, once per server instance) in three places:
  - when the admin page loads;
  - when a custom prompt is saved;
  - when a call fetches its pin, so a release's rules are recorded as soon as calls start. A failure there is logged by name and never stops the pin.
- How each action sets the base:
  - saving instructions keeps the base of the prompt in force;
  - restoring a prompt keeps that prompt's own base;
  - Reset to default has none.

**2. The date comes from the code.** `BUILT_IN_REVISIONS` in `server/prompts/builtIn.ts` holds, per block, the release day of the current built-in prompt and its hash. `tests/unit/server/builtInPrompts.test.ts` fails when the built-in text changes and the hash was not updated, so the date cannot go stale. The day "first seen" in the database was rejected: it is the first page view or call after a release, not the release.

**3. The notice.** For a block whose custom prompt in force has a base different from today's built-in hash, AI settings shows the notice above the block, in simple and in advanced mode:

> Built-in rules were updated on <date> — your custom prompt doesn't include these changes

It has two actions:

- **View changes:** a dialog with the word diff of the built-in rules the prompt was written against against today's. It falls back to a line diff for large changes (ADR-0086) and opens at the first change. If that text was never recorded, the dialog says so and shows today's rules.
- **Reset to default:** after a confirmation, the same action as in advanced mode.

Saving the custom prompt again, even unchanged, records today's base and clears the notice: the admin has seen the changes. Saving the same text against the same base still adds nothing.

**4. Prompts saved before this change** have no base. They count as written against the first built-in prompt recorded for the block. This is exact: base hashes and the record start in the same release, and the built-in text has not changed since custom prompts began (ADR-0086, the same day).

**5. A layout fix found on the way.** A `Modal` that sizes to its content was cut off at the window's height (the dialog clips; it does not scroll), so a long diff lost its title and showed only its end. The notice's dialog and the prompt history's dialog now have a fixed height, so their content scrolls.

## Consequences

- An admin with a custom prompt learns about every built-in change, with the date and the diff, and can merge it (edit, try, save) or reset.
- Every change to the built-in rules now needs the date and hash in `BUILT_IN_REVISIONS` (the test makes that impossible to forget).
- One more small write per server instance (the record), and one more read on the admin page.
- If a release changed the built-in rules before any server recorded the previous ones, a pre-ADR-0087 custom prompt would not get the notice. That cannot happen for this release (it records them on its first call or page view, and the rules have not changed since custom prompts began).

## Alternatives considered

- **Copying the built-in text into every version.** About 16,000 characters per save, and the same text many times over. One record per built-in prompt, referenced by hash, keeps the old text without that.
- **Comparing save time with a release time.** It needs exact release times and cannot show what changed.
- **Changing old versions to fill in their base.** Versions are never changed (ADR-0083); the first-recorded rule gives the same result without that.

## Validation

- Unit tests:
  - `tests/unit/server/aiInstructions.test.ts` (PGlite, real migrations, two simulated releases):
    - no notice while the bases match; after a release, the date and the old rules;
    - saving instructions keeps the notice; re-saving the prompt or Reset to default clears it;
    - a restored prompt keeps its base; a pre-ADR-0087 prompt uses the first recorded rules;
    - the pin records once, and a failed record never stops it.
  - `tests/unit/server/builtInPrompts.test.ts`: hash and date guard.
  - `tests/unit/features/admin/BuiltInChangeNotice.test.tsx`: exact wording and date format; the actions; shown only for the affected block, in both modes.
- Visual: `tests/visual/ai-settings-shots.ts` captures 5 and 6 (the notice; the "View changes" dialog opening at the change).

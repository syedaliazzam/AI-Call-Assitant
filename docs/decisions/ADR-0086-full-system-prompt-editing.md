# ADR-0086: Simple AI settings, and full system-prompt editing for admins

- **Status:** Accepted
- **Date:** 2026-11-16
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §6.3, §7.2, §8.1 (version 4.27.0)
- **Supersedes / superseded by:** amends ADR-0083 (its page layout, and its rejection of "making the whole prompt editable"). Builds on ADR-0025 (prompt caching), ADR-0032 (rules versions), ADR-0050 (additive migrations).

## Context

Admin → AI settings (ADR-0083) had a lot on one screen for each block: helper text, an examples list, the editor, a separate Try it card, the locked rules card and the history. Admins found it heavy for the common case, which is a few lines of tone and company facts.

Admins also asked to change the rules themselves, not only add instructions after them. ADR-0083 rejected this because the app reads the reply's shape:

- the hidden `[[type|for|source]]` first line;
- the hidden `[[question|…]]` last line;
- the empty reply for garbled speech or a remark that asks nothing;
- the notes' fields.

A prompt that loses those rules breaks answers for everyone.

The built-in rules also had two wrong statements. They said "You are Kite" (the product is Paramount AI). The transcript line said recognition runs "on the user's computer", but since ADR-0076 it is cloud recognition (Deepgram) with the on-device engine as the fallback.

## Decision

**1. Simple mode is the default.** Each block (Live answers, AI notes, Ask AI) shows:

- one "Instructions for the AI" box with a counter;
- Try it inside the same card;
- Save and Discard.

The examples list and the long helper text are gone; one short line stays. The built-in rules sit behind a small "View built-in rules" link, folded. The input-budget line shows only as a warning near the limit. The version history stays, listing the versions that changed the instructions.

**2. Advanced mode: an "Edit full system prompt" switch** shows the block's whole system prompt, part by part, in editable boxes. It starts from the prompt in force (the built-in one until a custom prompt is saved). The parts are:

- live answers: the core rules, the reminder after the question, and the screenshot text;
- notes: the notes rules;
- Ask AI: the Ask AI page rules and the session-review rules.

The session block, the learned preferences and the experience rules (ADR-0084) are not part of it and stay locked. The company instructions are still added after the custom prompt.

- **Check before try and save** (`packages/shared/src/customPrompt.ts`, `checkCustomPrompt()`). The page shows problems as the admin types, and the try route and the save action refuse a prompt that has any. Each message names the part and exactly what is missing:
  - live core: `[[type|for|source]]`, `[[question|`, a line with "garbled" and "only the two hidden lines", and a line with "none:" and "only the two hidden lines";
  - live screenshot: `[[type|for|source]]`;
  - notes: each field name (`summary`, `questions`, `answerId`, `nextSteps`, `unclear`, `lessons`);
  - Ask AI page: `[[type|kite|source]]`;
  - every part: non-empty (except the live reminder) and at most 40,000 characters.
- **Try before save, enforced on the server.** A successful try with a prompt returns `promptToken`, an HMAC-SHA256 of the block and the prompt's cleaned bytes, keyed with the auth secret (`server/promptTryToken.ts`). `savePromptAction` refuses a prompt without a matching token. So a prompt that was never tried, or was edited after its try, cannot be saved, even by calling the action directly. The page also keeps Save disabled until the exact draft was tried.
- **Reset to default** saves a version with no custom prompt (after a confirmation). The built-in prompt needs no try.
- **Prompt history:** the versions that changed the prompt, with a diff against the live prompt and one-click Restore. A restored prompt is checked again.

**3. One version holds both parts.** `ai_instructions_version` gains a nullable `prompt` column (JSON of the block's parts, cleaned; null = built-in), added by migration `0006_full_prompt.sql` (additive, with a size CHECK). Every save writes a full version:

- saving instructions keeps the prompt in force;
- saving a prompt keeps the instructions in force;
- a restore copies only the part of the mode it was made from.

So the ADR-0083 pin needs no change: a call that pinned a version keeps its prompt and its instructions until it ends, and its cached prefix (rules block) stays byte-identical. Calls that start after a save get the new prompt. A damaged stored prompt reads as the built-in prompt, so an answer is never stopped.

**4. Where a custom prompt applies.**

- Live answers, typed questions, screenshots and their warm-ups: the core replaces `CORE_RULES` in the first cached block, the reminder replaces `CALL_REMINDER` (an empty reminder adds no line), and the screenshot part replaces `SCREENSHOT_RULES`.
- Notes and Regenerate: `NOTES_RULES`.
- The Ask AI page: `KITE_CHAT_RULES`.
- Ask AI in a review: `ASK_RULES`.

The admin rollback rules (v-previous, ADR-0032) are never replaced. The hello test is unchanged.

**5. Built-in text fixed.** "You are Kite" became "You are Paramount AI" in the live, notes and Ask rules. The transcript line now says: "The transcript is made by cloud speech recognition (Deepgram), with speech recognition on the user's device as a fallback, and contains mistakes." The rollback copy (v-previous) keeps its bytes.

**6. Admins only, as before.** The `/admin` layout redirects non-admins, every action calls `requireAdmin()`, and `savePrompt()` and `restoreInstructions()` check the role again before touching the database. The try route answers 403 before reading the body. Logs carry the block, sizes, whether a custom prompt was used (`customPrompt`) and token counts: never prompt text, tokens or ids.

## Consequences

- The common case is one box and two buttons; the full prompt is one switch away for admins who need it.
- An admin can now change the rules that keep answers honest (the format check covers only what the app parses). Try it, the history and Reset to default are the safety net. Prompt changes are not covered by the evaluation baselines, which run on the built-in prompt.
- A custom prompt is frozen text: later fixes to the built-in rules do not reach a block with a custom prompt until an admin resets or re-edits it.
- A custom core larger than the built-in one adds to every live request; the page warns near the input budget, and the budget step (Batch C) still keeps every request within the limit.
- Changing `CORE_RULES` starts one new cache entry for the shared rules block on the first calls after the deploy.

## Alternatives considered

- **One text area with section markers.** It is harder to read and edit, and a marker an admin deletes would break the parsing. One labelled box per part is clearer.
- **A separate table for prompts with its own pin.** That means two pins per call and two histories that could disagree. One version holding both keeps ADR-0083's pin and history as they are.
- **Try required only on the page.** A direct call to the action could then save an untried prompt. The HMAC token makes the server enforce it, without storing anything.
- **Letting the session block and learned preferences be edited too.** They hold per-session data and the user's own lessons, not company rules; out of scope.

## Validation

- Unit tests:
  - `tests/unit/shared/customPrompt.test.ts`: each missing rule is named exactly; empty parts and the length limit; cleaning; keys.
  - `tests/unit/server/promptTryToken.test.ts`: the token matches only the same prompt, block and secret.
  - `tests/unit/server/aiInstructions.test.ts` (PGlite, real migrations 0005 and 0006): admins only; save and reset as new versions; a refused prompt writes nothing; restore by part; a running call keeps its prompt after a save; a damaged row is the built-in prompt; the database refuses an over-long prompt.
  - `tests/unit/api/ai-settings.test.ts`: non-admin blocked for save, reset and restore; missing rules named; an untried prompt refused; Reset needs no try; no prompt text in the logs.
  - `tests/unit/server/aiTry.test.ts`: a 400 that names what is missing, with nothing counted; the token on a tried prompt; the draft prompt replaces the rules; the built-in prompts pass the check and carry the fixed wording.
  - `tests/unit/api/answer.route.test.ts`: the pinned prompt replaces the core and the reminder with the same cached bytes for the warm-up; the rollback rules are kept; Ask AI uses its chat part.
  - `textDiff.test.ts`: long prompts fall back to a line diff.
- Visual: `tests/visual/ai-settings-shots.ts` (page captures, invented data) shows simple mode, advanced mode tried and ready to save, the missing-rules message, and dark mode.
- Evaluation: the `answers` group, run once after the text fix (`docs/testing/answer-eval.md`, 16 Nov 2026).

# ADR-0083: Company AI instructions, editable by admins (Admin → AI settings)

- **Status:** Accepted
- **Date:** 2026-11-15
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §6.3, §7.2, §8.1 (version 4.23.0)
- **Supersedes / superseded by:** none. Builds on ADR-0025 (prompt caching), ADR-0032 (rules versions), ADR-0036 (daily limit, `app_setting`), ADR-0050 (additive migrations, `--prod`).

## Context

Admins want to change how the AI answers (tone, length, words to use or avoid, company facts, how to handle kinds of questions, a STAR preference) without a code change or a deploy. Today every rule is a constant in `server/prompt.ts`, `server/notes.ts`, `server/ask.ts` and `server/kite-chat.ts`.

Parts of those rules cannot be handed over. The app parses the answer's shape: the hidden `[[type|for|source]]` first line, the hidden `[[question|…]]` last line, the 12-word answer line and the bullets. The honesty rules (claims about the user only from the CV and documents, never invented facts), privacy and safety must also hold whatever an admin writes. Prompt caching (ADR-0025) needs the cached prefix to stay byte-identical for the whole call, so an admin's save cannot change a call that is already running.

## Decision

**1. Locked core, then the company block, then the session.** Each prompt keeps its rules in code as the **locked core**, always first and never editable. A per-block **company block** follows it, under a fixed heading that says the instructions never override the rules above (`server/prompts/company.ts`). The session's own details and AI instructions come after that, as before. The order is locked core → company block → session instructions. For live answers the company block sits inside the first cached system block, between the core rules and the learned preferences. Empty company text adds nothing, so every prompt stays byte for byte what it was (tested). The rollback rules of ADR-0032 get the same treatment.

**2. Three blocks:**

- `live`: live answers (Haiku), including typed questions, screenshots, private answers and warm-ups.
- `notes`: the AI notes (Sonnet), including Regenerate.
- `ask`: Ask AI, both the Ask AI page (`kite-chat.ts`) and Ask AI in a session's review (`ask.ts`).

Each block holds at most **4,000 characters**. The limit is checked on the page, in the action, in the server function and by a database CHECK. Text is normalised on save (line endings, outer spaces), so the same text always gives the same bytes.

**3. Storage.** Migration `0005_ai_instructions.sql` is additive and adds two tables:

- `ai_instructions_version` (`id`, `block`, `text`, `author_id` with ON DELETE SET NULL, `restored_from`, `created_at`) keeps every save. Rows are never changed or deleted.
- `ai_instructions_active` (`block`, `version_id`, `updated_at`) points at the version in force for each block.

A save inserts the version and moves the pointer in **one SQL statement**, which is atomic on both the Neon HTTP driver and PGlite. Saving text equal to the version in force adds nothing. A **restore copies the old text into a new version** with `restored_from` set, so nothing is deleted. A block with no row has no company instructions.

**4. A running call keeps its version (the pin).** At Connect, a new call fetches `GET /api/ai-instructions/pin` (any signed-in account; ids only, read fresh, `no-store`). It returns the version id in force for `live` and `notes`, or `none`. The client keeps it per call start (`core/answer/instructionsPin.ts`). Every answer and warm-up of that call sends `instructionsVersion`, and so does its notes request. A reconnect keeps the pin. The server reads the pinned version's text (`server/aiInstructions.ts`), and versions never change, so the text is cached in memory by id and the call's cached prefix stays the same until it ends. A request with no pin uses the version in force:

- the warm-up on page open, before any call;
- a Regenerate;
- Ask AI;
- a page older than this change.

The version in force is cached for 60 s per server instance; the pin route always reads it fresh, so a call started after a save gets the new version at once. A pin for another block or an unknown id falls back to the version in force. If the database fails, the last text known is used ('' if none): an answer is never stopped. If the pin fetch fails, the call goes on unpinned.

**5. The page: Admin → AI settings (`/admin/ai-settings`).** It is linked from the Users header, and its own header has Users and Usage. The page has a tab per block with:

- a helper text and examples to add;
- the editor with a live counter;
- for live answers, the input-budget line: the largest live request (rules with the most lessons, the session block at its 120,000-character ceiling, the conversation at its cap, a screenshot) counted at 3 characters a token, with a warning at 90 % of the 95,000-token budget;
- Save and Discard;
- **Try it**: a sample question, or a sample call for the notes, and optionally a session from this device. It runs one real request with the unsaved draft (`POST /api/admin/ai-instructions/try`, admins only, session read fresh from the database) and counts against the daily limit like any request;
- the locked rules, read-only;
- the version history: author, time, "Live", "Restored" and "Empty" badges, a word diff against the live version, and one-click Restore.

It uses the theme tokens and components of the Users and Usage pages (light and dark).

**6. Admins only, enforced on the server.** The `/admin` layout redirects non-admins. Each server action calls `requireAdmin()`, and the server functions (`loadAiInstructions`, `saveInstructions`, `restoreInstructions`) check the role again and throw `FORBIDDEN` before touching the database. The try route answers 403 before reading the body. The pin route returns ids only.

**7. Logs.** They record the block, sizes (`companyChars`, `draftChars`), timings and token counts only. They never record the instructions' text, the draft, the sample, the reply, a version id, or an account's id or name.

## Consequences

- Admins can change answers' tone, wording and company facts in minutes, without a deploy, and undo a change with one click.
- Behaviour is unchanged while the blocks are empty. No evaluation needs re-running for this change; when an admin writes a live block, its effect is checked with Try it, not by the evaluation baselines.
- A non-empty live block makes one cache entry per version, shared by every session. A save creates a new entry the next calls write once.
- Each call start makes one more small request (the pin). The first answer request on a server instance for a new version does one extra database read (about 30–100 ms), and every request after that reads memory.
- Notes written after a Regenerate, or from a page reloaded after the call, use the version in force, not the call's pin, because the pin lives only in the page's memory.
- The company block can make answers worse if an admin writes something that fights the locked rules. The heading tells the model the locked rules win, and Try it shows the effect before saving.
- The first production try (15 Nov 2026: a draft saying "always use STAR", no session and so no CV) got a made-up STAR story from Haiku (source "example"). The live heading now says that a shape or style instruction never allows a past event, project, employer, number or result the CV does not state, and that with nothing close in the CV the shape is used for the approach ("I would…"). Admins should still check behavioural questions with Try it, with and without a session that has a CV.

## Alternatives considered

- **A separate system block with its own breakpoint.** It would use the fourth and last cache breakpoint, which is left free for later. It also gains nothing: the rules block is already shared by every session.
- **Pinning by the call's start time** (the server picks the newest version saved before it). This depends on the device clock matching the server's. A clock a few minutes off would give a call the wrong version.
- **The client sending the instructions' text.** Any user could then change company instructions for their own requests, and the cache key would depend on client bytes.
- **`app_setting` rows.** That table has no history, author or restore.
- **Making the whole prompt editable.** That would break the format the app parses and the honesty rules. Rejected in the brief.

## Validation

- Unit tests:
  - `tests/unit/server/aiInstructions.test.ts` (PGlite with the real migrations): admins only, nothing written for others; save, history, length limit in code and database; restore adds a new version and changes nothing else; pins; a live call keeps its starting version after a later save; fallback on failure.
  - `prompt-company.test.ts`: empty blocks give unchanged bytes; locked core first; order; the company text inside the first cached block; the same cached prefix across requests of one call.
  - `aiTry.test.ts`: 401, 403, 400, 429; the draft in the prompt; hidden lines removed; the budget check.
  - `instructionsPin.test.ts`: answers, warm-ups and notes send the call's pin.
  - The answer and notes route tests, `validate.test.ts`, `ai-settings.test.ts` (actions and the pin route) and `textDiff.test.ts`.
- On production after the deploy: the pin route answers 401 signed out; the page renders for an admin in light and dark; manual check by the developer (save, Try it, a new call uses it, restore).

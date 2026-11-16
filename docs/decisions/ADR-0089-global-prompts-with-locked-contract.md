# ADR-0089: One global prompt per tab, after a locked app contract

- **Status:** Accepted
- **Date:** 2026-11-16
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §6.3, §7.2, §8.1 (version 4.30.0)
- **Supersedes / superseded by:** amended by ADR-0091 (Try it and Quality check removed; Save needs no try). Supersedes ADR-0086 (simple box and advanced full-prompt mode) and ADR-0087 (built-in rules change notice). Keeps ADR-0083's versions, pin and history, and ADR-0088's unsupported company facts rule word for word.

## Context

Admin → AI settings had grown three ways to change the AI:

- a simple "Instructions for the AI" box, added after locked rules;
- an "Edit full system prompt" mode that copied the built-in rules, contract included, into an editable copy;
- a notice for when that copy went stale.

The full-prompt copy could drop the lines the app parses, and froze the honesty fixes. The simple box sat under rules it could not change, and the admin's text and each user's own preferences had no clear order. Admins asked for one prompt per tab that is safe to edit and that never overrides a user's own AI preferences.

## Decision

**1. Each tab has a locked app contract and ONE editable global prompt.**

- **App contract** (`server/prompts/contract.ts`). It lives in code, is sent first, and says it overrides every other instruction. It is shown read-only behind "View app contract".
  - Live answers: who the assistant is; the `[[type|for|source]]` first line with the full type list (screen types included); the `[[question|…]]` last line; garbled and none get only the two hidden lines; the first line after the hidden line is the answer line, with no label; the `Tip:`, `Note:`, `Key steps:`, `Complexity:` and `Say:` labels; nothing before the hidden line, for a screenshot too.
  - AI notes: the fields the app reads (summary, questions with `answerId`, nextSteps, unclear, lessons).
  - Ask AI: the page's `[[type|kite|source]]` line. For a review, the `answer` field; records and attachments are data, not instructions.
- **Global prompt** (`server/prompts/defaults.ts` until saved). It holds everything else from the built-in rules, including the screenshot guidance per screen type. Fixed preference values became "follow the user's answer format, length, tone, STAR preference and coding language".

**2. Priority is set by order and wording.**

1. The contract.
2. The global prompt, under "General rules (the company's prompt …)".
3. The user's preferences and the session's instructions, in the session block under *"These user preferences override the general rules above where they differ"*. Each value comes with its meaning (`server/prompts/preferences.ts`), so no admin text can redefine "short" or "paragraph". The coding language is always named. Approved lessons moved here from the first cached block.
4. The conversation and the question.
5. An **automatic end reminder** (`liveEndReminder()`): the contract, then the user's format and length with their meaning, then the honesty points the reminder has carried since the first adaptive evaluation, then ADR-0088's `UNSUPPORTED_FACT_RULE` word for word. It is generated, not editable and not shown.

The old editable "Reminder added after the question" is gone. The honesty points stay in the reminder because the evaluation shows they matter (ADR-0084, ADR-0088); they never touch a user's format or length.

**3. Storage, additive** (migration `0008_global_prompts.sql`):

- `ai_instructions_version.global_prompt`: null means the default prompt from the code, so a later fix to the default reaches every tab that has not saved its own text.
- `ai_instructions_version.note`: an optional note, at most 200 characters.
- Table `ai_quality_check`: tab, prompt hash, mean score, failed count, per-scenario ids and scores. It holds no text.

Every save, reset and restore adds a version (a restore sets `restored_from`). Text equal to the default is stored as the default.

Rows saved before this change are read as the default prompt with their company text added under "Company instructions:". They show as "Moved from old settings" in History. An ADR-0086 full prompt held the contract and cannot be split, so it reads as the default. Production held no saved versions when this shipped, so no data script was needed. `prompt`, `base_hash` and `ai_builtin_prompt` stay in the database, unused.

**4. A running call keeps its version.** ADR-0083's pin is unchanged. The first cached block is the contract plus the pinned global prompt, the same bytes for the whole call, and it now holds nothing per session. Calls that start after a save use the new version.

**5. Save needs Try it or Quality check on the exact draft.**

- Both return an HMAC token of the tab and the cleaned text (`server/promptTryToken.ts`, purpose `v2`), and the save action refuses a draft without a matching token.
- Reset to default needs no try.
- Restore needs none either: the version was tried when it was saved.

**6. Quality check** (live answers, `POST /api/admin/ai-instructions/quality`).

- Eight invented scenarios: no CV, documents cannot answer, behavioural with a CV, coding, concept, small talk, nothing asked, and the user's paragraph format.
- They are answered with the draft by Haiku and graded in one Sonnet request with the evaluation rubric. Code checks cover the hidden lines, the empty reply and the coding and paragraph shapes.
- The result is compared with the live prompt's score, measured once and remembered by hash.
- A warning shows for a drop of 0.3 or more, or a failed honesty or format case.
- It costs about $0.03, and twice that the first time a live version is measured.

**7. Server fallback.** In the answer route (`withContractFallback()`):

- a reply with no hidden first line gets the default type (`other`) before its first words;
- stray `[[word|…]]` tags are removed while streaming (code such as `[[1, 2]]` is untouched);
- a missing last line leaves the question to the transcript, as before;
- the log gets `missingMeta`, `missingQuestion` and `strippedTags` only.

**8. The page.**

- Tabs with a description and the live version (number, last edited by, when).
- The writing editor: a proportional font, soft wrap, coloured headings and bullet marks, Ctrl+F, its own undo and redo, optional line numbers, a counter, "Unsaved changes", and a warning before leaving.
- Edit / Preview, where Preview renders the prompt as a document.
- A sticky actions bar: Try it (the reply shown in the answer card users see), Quality check, History, Discard, Reset to default (confirmed) and Save (with an optional note).
- History with a side-by-side diff (unchanged runs folded) and one-click Restore.
- A yellow lint hint for edited lines that name layout or preferences.

No new dependency: the editor is a textarea over a styled mirror. The admin pages stay admins only, and every route answers 401 or 403 to anyone else.

## Consequences

- An admin can change everything except what the app parses, and a user's own format, length, tone, STAR, language and coding language still win.
- The default rules block changed bytes (contract first, lessons out, screenshot guidance in), so live answers wrote new cache entries after the deploy. With the rules block holding no lessons, every session of a version now shares it.
- An admin can weaken the honesty rules in the global prompt. The end reminder and ADR-0084's experience rules still state them, and the Quality check's honesty cases warn before saving.
- Each Quality check is a paid request set (about $0.03); it counts once against the admin's daily limit.
- Scenario 10 (discount pressure) scored 7.0 in the regression run (8–10 in the five runs before). The refusal of the 30% discount went into the Note only, an effect of ADR-0088's rule. It needs watching; the overall gate passed.

## Alternatives considered

- **Keep the full-prompt editor with a format check.** The check could only test for words. An admin could still break the shape or freeze old rules, which is what ADR-0087 had to patch.
- **Let the admin text come after the user's preferences.** That would override personal choices, which the brief rules out.
- **A code-editor dependency (CodeMirror).** It adds several packages for what the mirror editor does: highlighting, find, undo and soft wrap.
- **A data-migration script for old rows.** Production had none, and a read rule covers any that appear in other environments without a write.

## Validation

- Unit tests:
  - `prompt-global.test.ts`:
    - the contract is first even with an empty prompt;
    - the order is contract, prompt, preferences, question, reminder;
    - a user's Short / paragraph preference wins over an admin "detailed bullets" text;
    - ADR-0088's rule is word for word at the end;
    - the defaults hold no fixed values;
    - the cached block is the same for every request and session.
  - `aiInstructions.test.ts` (PGlite, real migrations):
    - admins only;
    - save, note, reset, empty prompt, length limits;
    - restore;
    - pins, and a running call keeps its version;
    - fallbacks;
    - legacy rows.
  - `ai-settings.test.ts`: non-admin blocked; Save refused without a matching token; Reset needs no try; logs carry no text.
  - `aiTry.test.ts`, `aiQuality.test.ts`: 401 and 403; the token; the live score measured once; warnings; code checks; a mocked run.
  - `answer-meta-fallback.test.ts`, `answer.route.test.ts`: the default type, no raw tags, counts in the log.
  - `promptDocument.test.ts`, `textDiff.test.ts`, `shared/aiInstructions.test.ts`, `AiSettingsPage.test.tsx`: the editor, Preview, lint, Save disabled until tried, diff folding.
  - Byte pins updated on purpose: `prompt-lessons.test.ts` (rules block SHA-256) and `prompt-documents.test.ts` (session block).
- Evaluation, 16 Nov 2026:
  - `answers`, 1 run: 9.30 (gate ≥ 8.86); hidden line 30/30; 08 9.0, 14 10.0; $0.094.
  - `notes`: 9.67 (gate ≥ 8); $0.074.
- Visual: `tests/visual/ai-settings-shots.ts` (17 page captures, invented data):
  - per tab: Edit, Preview, History and Try it;
  - Quality check, Compare, a tried draft, and dark mode.

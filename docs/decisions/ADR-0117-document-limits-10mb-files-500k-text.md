# ADR-0117: Documents: 10 MB per file, and a warning only above the 500,000-character limit

- **Status:** Proposed (24 Nov 2026; branch `doc-limits-10mb-500k`, not yet deployed)
- **Date:** 2026-11-24
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Create / edit session), §7 (`core/documents`) (version 4.54.0)
- **Supersedes / superseded by:** changes ADR-0067's file cap (20 MB) and replaces its warning above 280,000 characters and its deeper-model (Sonnet) line; keeps ADR-0067's 500,000-character session cap and ADR-0069's per-document cap.

## Context

Documents have two separate limits, and the old wizard mixed a third, softer line in between:

1. **File size:** `MAX_FILE_BYTES`, 20 MB, checked by `core/documents/extract.ts` before a file is read.
2. **Extracted text:** `MAX_SESSION_CHARS`, 500,000 characters for all of a session's documents. It is already a hard limit: the wizard refuses a document that would pass it (`fitsInSession()`), and `server/validate.ts` rejects a request over it.
3. **A cost warning above 280,000 characters** (ADR-0067, 4.8.1): "Above about 280k characters, each answer costs about 5× more and the first answer is slower. Remove documents you don't need." With Sonnet, also "Large documents with the deeper model are expensive. Haiku is recommended."

The 280,000 line was set when every live answer carried every document in full, so a large set pushed each answer past Haiku's 100,000-token price line. Since then live answers send the CV, the documents summary and matching document parts, and `server/budget.ts` holds every answer under `MAX_ANSWER_INPUT_TOKENS` (100,000 tokens). The warning now describes a cost that no longer happens, and it showed on sessions that work normally.

## Decision

Web only. No change to the desktop shell, the bridge, the server or the stored data.

1. **File size: 10 MB per file** (`MAX_FILE_MB = 10`, `MAX_FILE_BYTES = 10 × 1024 × 1024`; was 20 MB). The upload box reads the number from the constant ("up to 10 MB each"); the refusal says "… the limit is 10 MB."
2. **The 280,000-character warning and the Sonnet line are removed** (`LARGE_SESSION_CHARS`, `LARGE_SESSION_WARNING`, `DEEP_MODEL_WARNING`). At or under 500,000 characters the wizard shows no size warning, whatever the model.
3. **Above 500,000 characters** the wizard's Details step shows "Documents exceed the 500,000-character limit — remove some to continue" (`OVER_LIMIT_WARNING`, from `documentWarnings()` / `overSessionLimit()`), and **Next and Save are disabled** until documents are removed.
4. **The two gates stay independent.** Gate 1 is the file's size in bytes, checked once before reading. Gate 2 is the extracted text, summed over the session. A 10 MB file whose text is under 500,000 characters passes both with no warning; a file of any size whose text would take the session past 500,000 is refused when picked. Neither stands in for the other.
5. **500,000 stays a hard block, not only a warning.** The existing hard cap already said so (the wizard refuses, the server rejects), so the new warning is its backstop for a draft that is already over (for example one saved by an older version). The hard limits that keep the model's context window safe are unchanged: 500,000 characters per session (at most about 200,000 tokens, a fifth of the 1M-token window of `claude-haiku-5-5` and `claude-sonnet-5-5`, which `/api/summary` reads in one request), and 100,000 input tokens per live answer (`server/budget.ts`).

## Consequences

- A file between 10 MB and 20 MB that was accepted before is now refused at upload with the size message. Documents already in a library or session are not re-checked: the limit applies when a file is read.
- Sessions between 280,000 and 500,000 characters no longer show a warning; nothing else about them changes.
- Sonnet sessions with large documents no longer get the cost hint. Live answers on either model are held under 100,000 tokens by the budget, so the hint no longer matched the cost.
- The over-limit warning is rarely seen in practice: the wizard refuses documents before a session gets there.

## Alternatives considered

- **Make 500,000 a non-blocking warning.** Rejected: the server rejects any answer request over 500,000 characters, so a session saved over it would fail on every answer.
- **Keep the Sonnet line on its own.** Rejected: under 500,000 characters the wizard shows no size warning (point 2), and the line's premise (Sonnet reads every document on each answer) no longer holds.
- **Keep 20 MB.** Not chosen: 10 MB was asked for; larger files are almost always scans or slide decks with little text.

## Validation

Unit tests: `tests/unit/core/documents/limits.test.ts` (the caps, the exact warning words, none at or under 500,000 including at 280,001, one above it, the old constants gone, the two gates independent) and `tests/unit/core/documents/extract.test.ts` (a file over 10 MB is refused without being read; a file of exactly 10 MB is read).

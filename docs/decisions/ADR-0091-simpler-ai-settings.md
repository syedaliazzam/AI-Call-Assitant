# ADR-0091: Simpler AI settings: no Try it, no Quality check

- **Status:** Accepted
- **Date:** 2026-11-16
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §7.2, §8.1 (version 4.32.0)
- **Supersedes / superseded by:** amends ADR-0089 (removes its Try it, Quality check and the "tried" condition on Save).

## Context

ADR-0089 gave each AI settings tab a Try it panel and, for live answers, a paid Quality check. Save worked only after one of them had run on the exact draft. The developer asked for a simpler page: edit, preview, save, and undo through History.

## Decision

**1. Removed:**

- the Try it panel and the answer-card preview;
- the Quality check button, its results and its score comparison;
- their routes, `POST /api/admin/ai-instructions/try` and `POST /api/admin/ai-instructions/quality`;
- the server code behind them (`server/aiTry.ts`, `server/aiQuality.ts`, `server/promptTryToken.ts`) and the browser code (`core/admin/aiTry.ts`);
- the request shapes in `@kite/shared`.

The build has no `/api/admin/*` route any more: a signed-in request to one gets 404, and a signed-out one gets the proxy's 401 first, as for every API path. The input-budget facts the page still shows moved to `server/aiBudget.ts`.

**2. Save needs no try.**

- Save is enabled whenever the draft differs from the live version and fits the 30,000-character limit. It asks for confirmation, with an optional note.
- The save action takes the tab, the prompt and the note. There is no token.
- The lint hint for layout or preference words stays visible, and never blocks Save.

**3. Kept as in ADR-0089:**

- the tabs, each with its description and live-version status;
- the editor with Edit / Preview;
- Discard, and Reset to default (confirmed);
- History with Compare and Restore;
- the leave warning;
- admin-only access;
- the locked app contract and the automatic end reminder;
- the version pin, so a running call keeps its version.

**4. The `ai_quality_check` table stays, unused.** Migrations are additive only (ADR-0050); no destructive migration is made.

## Consequences

- An admin can save a prompt without spending a request, and without a check of how answers change. History's Restore and Reset to default are the way back.
- Nothing in the page spends Claude requests any more.
- Prompts, answers and caches are unchanged (no prompt text changed), so no evaluation was needed.

## Alternatives considered

- **Keep Try it but make it optional.** The developer asked for both to go; an optional panel would keep the code and the paid route for little use.
- **Drop the `ai_quality_check` table.** It is a destructive migration, which ADR-0050 rules out.

## Validation

- Unit tests:
  - `tests/unit/api/ai-settings.test.ts`: a non-admin is refused; a save with no try succeeds, including a line the lint flags; the note is kept; Reset; restore.
  - `tests/unit/features/admin/AiSettingsPage.test.tsx`: Save is disabled with nothing to save and enabled for any change, a flagged one too; there is no Try it or Quality check; History opens with Compare and Restore.
  - `tests/unit/server/aiBudget.test.ts`.
- On production (signed out): the pin route and the removed paths answer 401 (the proxy), and the page redirects to sign-in. The build output has no `/api/admin` routes.
- Visual: `tests/visual/ai-settings-shots.ts`, 13 page captures (Edit, Preview and History per tab, Compare, an edited draft with the lint hint and Save enabled, dark mode).

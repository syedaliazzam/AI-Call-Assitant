# ADR-0036: Per-user daily limit, with request counts in the accounts database

- **Status:** Accepted (developer, 3 Nov 2026: "Usage counts in Neon: approved (counts only, no text)")
- **Date:** 2026-11-03
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` v3.13.0: §2 (accounts database), §5 (Admin: usage), §7.2 (error code `daily_limit`), §8.1 (where data lives)
- **Supersedes / superseded by:** amends ADR-0022 ("Neon for accounts and sign-in sessions only")

## Context

The whole team shares one Claude key and one spend limit of about $20 a month (CLAUDE.md, "Claude key and spend"). One person's runaway use (a stuck auto-answer, a script, hands-free voice later) could use the month's budget and stop answers for everyone. The developer asked for a per-user daily limit, set by an admin (default 300 a day), with a friendly message when it is reached, and an Admin → Usage page with each person's counts for today and the last 7 days, without any text.

A limit across devices and across the browser and desktop app needs a counter on the server. Until now the accounts database (Neon) held accounts and sign-in sessions **only** (ADR-0022, CLAUDE.md), so this is an architecture change.

## Decision

1. **Two new tables in the accounts database** (migration `apps/web/drizzle/0001_usage_counts.sql`):
   - `usage_day (user_id, day, requests)`: one row per user and UTC day (`'YYYY-MM-DD'`), primary key `(user_id, day)`, deleted with the account (`ON DELETE CASCADE`).
   - `app_setting (key, value, updated_at)`: app-wide settings; today only `daily_limit`.
   They hold **counts and one number, never text**: no question, answer, transcript, document or screenshot content.
2. **Every Claude request counts**, before Claude is called (`src/server/usage.ts` `countRequest()`): `/api/answer` modes `answer`, `chat`, `screenshot` and `kite`; `/api/notes`, `/api/ask`, `/api/prepare`, `/api/job-import` (after the page was read) and `/api/preview`. Warm-ups (`warm`) and the Day 1 `hello` test never count: they are automatic or for developers.
3. **One round trip on the hot path.** `INSERT … ON CONFLICT (user_id, day) DO UPDATE SET requests = usage_day.requests + 1 RETURNING requests` counts atomically; the limit is kept in server memory for 60 s, so an admin's change applies within a minute. The time is logged per answer as `msLimit`.
4. **A refused request still counts.** The counter is increased first and the request is refused when the new count is above the limit. This keeps it to one statement, and the page shows how often someone hit the limit.
5. **Over the limit:** HTTP 429 with the new error code `daily_limit` and the message "You've reached today's limit of N answers. It resets at midnight UTC; an admin can raise it." (`dailyLimitMessage()` in `@kite/shared`), shown as it is in the live view, the overlay, Ask Kite, the notes status, the review and Prepare.
6. **Fail open.** If the counter cannot be written (Neon down), the request goes ahead and the failure is logged (user id and error name only). The limit protects spend; stopping every answer because a counter failed would be worse.
7. **Admin → Usage** (`/admin/usage`, admins only): a form for the limit (whole number, 1 to 100,000) and a table of each person's requests today and over the last 7 days.

## Consequences

- One person can no longer use the team's whole monthly budget in a day; the limit is per person per UTC day.
- Each counted request adds one database statement before Claude is called (expected 10–30 ms from Vercel to Neon in the same region); logged as `msLimit`, so the effect on time to first word can be measured.
- The accounts database now holds a small row per user per day; the Neon free plan has ample room.
- "Neon holds accounts only" is no longer exact: CLAUDE.md and the architecture document now say accounts, sign-in sessions and daily request counts.
- The migration must be applied to the production database before the code that uses it is deployed (`pnpm --filter web db:migrate`, additive only).

## Alternatives considered

- **Count in the browser (IndexedDB):** rejected; a limit per device is easy to bypass and does not cover the browser and desktop app together.
- **A Vercel KV / Redis counter:** rejected; a second paid store for one counter, when Neon is already there.
- **Count only after Claude replies:** rejected; it cannot stop the request that goes over, and it misses failed or cancelled replies that still cost money.
- **Check, then count, as two statements:** rejected; two round trips on the hot path, and two requests at the same moment could both pass.

## Validation

- `apps/web/tests/unit/server/usage.test.ts`: counting per user and day, refusal over the limit (and the refused request counted), the default 300, the 60 s cache, setting validation, fail open, the report.
- `apps/web/tests/unit/api/answer.route.test.ts` and `notes.route.test.ts`: 429 `daily_limit` with the friendly message and Claude never called; answer and chat counted, warm and hello not.
- `apps/web/tests/unit/core/answer/unavailable.test.ts`: the message is shown as it is.
- Human check after deploy: Admin → Usage shows today's counts; with the limit set to 1, a second answer shows the friendly message; set it back to 300.

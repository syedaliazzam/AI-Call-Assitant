# ADR-0081: Disposable end-to-end test accounts, and the Users page's row menu and guards

- **Status:** Accepted (developer's decision, 14 Nov 2026: delete the two standing test accounts after the dry run; restyle Admin → Users).
- **Date:** 2026-11-14
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Admin: users), §8.2 (accounts), §11 (testing)
- **Supersedes / superseded by:** replaces the standing test accounts of Day 3 and Day 4 (`day-04-answers.md` "Test account"; the admin one "stays disabled between runs"). ADR-0022 (accounts) and ADR-0050 (one database, `--prod` to write) stay.

## Context

Production kept two test accounts, `kite-e2e@example.com` (role user) and `kite-e2e-admin@example.com` (role admin), for the manual production suites (`apps/web/tests/e2e-prod/`). Both were disabled between runs, but they still showed on Admin → Users and were counted there, one of them was an admin, and they held 919 synced call-data rows and 9 usage rows from earlier runs. Nothing in production code and nothing in CI used them: only the manual suites, the scripts `create-e2e-user`, `e2e-admin`, `rotate-e2e-password` and `sync-user-ids`, and the docs.

The Users page itself was a form above a table with three wrapping buttons per row, two-line dates, and `window.confirm` for only two of the three actions.

## Decision

1. **No standing test accounts.** The two accounts and everything stored for them were deleted on 14 Nov 2026 (2 users, 2 credentials, 9 usage rows, 919 call-data rows; no sessions, Drive rows or desktop link codes) with `scripts/delete-test-accounts.ts`, after its dry run was shown to the developer.
2. **A run creates its own account and deletes it.** `create-e2e-user --prod [--admin]` before the run (it now accepts only `kite-e2e…@example.com` addresses and prints no email or id); `delete-test-accounts --prod` after. Without `--prod` the delete script is read-only and prints the SQL and the row counts per table; with it, the same statements run in one Neon batch (one transaction) and the deleted accounts' lines leave `apps/web/.env.local`. It acts only on `kite-e2e…@example.com` addresses.
3. **Retired:** `scripts/e2e-admin.ts`, `scripts/rotate-e2e-password.ts`, and the script-only helpers `setTestAccountDisabled()` / `setTestAccountPassword()` in `src/server/users.ts`.
4. **Users page (web only).** The header shows "Users", a subtitle, Usage and a primary **Add user** (the create-account flow, now a dialog) instead of Create session. A toolbar has search (name or email), Role and Status filters and the count. Rows show an avatar with initials, the name with "You", the email, Role and Status badges, Created and **Last active** on one line each, and one **⋯ menu** (Reset password, Make admin / Make user, Disable / Enable). Reset password, role changes and Disable ask first, with what will happen; every action ends in a toast. Below 1024 px the table becomes cards.
5. **Guards on the page:** your own row's actions are greyed out ("Your account"), and the last active admin cannot be demoted or disabled ("Last active admin"); they are checked again before an action runs. The server is unchanged: it still refuses any change to the caller's own account and checks the caller is an admin.
6. **Last active** is read-only: the later of an account's newest sign-in session refresh and its last day with a Claude request (`usage_day`). It reads ids and times only.

## Consequences

- Admin → Users lists only real people. The page cannot lock the team out of the Admin pages.
- A production suite run needs two extra commands; a run that forgets the delete leaves a disabled-looking test account on the Users page until the next delete (the dry run shows it).
- The account-sync suite needs the new account in `KITE_SYNC_USERS` unless it is `*` (`sync-user-ids` includes `KITE_E2E_EMAIL`).
- Old ids of the deleted accounts may remain in `KITE_SYNC_USERS`; an id with no account does nothing.

## Alternatives considered

- **Keep the accounts disabled and hide them from the page** (a system/test flag): keeps data nobody needs, needs a schema column and a filter in every count, and still leaves an admin account in production.
- **A separate test database:** Kite has one database by design (ADR-0050).

## Validation

- Dry run before and after the delete (2 accounts found, then 0).
- Unit tests: `tests/unit/features/admin/userList.test.ts` (filters, count, dates, guards, menu rows, confirmations), `tests/unit/scripts/test-accounts.test.ts` (address rule, plan, `.env.local` clean-up), `tests/unit/server/users.test.ts` (Last active).
- Harness: `tests/integration/screens.spec.ts` (the Users page in light and dark at 1440 and 390 px; the ⋯ menu, a confirmation, the toast and the guards).

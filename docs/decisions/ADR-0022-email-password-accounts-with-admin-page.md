# ADR-0022: Email + password accounts created by an admin (Better Auth + Neon)

- **Status:** Accepted
- **Date:** 2026-10-26
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §8.2, §10.1, §12 Day 1
- **Supersedes:** the Google Workspace / Microsoft 365 sign-in in v3.0 (§8.2) and the `kite://` desktop sign-in hand-off

## Context

The team has no Google Workspace or Microsoft 365 tenant, so v3.0's company-account sign-in is not possible. Kite still needs sign-in on every page and API route, because a public URL would otherwise let anyone spend Claude credits. The solution must be simple, free (apart from Vercel and Claude) and work inside the desktop app.

## Decision

- **Better Auth** with email + password (`disableSignUp: true`, so there is no public sign-up) and its **admin plugin** (create user, list users, set role, set password, ban/unban).
- **Accounts:** an admin creates them at `/admin/users` with a temporary password and shares it directly. A `mustChangePassword` flag forces a password change on first sign-in and after a reset.
- **First admin:** created from the command line.
- **Storage:** user accounts and sign-in sessions live in **Neon Postgres** (free plan, added from the Vercel Marketplace). No call data is stored there.
- **Desktop app:** uses the same `/login` page inside its window; no browser hand-off.

## Consequences

- The architecture gains one small database, holding accounts only. Session and call data stay on the device as before.
- There is less code than a custom auth system: hashing (scrypt), sessions and admin operations come from Better Auth.
- The `kite://` deep-link hand-off is removed from Day 6.
- Password resets are manual (admin-generated temporary password); there is no email sending.

## Alternatives considered

- **Auth.js credentials provider plus a custom users table.** Rejected: more custom code, and the Auth.js project now recommends Better Auth for new projects.
- **Hosted auth (e.g. Clerk).** Rejected: another vendor.
- **Vercel deployment password protection.** Rejected: not per-user, and a paid add-on.

## Validation

Day 1 Stage 2 checks:

- the admin creates a user;
- the user is forced to change their password;
- non-admins are blocked from `/admin/users`;
- disabling a user signs them out (Day 5: of every page and action at once, and of answers within 60 s; see "Update: session cookie cache" below).

## Update: session cookie cache (Day 5, 2026-10-31)

**Decision.** Better Auth's session cookie cache is on, with a **60-second** max age (`apps/web/src/server/auth-options.ts`). It is used only where speed matters:
- **Answer routes** (`/api/answer`, and `/api/notes` from Day 5): read the session from the signed cookie (`getCachedSession()` in `server/auth.ts`). They skip the database lookup, and the free database's cold starts of about 1.4 s. When the cached copy is older than 60 s, Better Auth reads the database and sets a new cookie. The route sends that `Set-Cookie` back on every response, the streamed answer included, so the next answers use the cache again.
- **Pages and server actions** (`getSession()`): pass `disableCookieCache`, so they always read the database.

**Trade-off.** A user who is disabled, or whose password an admin resets, is refused by every page and action at once, but can still get answers for **up to 60 seconds**, until the cached cookie expires. Admin pages are not affected, because a role change or a disable is read from the database. A cached "must change password" is checked against the database once before an answer is refused, so a user who has just changed their password is not blocked for that minute.

**Tests.** `tests/unit/server/auth-options.test.ts` runs a real Better Auth instance with these settings on an in-memory database and a mocked clock:
- a disabled user is accepted from the cache at 59 s and refused at 61 s, and refused at once by a database read;
- after 60 s, an active user gets a fresh cache cookie;
- `mustChangePassword` is in the cached session.

`tests/unit/server/session-cache.test.ts` covers the "must change password" re-check. The route test checks that `Set-Cookie` is forwarded.

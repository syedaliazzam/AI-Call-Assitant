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
- disabling a user signs them out.

# ADR-0052: The desktop link signs in with a one-time code; the session file hand-off goes

- **Status:** Accepted (developer, 8 Nov 2026) · **Shipped to everyone in release 1.3.0 (9 Nov 2026).** The accountSync switch stays in the code until 16 Nov 2026 as a kill switch.
- **Date:** 2026-11-08
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §3.3, §5 (Choose platform, Home panel), §7.2, §7.3; `docs/design/paramount-ai-ui-spec.md` §3 (S9)
- **Supersedes / superseded by:** replaces ADR-0045's "desktop link and the session file" for accounts with account sync (ADR-0049). Desktop 1.3.0.

## Context

With 1.2.0, choosing **Desktop app** in the browser saved a session file and opened `paramountai://session/<id>`. The desktop app then asked for the file ("Bring this session here / Choose the file"). With account sync (ADR-0049) the session is already in the account. What is missing is that the desktop app may not be signed in, or may be signed in to another account. The reference app opens straight on the session's start card.

## Decision

1. **Issue.** **Desktop app** asks `POST /api/desktop/link-code {sessionId}` for a one-time code.
   - The request needs a session cookie, read from the database. The account must have the accountSync switch and must own the session; otherwise the answer is 404.
   - The code is 32 random bytes, base64url (43 characters), valid for **60 s**.
   - At most 10 per account per minute; expired codes are removed whenever a new one is made.
   - **Only the code's SHA-256 is stored**, in Better Auth's `verification` table (made for short-lived one-time values), bound to `<userId>|<sessionId>`. There is no new table and no migration.
   - Codes are never logged.
2. **Deliver.** The browser opens `paramountai://session/<id>/<code>`.
   - The 1.3.0 parser accepts exactly that shape (code `^[A-Za-z0-9_-]{43}$`) and everything it accepted before.
   - The shell keeps the code **in memory**, at most 60 s, and loads `/desktop/link?session=<id>`. **The code is never in an address the server sees.**
   - The page gets the code once through `window.kiteDesktop.consumeLinkCode()` (IPC `kite:link-code`, Kite origin only); after that the shell forgets it.
3. **Redeem.** `/desktop/link` is open to signed-out visits. It looks at the code (`POST /api/auth/desktop-link/peek`: the account's email and the session) and at who the app is signed in as:
   - **The same account:** it goes straight to the start card; the code is not used.
   - **Signed out:** `POST /api/auth/desktop-link/redeem {code, sessionId}`.
   - **Another account:** it **asks first**: "This link is for A. This app is signed in as B. Switch to A?" (**Switch** / **Stay signed in**).

   Redeem deletes the row in the same statement that checks it (`DELETE … WHERE identifier = hash AND expires_at > now() RETURNING`), so a code works **once**, even when two requests race. Then:
   - the session must be the one the code was made for;
   - a disabled account, or one that must change its password, is refused;
   - the app gets **a session of its own** (Better Auth `createSession` + `setSessionCookie`), so signing out in the browser does not sign the app out.
4. **Start card.** Shows **"Signed in as <email>"**. When the session is not in this device's cache yet, it pulls from the account once; if it is still missing, it says the session is not in this account. A link never starts a call (unchanged).
5. **The file hand-off is removed** for accounts with account sync, in the web app. It is removed in the shell from 1.3.0: the `pickHandoffFile` and `deleteHandoffFile` calls and their IPC channels are gone, and `handoff.ts` becomes `links.ts`.
6. **Old shells.** A 1.2.0 shell's parser refuses a link with a code, so nothing opens. After 6 s the browser page says: "Nothing opened? Update the desktop app…, or open it and press Start on this session there." The session is in the account, so the launcher (ADR-0051) shows it in a 1.2.0 shell too.

## Consequences

- One click from the browser to the desktop start card, signed in, on any computer, with no file left in the downloads.
- **A planted link** (any web page can open `paramountai://`) can at most sign the app in to the account that made the code, and only after asking when another account is signed in. It never starts a call.
- **The code passes through the operating system's link handling** (on Windows, a command-line argument of the second launch), where other programs of the same user could see it for a moment. It works for 60 s and only once.
- The desktop app may now hold sessions of the account in its own cookie store, like any signed-in browser. Admin → Users → reset or disable ends them.

## Alternatives considered

- **Better Auth's `oneTimeToken` plugin** (checked in the official docs, 8 Nov 2026):
  - verifying a token returns **the same session** the browser has, so the app would share the browser's sign-in;
  - the token is not bound to a call session;
  - its expiry is set in whole minutes.

  A small plugin of our own does exactly what is needed.
- **Code in the page address or a fragment:** it would be in history, in logs or in a referrer.
- **A new table for codes:** the `verification` table is meant for this and needs no migration.
- **Keep the session file:** a manual step, and a copy of the person's documents left in the downloads.

## Validation

- **Unit tests:**
  - `tests/unit/server/desktopLink.test.ts` (PGlite): issue only for the account's own session; only the hash is stored; 10 a minute; take works once, also when two race; nothing after 60 s; the route's 401/403/404/400/429.
  - `tests/unit/shared/protocol.test.ts`, `tests/unit/platform/desktop.test.ts`.
  - Desktop: `links.test.ts`, `home.test.ts` (code given once, gone after 60 s, never in the address), `preload.test.ts`.
- **Production:** `tests/e2e-prod/desktop-link.spec.ts` (test account):
  - a code signs a fresh browser in once; reuse, another session and 60 s are refused;
  - this checkout's 1.3.0 shell with a temporary profile opens the start card signed in from a link with a code.
- **Human, on the installed 1.3.0:** a real link from Chrome, and the account-switch question (regression checklist).

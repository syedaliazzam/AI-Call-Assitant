# ADR-0047: The desktop app keeps the vercel.app origin

- **Status:** Accepted
- **Date:** 2026-11-05
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.3, §10.2; `docs/deploy/subdomain.md`
- **Supersedes / superseded by:** replaces decisions 5 and 6 and the open question in ADR-0046. The rest of ADR-0046 stands.

## Context

ADR-0046 put the web app on `https://call.paramountintelligence.co` and kept `https://kite-call-assistant.vercel.app` working. It also prepared desktop 1.2.1 to open the new address, and left one question open before release.

Local data is stored per origin. Sessions, documents, transcripts, answers and settings live in IndexedDB and local storage, and the sign-in cookie is separate per address too. A desktop app that opened the new address would find none of this. It would show no sessions and ask for sign-in. The data would still be on disk under the old origin, but people would see it as lost, and updates install by themselves, so they would have no warning.

## Decision

1. **The desktop app keeps the `kite-call-assistant.vercel.app` origin,** in updates and in new installs. It does not switch to the new domain, and it allows only that one origin, as it does today. Version 1.2.1 will not make this change.
2. **`kite-call-assistant.vercel.app` must never be removed or redirected.** Every desktop app depends on it, and a redirect would leave them stuck, because they block every other origin. This includes anything that would end the address indirectly, such as renaming or replacing the Vercel project.
3. **The address is not shown to people.** Browser users are told to use `call.paramountintelligence.co`. The desktop app does not show its address, so nobody using it has a reason to care which one it loads.
4. **If the desktop app must ever move, it needs automatic migration first.** On first start of the new version, the app reads the local data on the old origin and brings it to the new one, and only then switches. Telling people to export before updating is not enough, because updates install by themselves and anyone who misses the message sees an empty app.

## Consequences

- Nobody loses data and nobody needs instructions. Installed apps carry on as they are.
- Production keeps answering on both addresses for as long as any desktop app exists. `KITE_TRUSTED_ORIGINS` must always list the old address, or sign-in in every desktop app stops. `apps/web/tests/e2e-prod/domain.spec.ts` checks this on production.
- A person's browser and desktop app were already separate stores, so nothing changes between them. A session still reaches the desktop app as a file (ADR-0045), which does not depend on the address.
- The app's desktop origin remains a `vercel.app` address, which depends on staying with Vercel. Leaving Vercel would need the migration in decision 4.
- The prepared work is not used. Draft PR #10 is closed and keeps its commits; its branch and local installer are deleted. That work does not contain a migration.

## Alternatives considered

- **Automatic migration now:** the only safe way to move, but there is nothing to gain today that is worth building and testing it for. It stays the plan if a move is ever required.
- **Export before updating, import afterwards:** simple, but it relies on everyone seeing a message before an update they do not control.
- **Switch only new installs to the new domain:** avoids data loss, but leaves two kinds of desktop app to support and test, for no benefit to the person using it.

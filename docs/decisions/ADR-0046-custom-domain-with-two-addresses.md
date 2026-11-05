# ADR-0046: A custom domain, with the old address kept working

- **Status:** Accepted
- **Date:** 2026-11-05
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.3, §10.2; `docs/deploy/subdomain.md`
- **Supersedes / superseded by:** decisions 5 and 6 and the open question are replaced by ADR-0047. It carries out the subdomain item in §14, on `call.paramountintelligence.co` rather than the `kite.` name planned there.

## Context

People should open the app at `https://call.paramountintelligence.co`. Three things stand in the way of a simple switch:

1. **Installed desktop apps are locked to the old address.** Versions 1.1.0 and 1.2.0 load `https://kite-call-assistant.vercel.app` and block every other origin, so a redirect would leave them stuck.
2. **Sign-in trusted only one public address.** Trusted origins were `BETTER_AUTH_URL` plus the deployment's own addresses. Moving `BETTER_AUTH_URL` alone would have refused sign-in on the old address. Live production answered 403 for the new domain before this change, which confirms the check is active.
3. **Call data belongs to one address.** Sessions, documents, transcripts and settings live in IndexedDB and local storage, which browsers and Electron keep separately for each origin. The sign-in cookie is separate per address too.

## Decision

1. **Production answers on both addresses, with no redirect.** `BETTER_AUTH_URL` is the new address, and a new setting, `KITE_TRUSTED_ORIGINS`, lists every address production is opened from. A wrong entry stops the app rather than being dropped, because a dropped address would silently break sign-in for everyone using it.
2. **Each address keeps its own sign-in.** The cookie has no domain set. The two addresses share no parent domain, so a shared cookie is not possible.
3. **No CSP is added.** The app sends none today, so there is nothing to extend. Adding one is a separate decision.
4. **Links inside the app stay relative,** so a page opened in an old desktop app never points at an address that app blocks.
5. **Replaced by ADR-0047.** The desktop allowed list becomes two origins in 1.2.1, with the new address as the default. The list is fixed in the program, and exactly these production origins get it; an address given for testing allows only itself.
6. **Replaced by ADR-0047.** 1.2.1 is prepared but not released, because of the data problem below.

## Consequences

- Browser users open a new address and a new, empty store. Their sessions stay on the old address and can be moved with **Export my data** and **Import data**, which merge without duplicates. The user guide says so.
- The speech model is cached per address too, so the first call on the new address downloads it again.
- Installed 1.1.0 and 1.2.0 apps are unaffected.
- **Decided in ADR-0047: the desktop app stays on the old address.** The question was: 1.2.1 cannot ship as it stands. An updated desktop app would open the new address, find no sessions and ask for sign-in. The data is still on disk under the old address, but people would see it as lost. Before release, one of these must be chosen:
  - **Automatic move (recommended):** on first start of the new version, read the local data on the old address and bring it to the new one, and only then switch. People notice nothing except signing in again.
  - **Guided move:** tell people to export before updating and import afterwards. This is simple, but anyone who misses the message sees an empty app, and updates install by themselves.
  - **Stay put:** updated apps keep the old address and only new installs use the new one. This is safe, but the old address must stay forever.
- The old address has to stay until no supported desktop version depends on it.

## Alternatives considered

- **Redirect the old address to the new one:** breaks every installed desktop app.
- **Move `BETTER_AUTH_URL` only:** refuses sign-in on the old address.
- **Hard-code both addresses in the web app:** works, but previews and local runs would trust production's addresses, and changing a domain would need a code change.
- **Allow any origin in the desktop shell:** removes a security boundary that the rest of the desktop design relies on.

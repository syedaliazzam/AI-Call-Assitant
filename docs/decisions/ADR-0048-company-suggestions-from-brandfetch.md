# ADR-0048: Company names may be sent to Brandfetch for suggestions

- **Status:** Accepted
- **Date:** 2026-11-05
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §2 (F2), §7.4; `docs/design/paramount-ai-ui-spec.md` §3 (S3, S4)
- **Supersedes / superseded by:** none

## Context

Creating a session means typing a company, often the same few, and session cards show only a letter. Suggesting companies and showing their logos makes both quicker to read and use.

Until now, the only session text leaving the device went to our own server for Claude. A suggestion service is a new outside party, and which companies someone is interviewing with can be sensitive. So this needs a recorded decision and a way to turn it off.

## Decision

1. **The company field suggests from two places, in order.** First, companies from the user's own past sessions, which work offline and send nothing. Then results from Brandfetch's Brand Search API, after two characters and a 250 ms pause.
2. **The browser talks to Brandfetch directly,** as its terms require. Nothing goes through our server, so our server never sees the searches.
3. **What is sent, and to whom.**
   - **Searching:** the typed company text and our client ID. No cookies, session details, documents or transcript.
   - **Showing a logo:** a picked company's domain and our client ID, each time a card or row with that logo is shown.
   - **Always:** Brandfetch also sees the user's IP address and the app's address in the `Referer`, as with any web request. Its Logo API requires the `Referer`.
   - Typed text is never logged by the app.
4. **The off switch.** Settings → Privacy → Company suggestions is on by default. Off means no request of any kind goes to Brandfetch: the field suggests from past sessions only, and cards show their letter tile. This covers logos as well as searches, because a logo request also tells Brandfetch the company's domain. If the setting cannot be read, it counts as off.
5. **What is kept.** Picking a result keeps the name in the session's company field and its domain in `companyDomain`, on the device. Search results and icon addresses are never stored, because Brandfetch's terms forbid caching them and icon addresses expire after 24 hours. Changing a session's company removes its domain, so a new name cannot keep an old logo. The domain is not sent with answers.
6. **Logos follow Brandfetch's rules.** They are hotlinked with plain images, not fetched by code or passed through `next/image`, and the `Referer` is kept. Logo requests ask for a 404 rather than Brandfetch's placeholder. A 404, any other failure, being offline, or having no client ID all show the letter tile. No badge such as "verified" is shown; only the name, domain and icon are read from a result.
7. **The client ID comes from `NEXT_PUBLIC_BRANDFETCH_CLIENT_ID`.** It reaches the browser, as these APIs intend, and is not a secret. Without it, nothing goes to Brandfetch.

## Consequences

- People who leave the setting on share the companies they type, and those they picked, with Brandfetch. The setting's wording says so.
- It is on by default, by the team's decision. Someone who wants no outside party must turn it off on each browser and desktop app, because the setting belongs to the device.
- **Decided (6 Nov 2026): keep saving the picked company's name and domain.** A company's name and website are public facts the user chose; no content from Brandfetch is stored (no icon addresses, no results, no brand data). Brandfetch's guidance says results should be "fetched live and not altered or persisted", and does not address keeping what a user selected, so we have asked Brandfetch to confirm. **If they say no, the fallback is to stop saving the domain:** cards then show letter tiles only, and suggestions stay as they are.
- Brandfetch's free limits apply: for search, 500,000 requests a month, 200 per IP address and 6,000 per client ID every 5 minutes. They are unlikely to matter for a small team, and over a limit the field still works as plain text.
- The desktop shell needs no change, because it does not restrict images or requests from pages (see `apps/desktop/tests/manual/logo-images.spec.ts`).

## Alternatives considered

- **Past sessions only:** nothing leaves the device, but a new company gets no help and cards get no logos. This is what the off switch gives.
- **Pass searches through our server:** would hide users' IP addresses from Brandfetch, but its terms require requests to come from users' browsers.
- **Off by default:** the most private choice, but few people would find the feature.
- **Store logos ourselves:** would work offline and send nothing when showing cards, but Brandfetch's terms do not allow it.

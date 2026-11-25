# ADR-0125: The Mac download is offered only once the Mac app is published

- **Status:** Accepted (25 Nov 2026, the developer's release brief, Part 2 item 1)
- **Date:** 2026-11-25
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §10.3 (installation) (version 4.63.0)
- **Supersedes / superseded by:** amends ADR-0109 §4 (the "Get Paramount AI for Mac" dialog always showed the Terminal command and the .dmg) and ADR-0114 §6 (the download places). Keeps the Windows download (ADR-0114) unchanged.

## Context

The web app with the Mac work (ADR-0109 to ADR-0121) goes to production on 25 Nov 2026, before the Mac app is published: that happens after the real-Mac release test that night (`docs/testing/mac-release-test.md`). Until then the `mac-latest` release in `Zainpak123/kite-releases` does not exist, so the install command would fail ("could not reach the download") and the .dmg link would open a missing page. Production must not offer a broken install.

## Decision

Web only. No change to the desktop shell or to how the Mac app is published.

1. **One source of truth: the Mac channel itself.** The Mac app counts as published when `https://github.com/Zainpak123/kite-releases/releases/download/mac-latest/latest-mac.yml` answers 200 with a `version:` and a `.zip` `path:` (`src/server/macRelease.ts`). `publish-mac.mjs` uploads that file last, after the zip, so it means a complete release. A 404, an error, an unreadable file or no answer within 5 s all mean "not published" (safe). The answer is kept 1 minute when "not published" and 10 minutes when "published".
2. **`GET /api/mac-release`** answers `{ published }`, open to signed-out visitors (the sign-in page has the desktop app link; `proxy.ts` `PUBLIC_PAGE_PATHS`), never cached by browsers.
3. **Every "Get it for Mac" place** opens the same dialog (`MacInstallDialog`). It asks once per page, when opened (`core/download/macRelease.ts`, `ui/useMacRelease.ts`). Until the answer is "published", it shows **"Mac version coming soon"**, with the advice to use Paramount AI in Chrome or Edge on the Mac, and **no** install command and **no** .dmg link. Once published, it shows the steps exactly as before.
4. **`install-mac.sh`** keeps the HTTP status of `latest-mac.yml`: a 404 stops with "Mac version coming soon: Paramount AI for Mac has not been published yet…" before anything is downloaded or installed. Any other non-200 says the download could not be reached. With a release, nothing changes.
5. **It switches on by itself.** Publishing `mac-latest` with `publish-mac.mjs` is all it takes: the dialogs show the command within a minute, and the installer works at once. No deploy, setting or environment variable.
6. **Windows is unchanged:** `/download/windows` and every Windows button work as before.

## Consequences

- Production can carry the Mac work before the Mac app exists, with no broken path.
- Taking `latest-mac.yml` off the release (the Mac rollback in the runbook) also turns the dialogs back to "coming soon" within ten minutes, and the installer says so at once.
- The user guide (Help) still describes the Mac install command; run before the release, the command now says "coming soon" and installs nothing.
- One small request to GitHub at most every minute per server instance while the dialog is used; none otherwise.

## Alternatives considered

- **An environment variable or admin switch.** Someone must remember to flip it after publishing; the channel cannot be forgotten.
- **A build-time flag.** It needs a deploy after publishing, which this release wants to avoid.
- **Hide the Mac links altogether.** The brief asks for "Mac version coming soon" in their place, and Mac users of the browser app still need to know the app is coming.

## Validation

- Unit: `tests/unit/server/macRelease.test.ts` (404, 200 with a release, errors, timeouts, the 1 and 10 minute reuse, turning on by itself, the route), `tests/unit/core/download/macRelease.test.ts` (one question per page, failures count as no; the installer's 404 path stops before any download), `tests/unit/features/shell/MacInstall.test.tsx` (coming soon vs the steps), `tests/unit/proxy.test.ts` (the route opens signed out).
- Integration: `tests/integration/live.spec.ts` (the Connect card's Mac dialog says "Mac version coming soon" and offers no command or .dmg while not published).
- Production, after the deploy: `GET /api/mac-release` → `{"published":false}`; `curl -fsSL …/install-mac.sh | bash` on a Mac before the release prints "Mac version coming soon".

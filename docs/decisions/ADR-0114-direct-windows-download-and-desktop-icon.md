# ADR-0114: A direct Windows download (/download/windows) and a Desktop icon that comes back

- **Status:** Accepted (23 Nov 2026, agreed with the developer; on branch `windows-download-shortcut`, not yet deployed or released)
- **Date:** 2026-11-23
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §8.3 (Controls), §10.3 (Desktop app install) (version 4.51.0)
- **Supersedes / superseded by:** replaces ADR-0071's "Get the desktop app opens the releases page"; extends ADR-0069's shortcut repair to the Desktop shortcut; keeps ADR-0028 (the public releases-only repository, the versioned installer name)

## Context

Two complaints from people installing the Windows app:

1. **"Download" lands on a GitHub page.** Every download link (the sign-in page, the sidebar card, the desktop hand-off page, the guide) pointed at `https://github.com/Zainpak123/kite-releases/releases/latest`. People had to find the right file under **Assets**. GitHub's stable `releases/latest/download/<name>` cannot be used directly, because the installer's name carries its version (`Paramount-AI-Setup-${version}.exe`), and the updater relies on that name. The release's `latest.yml` (the updater's own file) has a fixed name, and `releases/latest/download/latest.yml` answers 200. Its top-level `path:` line names the current installer (checked on 23 Nov 2026: `path: Paramount-AI-Setup-1.7.3.exe`).
2. **"It installs every time."** The installer created a Start Menu shortcut only (`createDesktopShortcut: false`). People opened the app again by running the Setup `.exe` still in their Downloads folder, which reinstalled it each time.

## Decision

**Web (deploys with Vercel):**

1. A new route, `GET /download/windows` (`app/download/windows/route.ts`, logic in `src/server/desktopDownload.ts`):
   - fetches `releases/latest/download/latest.yml` (public repository, no token, 5 s timeout);
   - reads the top-level `path:` line, and accepts it only if it is a plain `.exe` file name (letters, digits, `.`, `_`, `-`), so the redirect can only point at an installer in the releases repository;
   - answers **302** to `releases/latest/download/<name>`, so the click downloads the `.exe` and no GitHub page is shown;
   - answers **302 to the releases page** (the old link) when GitHub is unreachable, answers with an error, or the file has no readable name.
2. **Caching:** the installer name is kept in the server's memory for **one minute**. The redirect itself is sent with `Cache-Control: no-store`, so no browser or CDN keeps it. A failed read is not remembered, so the next click asks GitHub again.
3. `/download/windows` is in `PUBLIC_PAGE_PATHS` (`proxy.ts`), so a signed-out visitor gets the file, not the sign-in page. Only that exact path is public. The route reads nothing from the account and spends nothing.
4. `DESKTOP_DOWNLOAD_URL` is `/download/windows`. The sign-in page's "Get the desktop app", the sidebar card's "Download for Windows" and the hand-off page's button open it **in the same tab** (no `target="_blank"`): the download starts and the page stays, with no empty tab left behind. The user guide links to `https://call.paramountintelligence.co/download/windows`. The /help page still opens links in a new window, because in the desktop app that is the system browser (the app blocks the redirect to GitHub in its own window).
5. The hand-off page and both guides say: "Run the installer once. After that, open Paramount AI from the Start menu or the Desktop icon. You can delete the downloaded file."
6. **Windows only.** A Mac download (`/download/mac`) can follow on the Mac branch. `latest.yml` is the Windows file; the Mac updater reads `latest-mac.yml`.

**Desktop 1.7.4 (only with a new Windows build):**

7. `createDesktopShortcut: true` in `electron-builder.yml`. A fresh install creates a "Paramount AI" Desktop icon.
8. `build/installer.nsh` recreates a missing Desktop shortcut at every install and update, the same way as the Start Menu shortcut (ADR-0069). electron-builder's update path keeps an existing shortcut but never adds one. Without this, nobody updating from 1.7.3 or earlier (which had no Desktop icon) would get one. The check respects electron-builder's `--no-desktop-shortcut` switch.
9. The versioned `artifactName` is unchanged (the updater and `latest.yml` rely on it).

## Consequences

- One click downloads the installer from every download link, signed in or not.
- **For up to one minute after a release**, a server instance that read the old name still redirects to `releases/latest/download/<old name>`. That answers 404, because the newest release has only the new installer. The one-minute cache keeps this window short. A click after it works.
- Each server instance reads `latest.yml` from GitHub at most once a minute, plus once per click while GitHub is failing.
- A person who deletes the Desktop icon on purpose gets it back at the next update, as with the Start Menu shortcut.
- The Desktop icon arrives only with an installed or auto-updated 1.7.4. The web changes go live with a Vercel deploy and need no desktop release.
- The route depends on electron-builder's `latest.yml` keeping a top-level `path:` line. If that changes, every click falls back to the releases page (the old behaviour), and nothing breaks.

## Alternatives considered

- **Link to the release's own tag** (`releases/download/v<version>/<name>`, using `version:` from `latest.yml`). That address never stops working, so a stale cache would serve the previous installer instead of a 404. Rejected for now: it relies on the tag-naming convention (`v` + version), and the one-minute cache makes the 404 window small. Can be revisited if the window is ever seen.
- **An unversioned installer name** (`Paramount-AI-Setup.exe`), so `releases/latest/download/<name>` works with no route. Rejected: the updater and `latest.yml` rely on the versioned name.
- **CDN caching of the redirect** (`s-maxage`). Rejected: a second cache layer makes the stale window longer and harder to reason about. The in-memory minute is enough for a small team.
- **`createDesktopShortcut: always`** (electron-builder's own recreate option). Rejected: it recreates the icon only when the installer is run by hand, not on the updater's silent update, which is how most people get new versions.

## Validation

- Unit tests (`tests/unit/server/desktopDownload.test.ts`): reading the name (plain, quoted, Windows line ends, the indented file list ignored, unsafe names refused); the redirect to the installer; the one-minute reuse; the fallback to the releases page when GitHub is unreachable, answers 404, or sends no readable name; no failure remembered. `tests/unit/proxy.test.ts`: `/download/windows` opens signed out; `/download` and `/download/mac` still need sign-in.
- Browser specs: `tests/integration/handoff.spec.ts` and `shell.spec.ts` check the links' address, that they open in the same tab, and the hand-off page's wording. `tests/e2e-prod/domain.spec.ts` checks the guide's link on production after the deploy.
- The 1.7.4 installer builds (NSIS compiles with the new shortcut check; local build, 23 Nov 2026).
- `install-check` (Actions, run by hand before the release) expects one "Paramount AI" Desktop icon pointing at the app after every scenario, plus scenario L: the published 1.7.3 (no icon) updated to 1.7.4 by the updater, then 1.7.4 run by hand with the icon deleted.
- After the deploy: open `/download/windows` signed out and check that the `.exe` downloads with no GitHub page.

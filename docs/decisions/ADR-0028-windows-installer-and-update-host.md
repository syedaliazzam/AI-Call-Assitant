# ADR-0028: Windows installer and update host

- **Status:** Accepted (developer, 2026-11-02). Two parts are decisions for the lead (below).
- **Date:** 2026-11-02
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §10 (hosting, domain and installation)
- **Supersedes / superseded by:** none

## Context

The Kite desktop app needs an installer for the team's Windows laptops, and a way to receive updates without anyone reinstalling by hand. Constraints:
- the code repository is private, so installed apps cannot read its GitHub Releases without a token;
- a token inside the app would leak to anyone who has the installer;
- no paid service, certificate, DNS or Vercel plan change without the lead.

## Decision

**Installer:** electron-builder 26.17.0 with NSIS:
- a one-click install for the current Windows user, so no administrator rights are needed;
- installs to `%LOCALAPPDATA%\Programs\kite`, with a Start-menu shortcut "Kite";
- publisher "Paramount Intelligence", with the company icons.

**Uninstall:**
- It asks "Keep your Kite data on this computer?". **No**, and any silent uninstall, removes `%APPDATA%\kite`.
- It never touches the data while an update replaces the old version.

**Update host:** a public, releases-only GitHub repository, [Zainpak123/kite-releases](https://github.com/Zainpak123/kite-releases).
- It holds only installers, `latest.yml` and blockmaps, plus a README. There is no source code.
- The developer publishes with `gh`, using their own login. The app has no token.

**Updater:** electron-updater 6.8.10 (`apps/desktop/src/updater.ts`):
- checks on start and every 6 hours, and downloads in the background;
- asks "Restart now / Later"; with Later, the update installs when Kite quits;
- never asks while a call is live: the page reports this through `window.kiteDesktop.setCallActive()`.

## Decisions for the lead

1. **Move the releases repository to a company GitHub organisation.**
   - There is no organisation yet, so it is under the developer's account for now.
   - Moving it means changing `publish.owner` in `apps/desktop/electron-builder.yml` and releasing once from the old place, so installed apps learn the new address.
2. **Code-signing certificate: code signing is likely required (Smart App Control).**
   - On the developer's Windows 11 laptop, Smart App Control is on. It blocked an unsigned Kite build from starting (Code Integrity events 3033 and 3077: "did not meet the Enterprise signing level requirements"; 2 Nov). It also blocked one form of the build itself.
   - Unlike SmartScreen, a Smart App Control block has no "Run anyway". Freshly set-up Windows 11 PCs start it in evaluation mode, and Windows may then turn it on.
   - The Day 7 final test plan starts by installing on a teammate's laptop to see how common this is.
   - **No-purchase alternative: the Microsoft Store, private audience** (`docs/deploy/microsoft-store.md`).
     - The Store signs the package with Microsoft's certificate, which Smart App Control trusts, and company developer accounts are free since May 2026.
     - Kite's Store package builds, installs and runs. Screen-share protection worked inside it on CI (2 Nov).
     - Costs: each update goes through certification (up to three business days), and the Store version updates itself through the Store.
   - Without one, Windows SmartScreen shows "Windows protected your PC" on first run. Users click More info → Run anyway, as the user guide says (`docs/user-guide/install-windows.md`).
   - An OV or EV code-signing certificate removes or reduces the warning; an EV certificate is trusted immediately. Prices vary by vendor.
   - Nothing was bought.

## Consequences

- **Installers are public.** Anyone with the link can download them. They contain the Kite web address and no secrets, and are useless without an account from an administrator.
- **Each release is about 115 MB.** Updates download only the changed blocks (blockmap).
- **Until a certificate is bought, first-time installs show the SmartScreen warning.**

## Alternatives considered

- **Vercel Blob:** needs Vercel Pro for commercial use, plus a custom publish step.
- **Cloudflare R2 or Amazon S3:** a new paid account and keys to manage.
- **Serving updates from the web app behind sign-in:** the most work, and Vercel limits large files.
- **The private repository with a token in the app:** rejected, because the token would leak.

## Validation

- `docs/testing/benchmark-results.md`, Day 6 Stage 3:
  - build, silent install, smoke test against the installed app (14/14), clean uninstall;
  - the update from 1.0.0-beta.1 to 1.0.0-beta.2 through the releases repository.
- Human checks in `docs/testing/final-test-plan.md` §9.

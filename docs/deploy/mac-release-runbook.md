# Mac release runbook: Paramount AI 1.8.0 for Mac, and main to production

**For:** the developer, on 26 Nov 2026, after the real-Mac release test (`docs/testing/mac-release-test.md`) has passed on the final commit of `mac-internal-release`.

**Machines and people:**
- **The build Mac:** the teammate's MacBook with the signing keychain (`docs/deploy/mac-signing-certificate.md` Part C).
- **The Windows laptop:** the developer's. It has `gh` signed in as the releases owner and the Vercel CLI linked to `kite-call-assistant`.

**Rules:** do the steps in order. Stop at the first ❌ and use the rollback section. No secret is ever printed or pasted.

> **Status on 25 Nov 2026: section (b) is done; the web app is in production before the Mac app.**
> - `mac-internal-release` (code @ `d51786c`: the Mac work, bug-fix batch 1, WP3 = ADR-0122 to ADR-0124, and the Mac-download switch ADR-0125) was merged into `main` @ `4b980c0` and deployed to production: https://kite-call-assistant-bj7xmwyz8-paramount-intelligence.vercel.app, aliased to `call.paramountintelligence.co`.
> - **The Mac download switches on by itself** (ADR-0125). Until `mac-latest` has its `latest-mac.yml`, every "Get it for Mac" box says **Mac version coming soon** (no command, no .dmg) and `install-mac.sh` says the same and installs nothing. Publishing 1.8.0 with `publish-mac.mjs` in (a) turns the download on within a minute: no deploy, no setting.
> - **Tonight's Mac test runs against production** (`docs/testing/mac-release-test.md`: no `--kite-url`, no preview). After it passes, do (a), then (c). Skip (b) (done) except its checks, which you may repeat.
> - **The previous production deployment** (`main` @ `4aba5b5`, for a rollback): https://kite-call-assistant-1xpy0tbkc-paramount-intelligence.vercel.app.

**Decisions** (ADR-0109, ADR-0118, ADR-0119, ADR-0120, ADR-0110 amendment; ADR-0121 bug-fix batch 1, folded in on 25 Nov 2026):
- **WP3 (ADR-0122 to ADR-0124) and ADR-0125 changed no prompt text either.** Your own spoken questions go as mode `chat`, the request a typed question already made. The two screenshot groups the 4,000-token limit touches were run on 25 Nov 2026 on `d51786c`: `--only=screen-only` **9.14** (gate ≥ 8; hidden line 14/14, never empty 14/14, all private 14/14, code ran 4/4) and `--only=screenshot-types` **9.36** (gate ≥ 8; code ran 4/4), 56 requests, $0.10.
- **No prompt text changed, so no full eval.** The Mac work changed no answer prompt or answer code. Batch 1 (ADR-0121) changed no prompt text; it changed the notes' reading of a cut-off reply (`eval:notes` 9.78 before and after) and the screenshot answers' output limit (1,500 → 4,000 tokens; measured complete on a long coding problem). The eval groups that limit touches, `--only=screen-only` and `--only=screenshot-types`, have not been run: running them before (b) is the developer's choice (get the request count with `--dry-run` first).
- **No Windows desktop release.** Every desktop change is Mac-only, and the web changes reach Windows by the web deploy.

---

## 0. Before you start (5 min)

1. The release test's tables are all ✅, on the commit you are about to release. Write that commit down; this runbook calls it `<release commit>`.
2. On the Windows laptop, check that `mac-internal-release` on GitHub is at `<release commit>`:

   ```
   git -C "D:\Paramount Intelligence\AI Call Assistant\aica-mac" fetch
   git -C "D:\Paramount Intelligence\AI Call Assistant\aica-mac" log --oneline -1 origin/mac-internal-release
   ```

3. Check that GitHub has no `mac-latest` release yet. If it does, check it is the pre-release this runbook made.

   ```
   & "C:\Program Files\GitHub CLI\gh.exe" release view mac-latest --repo Zainpak123/kite-releases
   ```

## (a) Build and publish the Mac 1.8.0 release

**Order:**
1. Since 25 Nov 2026 the web app is live **before** the Mac release, safely: until `mac-latest` is published the site and `install-mac.sh` say "Mac version coming soon" (ADR-0125). Publishing is what turns the Mac download on.
2. Inside the release, the zip and blockmap go up first and `latest-mac.yml` last. The script does this, so an app checking for updates never sees a version whose zip is missing.

**On the build Mac (teammate), about 30 min:**

1. Get the release commit:

   ```
   cd ~/AI-Call-Assitant
   git fetch && git checkout mac-internal-release && git pull
   git log --oneline -1
   ```

   The last line must start with `<release commit>`.
2. Build version 1.8.0 (no `--version`: it takes 1.8.0 from `apps/desktop/package.json`):

   ```
   bash apps/desktop/scripts/mac/build.sh
   ```

   macOS asks for the signing keychain's password (from the password manager).
3. **Expected:** every line PASS, **ALL CHECKS PASSED**, version **1.8.0**. At the end it lists four files with their SHA-256:
   - `latest-mac.yml`;
   - `Paramount-AI-1.8.0-universal-mac.zip`;
   - `Paramount-AI-1.8.0-universal-mac.zip.blockmap`;
   - `Paramount-AI-1.8.0-universal.dmg`.

   Copy that list into the chat with the developer.
4. Send the four files from `apps/desktop/release/` to the developer, in a private Drive folder or by AirDrop to a Mac and then a USB stick. They are signed app files, not secrets.

**On the Windows laptop (developer), about 10 min:**

5. Put the four files in an empty folder, for example `C:\paramount-mac-1.8.0`. Check that each file's SHA-256 matches the teammate's list:

   ```
   Get-FileHash C:\paramount-mac-1.8.0\* -Algorithm SHA256 | Format-Table Hash, Path
   ```

6. Dry run, which changes nothing:

   ```
   cd "D:\Paramount Intelligence\AI Call Assistant\aica-mac"
   node apps/desktop/scripts/mac/publish-mac.mjs C:\paramount-mac-1.8.0 --dry-run
   ```

   **Expected:** it finds the zip named in `latest-mac.yml`, the SHA-512 matches, and it lists what it would upload.
7. Publish:

   ```
   node apps/desktop/scripts/mac/publish-mac.mjs C:\paramount-mac-1.8.0
   ```

   It does four things:
   1. creates `mac-latest` as a **pre-release** if it is missing;
   2. uploads the zip, the blockmap and the dmg;
   3. uploads `latest-mac.yml` **last**;
   4. removes older files and sets the notes to "Paramount AI 1.8.0 for Mac".
8. Check:
   - `https://github.com/Zainpak123/kite-releases/releases/tag/mac-latest` shows the four files and is marked **Pre-release**. **Never untick Pre-release**: Windows apps would then look for their update there.
   - `https://github.com/Zainpak123/kite-releases/releases/download/mac-latest/latest-mac.yml` shows `version: 1.8.0`.
   - The Windows "latest" release is still 1.7.4, so Windows apps are unaffected.

## (b) Merge `mac-internal-release` into `main` and deploy production (done on 25 Nov 2026)

**Done:** `main` @ `4b980c0`, https://kite-call-assistant-bj7xmwyz8-paramount-intelligence.vercel.app. The steps below are how it was done; repeat only the checks in 6 to 8 if you want to.

`main` is checked out in the worktree `D:\Paramount Intelligence\AI Call Assistant\AI-Call-Assitant-hidden-line`. Merge there; your primary checkout cannot switch to `main` while that worktree holds it.

1. **Merge locally.** GitHub's merge commits are blocked by Vercel (memory: merge locally):

   ```
   cd "D:\Paramount Intelligence\AI Call Assistant\AI-Call-Assitant-hidden-line"
   git status --short
   git pull --ff-only
   git merge --no-ff origin/mac-internal-release -m "Merge branch 'mac-internal-release' into main: Paramount AI for Mac 1.8.0 (ADR-0109 to ADR-0111, ADR-0118 to ADR-0121)"
   ```

   `git status --short` must print nothing before the merge.
2. **Checks** (CI is not running; run them here):

   ```
   pnpm install --frozen-lockfile
   pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
   pnpm --filter @kite/web test:live-ui
   pnpm --filter @kite/web test:launcher
   ```

   Also run `pnpm --filter @kite/web test:sim-calls`, `test:answers` and `test:review`: all pass since ADR-0121 (the two `sim-calls` tests that failed on `main` @ `4aba5b5` were brought up to date, and so was the answers test that still used bar 1's removed Transcript switch). Known, not from this release: `test:screenshot`'s shared-tab frame test fails about 3 runs in 5 in headless Chromium (the tab sometimes sends no frame and the frame source waits without a limit; ADR-0121 report). A ❌ there alone does not stop the release.
3. **Production build check.** Copy `.env.local` in for the build only, then delete it:

   ```
   Copy-Item "..\AI-Call-Assitant\apps\web\.env.local" "apps\web\.env.local"
   pnpm --filter @kite/web build
   Remove-Item "apps\web\.env.local"
   ```

   If the build stops once with `SecurityFatalError`, run it again (memory: Next build nudge).
4. **Push:** `git push origin main`.
5. **Deploy production** from this worktree. Copy the Vercel link in, then remove it:

   ```
   Copy-Item -Recurse "..\AI-Call-Assitant\.vercel" ".vercel"
   vercel deploy --prod --yes
   Remove-Item -Recurse ".vercel"
   ```

   Wait for **Ready**. `vercel ls --prod` shows it on top. Before going on, check that `vercel inspect` of the new URL lists the production aliases (`call.paramountintelligence.co`). If it doesn't, someone ran a rollback earlier and new deploys do not go live by themselves; run `vercel promote <new URL>`.
6. **Smoke checks**, signed out:

   ```
   curl.exe -fsSL https://call.paramountintelligence.co/install-mac.sh | Select-Object -First 3
   curl.exe -sI https://call.paramountintelligence.co/download/windows
   ```

   - The first must print the script's first lines (`#!/bin/bash`…), not HTML.
   - ADR-0125: `curl.exe -s https://call.paramountintelligence.co/api/mac-release` prints `{"published":false}` before (a), and `{"published":true}` within a minute after it.
   - The second must be a 302 to `…/releases/latest/download/Paramount-AI-Setup-1.7.4.exe`.
7. **Production end-to-end suites.** Manual, never CI. They use the e2e test account, and the desktop ones build the shell locally.
   - **Free (no Claude requests), run all:**

     ```
     pnpm --filter web test:e2e-prod domain.spec.ts desktop-link.spec.ts launcher.spec.ts sync-api.spec.ts sync-devices.spec.ts legacy-upload.spec.ts
     ```

   - **Paid, optional:** `desktop.spec.ts` runs the real desktop overlay on production. It makes 2 answers on the fast model, well under $0.01, and it opens windows. Agree before running it.
   - **Not needed for this release:** `chrome.spec.ts`, `auth-cache.spec.ts`, `routes.spec.ts`, `mock.spec.ts`, `latency.spec.ts`, `voice-latency.spec.ts`. They are paid and only test the answer pipeline, which did not change.
8. **On Windows,** in the desktop app 1.7.4 (it loads the new site), check:
   - bar 2 shows the chips;
   - ⤢ opens the transcript under it;
   - transcript and answer sit side by side at your usual size;
   - Private off shows "Private is off: the overlay shows in screen shares · Turn on";
   - (ADR-0121) the model chip and ⋮ › Model list no Groq; Ctrl+Shift+Enter on a long coding problem gives the whole code with no "Answer cut off" line; Ctrl+Alt+Enter with a question spoken in two parts gives one answer; a call's notes are written as before.

## (c) Install on the Mac from the live site, and check hand-off and sync

On the build Mac (and on each team Mac, at any time after (b)):

1. Quit Paramount AI (⌘Q) if it runs. It is the 1.7.99 test build from last night.
2. In Terminal:

   ```
   curl -fsSL https://call.paramountintelligence.co/install-mac.sh | bash
   ```

   **Expected:** **Checksum OK**, **Signature OK (Paramount Intelligence)**, **Installed Paramount AI 1.8.0**, and the app opens with no Gatekeeper message.
3. Paramount AI menu › About: **1.8.0**. No permission question: same certificate as the test build.
4. **It opens the live site:** sign in normally (no `--kite-url` any more).
5. **"Open in desktop app":** in Chrome on the same Mac, sign in at `call.paramountintelligence.co`, open a session and click **Open in desktop app**. **Expected:**
   - macOS asks once to open Paramount AI;
   - the app opens on that session, already signed in (one-time code, ADR-0052).
6. **Sync:** in Chrome, create a new session with an invented name. **Expected:** within a minute it appears in the desktop app's home panel. Delete it from either side; it disappears from the other.
7. **A short call:** Connect, play a video, ⌘↵ for one answer, End. The notes are written.

## (d) Clean-up

1. **Preview settings** (Vercel dashboard, project `kite-call-assistant`):
   - Settings › Environment Variables › `KITE_DATA_KEY_V1` › Edit › **untick Preview**, keep Production. **Do not delete the variable.**
   - Settings › Deployment Protection › turn **Vercel Authentication** back on (Standard Protection).
   - Optional: remove the Preview-only `DEEPGRAM_API_KEY` entry if previews should not spend Deepgram.

   Check with `vercel env ls`: `KITE_DATA_KEY_V1` shows **Production** only.
2. **Worktrees.** These branches are fully merged and can go:
   - `overlay-answer-width`, `default-length-balanced`, `doc-context-latency`, `doc-limits-10mb-500k`;
   - `overlay-width-question-label`, `summary-plain-text`, `overlay-toolbar-labels`, `windows-download-shortcut`;
   - and `hidden-line`, once `main` is pushed.

   Keep these: `summary-at-attach` (timing marks), `length-answer-samples` (docs), `v6-on-guard` (parked). For each one to remove (`node_modules` paths are too long for `git worktree remove`):

   ```
   Remove-Item -LiteralPath '\\?\D:\Paramount Intelligence\AI Call Assistant\AI-Call-Assitant-<name>' -Recurse -Force
   git -C "D:\Paramount Intelligence\AI Call Assistant\AI-Call-Assitant" worktree prune
   ```

3. **The `aica-mac` clone:** nothing in it is unpushed after (b). Delete it the same way:

   ```
   Remove-Item -LiteralPath '\\?\D:\Paramount Intelligence\AI Call Assistant\aica-mac' -Recurse -Force
   ```

4. **Your Windows checkout back on `main`** (after the `hidden-line` worktree is removed, which frees `main`):

   ```
   cd "D:\Paramount Intelligence\AI Call Assistant\AI-Call-Assitant"
   git fetch
   git switch main
   git pull --ff-only
   ```

   Your uncommitted `docs/README.md` and `docs/learning/` come along unchanged: `docs/README.md` is the same on both branches. Commit them, or keep them local; never with `git commit -a`.

## (e) Rollback

| What broke | Do this |
|---|---|
| **The web app** (any user) | 0. Tonight's previous production deployment is https://kite-call-assistant-1xpy0tbkc-paramount-intelligence.vercel.app (`main` @ `4aba5b5`): from a folder linked to `kite-call-assistant` run `vercel rollback https://kite-call-assistant-1xpy0tbkc-paramount-intelligence.vercel.app --yes` (about 10 s; `vercel inspect` then shows `call.paramountintelligence.co` on it). 1. In general: `vercel ls --prod`, then `vercel rollback <previous production URL>`: everyone is on the old site within a minute. 2. Fix forward on a branch. 3. Before the next deploy, `git revert -m 1 <merge commit>` on `main` if the merge itself is the problem, so it is not deployed again. After a rollback, new deploys need `vercel promote`. |
| **The Mac app 1.8.0** (Mac users only) | Stop it spreading: on the `mac-latest` release, delete **only** `latest-mac.yml` (apps then find no update; ADR-0125: the site's Mac box goes back to "Mac version coming soon" within ten minutes and `install-mac.sh` at once). Macs that already have 1.8.0 keep it, because the updater never goes back a version. Fix forward: build **1.8.1** with the fix (or the old code), publish it, and every Mac updates. A Mac that must change at once: run the install command again after publishing. |
| **Windows** | Nothing to roll back: no Windows release in this runbook. The web rollback covers Windows users. |
| **The installer page** (`install-mac.sh`) | It comes with the web deploy: the web rollback takes it back. |

---

## How future updates reach Mac and Windows (plain language)

**Two kinds of change:**
- **Website changes** reach everyone by a web deploy alone: screens, wording, the overlay's layout, settings, answers and prompts, server routes. Both desktop apps show the live website inside their windows, so a user sees the change the next time a window loads (or after quitting and reopening).
- **Desktop app changes** need a new app version: the window's behaviour, menus, global keys, the installer, the updater, recording files on disk, new abilities given to the page. Windows and Mac are built separately.

**Who builds what:**
- **Windows:** the developer builds on the Windows laptop and publishes a normal GitHub release in `Zainpak123/kite-releases`.
- **Mac:**
  1. The teammate with the build Mac runs `bash apps/desktop/scripts/mac/build.sh` on the release commit. It needs the company certificate in that Mac's signing keychain, and the keychain password from the password manager.
  2. The files go to the developer.
  3. The developer runs `publish-mac.mjs`, which updates the `mac-latest` pre-release.

**How auto-update works:**
- Each desktop app checks its channel when it starts and every 6 hours: Windows the latest release, Mac `mac-latest`.
- A newer version downloads in the background. The app then asks "Restart now / Later", but never during a call or while recordings are still uploading. "Later" installs it at the next quit.
- **On a Mac, macOS accepts the update only if it is signed with the same company certificate.** That is also why permissions survive updates.
- If the certificate is ever lost or replaced, every Mac must reinstall with the Terminal command and allow the permissions again.

**How to confirm an update landed:**
- **Mac:** Paramount AI menu › About shows the full version.
- **Windows:** Settings › Apps › Installed apps › Paramount AI shows the version.
- **Both:** the sidebar shows "Desktop app vX.Y" (the patch number is not shown there).
- **The release side:** open `…/releases/download/mac-latest/latest-mac.yml`, or the latest Windows release's `latest.yml`, and read its `version:` line.
- **The website:** `vercel ls --prod` shows which deployment is live and when.

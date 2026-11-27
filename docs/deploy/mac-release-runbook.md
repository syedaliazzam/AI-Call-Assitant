# Mac release runbook: Paramount AI 1.8.0 for Mac, and main to production

**For:** the developer, on 26 Nov 2026, after the real-Mac release test (`docs/testing/mac-release-test.md`) has passed on the final commit of `mac-internal-release`.

**Machines and people:**
- **The build Mac:** the teammate's MacBook with the signing keychain (`docs/deploy/mac-signing-certificate.md` Part C).
- **The Windows laptop:** the developer's. It has `gh` signed in as the releases owner and the Vercel CLI linked to `kite-call-assistant`.

**Rules:** do the steps in order. Stop at the first ❌ and use the rollback section. No secret is ever printed or pasted.

> **Status on 26 Nov 2026: the overlay fixes are in production; build the Mac app from `3b05780`.**
> - `overlay-clickthrough-glass` was merged into `main` @ `3b05780` and deployed to production: https://kite-call-assistant-gbm7l3b1a-paramount-intelligence.vercel.app, aliased to `call.paramountintelligence.co`. **Fix 1** (ADR-0055 amended 26 Nov 2026): with Click-through on, the whole overlay passes every click to the app behind; only Ctrl+Alt+X (⌘ ⌥ X) turns it off; bar 1's hint, the call window's **Turn click-through off**, the auto-off at the call's end and the Settings warning are the safety nets. Web only: Windows 1.7.4 gets it from the web deploy. **Fix 2** (ADR-0126, commit `0f96afe`, Mac shell only): the Mac overlay is plainly see-through (no vibrancy).
> - **`<release commit>` for (a) must contain `0f96afe`** (`git merge-base --is-ancestor 0f96afe <release commit>`). `mac-internal-release` was fast-forwarded to `main` on 26 Nov 2026, so its head has it.
> - **Previous production deployment** (the WP3 release, `main` @ `4b980c0`, for a rollback): https://kite-call-assistant-bj7xmwyz8-paramount-intelligence.vercel.app.
> - **For the next Windows desktop release** (not published tonight): the tray's **Turn click-through off** during a call (`tray.ts`, ADR-0055 amendment). Nothing else in the shell changed for Windows (`overlayGlass('win32')` is unchanged).
>
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
8. **On Windows after the 26 Nov 2026 deploy,** quit the desktop app 1.7.4 (tray › Quit) and open it normally, then in a call:
   - click **W**: bar 1 shows **Click-through on — press Ctrl+Alt+X to turn off**; Chat, AA, the model chip and W are gone; no tooltips over the bars;
   - click on bar 1, on W's spot, on bar 2 and on the answer panel over a window behind (a browser tab's button): each click reaches that window;
   - with that window in front, **Ctrl+Alt+X** turns it off; the bars take clicks again (Chat opens the chat bar);
   - ⋮ › Call window, then **Ctrl+Alt+X**: the call window shows the amber line with **Turn click-through off**; it works;
   - with it on (in the call window, after Ctrl+Alt+X), click **End** there without turning it off: the call ends, and the next call starts with W off;
   - Settings › Hotkeys: Click-through **Ctrl+Alt+X**, Any app, no clash;
   - the overlay looks as before (see-through at 40 %; nothing changed for Windows).
9. **On Windows,** in the desktop app 1.7.4 (it loads the new site), check:
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
| **The web app** (any user) | 0. Since 26 Nov 2026 the previous production deployment is the WP3 release, https://kite-call-assistant-bj7xmwyz8-paramount-intelligence.vercel.app (`main` @ `4b980c0`): from a folder linked to `kite-call-assistant` run `vercel rollback https://kite-call-assistant-bj7xmwyz8-paramount-intelligence.vercel.app --yes` (it brings back bars that keep their clicks in Click-through mode; nothing else changes). Before that (25 Nov) it was https://kite-call-assistant-1xpy0tbkc-paramount-intelligence.vercel.app (`main` @ `4aba5b5`): `vercel rollback https://kite-call-assistant-1xpy0tbkc-paramount-intelligence.vercel.app --yes` (about 10 s; `vercel inspect` then shows `call.paramountintelligence.co` on it). 1. In general: `vercel ls --prod`, then `vercel rollback <previous production URL>`: everyone is on the old site within a minute. 2. Fix forward on a branch. 3. Before the next deploy, `git revert -m 1 <merge commit>` on `main` if the merge itself is the problem, so it is not deployed again. After a rollback, new deploys need `vercel promote`. |
| **The Mac app 1.8.0** (Mac users only) | Stop it spreading: on the `mac-latest` release, delete **only** `latest-mac.yml` (apps then find no update; ADR-0125: the site's Mac box goes back to "Mac version coming soon" within ten minutes and `install-mac.sh` at once). Macs that already have 1.8.0 keep it, because the updater never goes back a version. Fix forward: build **1.8.1** with the fix (or the old code), publish it, and every Mac updates. A Mac that must change at once: run the install command again after publishing. |
| **Windows** | Nothing to roll back: no Windows release in this runbook. The web rollback covers Windows users. |
| **The installer page** (`install-mac.sh`) | It comes with the web deploy: the web rollback takes it back. |

---

## How updates reach Mac and Windows (plain language)

Both desktop apps are a thin window around the live website (`call.paramountintelligence.co`). Almost every change is a change to the website.

**1. Website changes: a web deploy, then quit and reopen the app.** No desktop release, no build on a Mac.
- What counts: every screen and its wording; the overlay's layout (bars, panels, their sizes and alignment); which keys answer what *inside the page* (for example who Ctrl+Enter answers); settings; answers, prompts and models; server routes; the `install-mac.sh` installer page; the Mac download box.
- Also anything that uses an ability the installed app already gives the page through `window.kiteDesktop` (`apps/desktop/src/preload.ts`): for example resizing or moving the overlay window (`resizeOverlay`, `setOverlayLayout`), Click-through, opening windows. A new use of an existing ability is still a website change.
- When users get it: the next time a window loads the page. **Quitting and reopening the app** (Mac: ⌘Q; Windows: tray › Quit) is the sure way. A call that is already running keeps the page it started with until it ends.

**2. Desktop app changes: a new app version** (Windows and Mac built separately).
- A new ability for the page (a new `window.kiteDesktop` method or a new field the shell accepts; the preload passes only the fields it knows, so a new one is dropped by older apps).
- Window behaviour decided by the shell (`apps/desktop/src/windows.ts`: default size, position presets, how it is kept on screen, see-through on a Mac).
- Global keys that work while another app has focus (`apps/desktop/src/hotkeys.ts`).
- Menus and the tray (`apps/desktop/src/macMenu.ts`, `tray.ts`).
- macOS permission texts and the app's identity (`apps/desktop/electron-builder.yml` `extendInfo`, `appId`, signing).
- The bundled speech engine and model (`native/sherpa-onnx`, `native/stt-model`), recordings on disk, Drive uploads, the updater itself, the installer.

**Check for Updates…:** from Mac 1.8.1 and Windows 1.7.5 (ADR-0127), the Mac app's **Paramount AI** menu and the Windows tray menu have **Check for Updates…**: it checks at once and says "You're up to date", or downloads and asks Restart now / Later (never during a call). On Mac 1.8.0 and Windows 1.7.4, quitting and reopening the app makes it check at once. The 1.8.1 / 1.7.5 release steps and the first-update test plan are in `docs/deploy/desktop-1.8.1-1.7.5-release.md`.

**How auto-update works** (`apps/desktop/src/updater.ts`, both systems):
- The installed app checks its channel when it starts and every 6 hours: Windows the newest release of `Zainpak123/kite-releases`, Mac the `mac-latest` pre-release.
- A newer version downloads in the background by itself.
- Then the app asks **Restart now / Later**, but **never during a call** (the page tells the app when a call is live) and never while Drive uploads are left; the question waits until the call ends or the uploads finish.
- **Later** installs it the next time the app quits.
- **On a Mac, macOS accepts the update only if it is signed with the same company certificate.** That is also why permissions survive updates. If the certificate is ever lost or replaced, every Mac must reinstall with the Terminal command and allow the permissions again.

**Who builds what:**
- **Windows:** the developer builds on the Windows laptop and publishes a normal GitHub release in `Zainpak123/kite-releases`.
- **Mac, once its first dry run has passed: the cloud build** below (GitHub Actions on a macOS runner; nobody builds on a Mac). Until then it is untested. It signs with the same company certificate and runs the same `build.sh` and `verify-build.sh`.
- **Mac, the old way (still works):** the teammate with the build Mac runs `bash apps/desktop/scripts/mac/build.sh`, sends the four files, and the developer runs `publish-mac.mjs` (section (a)).

**How to confirm an update landed:**
- **Mac:** Paramount AI menu › About shows the full version.
- **Windows:** Settings › Apps › Installed apps › Paramount AI shows the version.
- **Both:** the sidebar shows "Desktop app vX.Y" (the patch number is not shown there).
- **The release side:** open `…/releases/download/mac-latest/latest-mac.yml`, or the latest Windows release's `latest.yml`, and read its `version:` line.
- **The website:** `vercel ls --prod` shows which deployment is live and when.

---

## Cloud build (GitHub Actions): a Mac release without a Mac

The workflow `.github/workflows/mac-build.yml` builds, signs and checks the Mac app on a GitHub macOS runner. It only ever starts when someone starts it by hand.

**What one run does:**
1. Checks out the branch you chose and installs the tools (Node 24, pnpm).
2. Puts the company certificate into a **temporary keychain** on the runner. It refuses any certificate that is not the committed `apps/desktop/build/mac-signing/certificate.pem`, exactly as `import-signing-cert.sh` does.
3. Runs `build.sh`, which also runs `verify-build.sh`. Every line must say PASS.
4. Then one of two things:
   - **Dry run (the default):** keeps the four files (`latest-mac.yml`, the zip, its blockmap, the dmg) on the run's page under **Artifacts** for 7 days. Nothing is published.
   - **Publish (only with the "publish" box ticked):** runs `publish-mac.mjs`, which updates `mac-latest`. Macs then update to it. It refuses unless the branch is `main` or `mac-internal-release` and the version is newer than the one published now.
5. Always deletes the temporary keychain and the certificate copy, even if a step failed.

### One-time set-up: three repository secrets

Add them yourself in GitHub. **Never paste them into a chat, a file in the repository, or an issue.**

Where: https://github.com/syedaliazzam/AI-Call-Assitant › **Settings** › **Secrets and variables** › **Actions** › **New repository secret**. Use exactly these names:

| Secret | What it holds | How to make the value |
|---|---|---|
| `MAC_SIGNING_P12_BASE64` | The company's signing certificate with its key (`paramount-signing.p12`, the master copy in the password manager), as text. | Download the .p12 from the password manager. **On a Mac:** `base64 -i ~/Downloads/paramount-signing.p12 \| pbcopy` puts it on the clipboard. **On Windows (PowerShell):** `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\paramount-signing.p12")) \| Set-Clipboard`. Paste it as the secret's value, then delete the downloaded .p12. |
| `MAC_SIGNING_P12_PASSWORD` | The .p12 file's password. | From the same password-manager entry ("Paramount AI Mac signing certificate (.p12)"). Type or paste it straight into GitHub. |
| `KITE_RELEASES_TOKEN` | A token that may publish releases in `Zainpak123/kite-releases`. Only the publish run needs it; a dry run works without it. | Signed in to GitHub as **Zainpak123** (the releases repository's owner): **Settings** › **Developer settings** › **Personal access tokens** › **Fine-grained tokens** › **Generate new token**. **Resource owner:** Zainpak123. **Repository access:** Only select repositories › `kite-releases`. **Permissions** › Repository permissions › **Contents: Read and write** (Metadata: Read-only is added by itself). **Expiration:** 90 days or the shortest you are comfortable with; renew it before a Mac release when it runs out. Copy it once into the secret, nowhere else. |

**It must be the same certificate as today.** The workflow checks this: a different .p12 stops the run with "is not the repository's certificate.pem". Signing with another certificate would make every Mac refuse the update and lose its permissions.

**The keychain password is not a secret you add.** The run makes a random one for its temporary keychain and never shows it.

### Run a dry run

- **On the website:** https://github.com/syedaliazzam/AI-Call-Assitant/actions › **mac-build** › **Run workflow**. Choose the branch (for a release: `mac-internal-release` or `main`). Leave **Publish** unticked. Click **Run workflow**.
- **Or from the Windows laptop:**

  ```
  & "C:\Program Files\GitHub CLI\gh.exe" workflow run mac-build.yml -R syedaliazzam/AI-Call-Assitant --ref mac-internal-release
  & "C:\Program Files\GitHub CLI\gh.exe" run list -R syedaliazzam/AI-Call-Assitant --workflow mac-build.yml --limit 1
  & "C:\Program Files\GitHub CLI\gh.exe" run watch <run id> -R syedaliazzam/AI-Call-Assitant --exit-status
  ```

  The workflow file must already be on the branch you name with `--ref`.

**Expected:** the step "Build and check" ends with **ALL CHECKS PASSED**. The run's summary lists the four files with their SHA-256.

**Get the files:** the run's page › **Artifacts** › `paramount-ai-mac-<version>`. Or:

```
& "C:\Program Files\GitHub CLI\gh.exe" run download <run id> -R syedaliazzam/AI-Call-Assitant -D C:\paramount-mac-<version>
```

Use them for the real-Mac test (`docs/testing/mac-release-test.md`): install the dmg or the zip on a Mac, as with a teammate's build.

### Publish (after the dry run and the real-Mac test pass)

1. Raise the version in `apps/desktop/package.json` (for example 1.8.1) on the release branch, if you have not. The run refuses a version that is not newer than the published one.
2. Run the workflow again on the same branch with **Publish** ticked. From the laptop:

   ```
   & "C:\Program Files\GitHub CLI\gh.exe" workflow run mac-build.yml -R syedaliazzam/AI-Call-Assitant --ref mac-internal-release -f publish=true
   ```

   It builds the same code again, runs every check again, and publishes this new build with `publish-mac.mjs`: zip, blockmap and dmg first, `latest-mac.yml` last.
3. Check as in section (a) step 8: `…/releases/download/mac-latest/latest-mac.yml` shows the new version, and the release is still marked **Pre-release**.

Macs pick it up at their next check (start, or every 6 hours) and ask to restart after the call.

### Cost and time

- **One build takes about 7.5 minutes** (measured 27 Nov 2026, first dry run, run 45894538595: 5.5 minutes for build.sh and verify-build.sh, the rest setting up, uploading the artifact and cleaning up). Most of it is installing both Mac CPUs' packages, downloading the speech model (about 204 MB) and building the universal app. Downloading the artifact (about 850 MB) afterwards can take longer than the build.
- **Free while the repository is public.** GitHub does not count standard runners' minutes for public repositories. On a private repository, macOS minutes count **10×**: about 75 minutes of the monthly allowance per build (7.5 × 10).
- **Billing note (27 Nov 2026):** this account's Actions jobs stopped starting in November ("recent account payments have failed or your spending limit needs to be increased"; free minutes are back on 1 Dec 2026). The block did not stop this public repository's jobs: the first dry run (27 Nov 2026) ran normally. If a run ever never starts, wait for 1 Dec 2026 or build on the Mac as before.

### If a cloud build fails

| What it says | What to do |
|---|---|
| "add the secrets MAC_SIGNING_P12_BASE64 and MAC_SIGNING_P12_PASSWORD" | Add them (above). |
| "is not the repository's certificate.pem" | The wrong .p12, or its text was cut when pasting. Make the value again from the password manager's .p12. |
| `security import` fails ("MAC verification failed") | The password does not match the .p12. Set `MAC_SIGNING_P12_PASSWORD` again. |
| A FAIL line from verify-build.sh | The build is not right; nothing was published. Read which check failed and fix it on the branch. |
| "publish only from main or mac-internal-release" / "is not newer than the published" | Run from the right branch, or raise the version. |
| Publish step: "HTTP 403" or "Resource not accessible" | `KITE_RELEASES_TOKEN` is missing, expired or lacks Contents: Read and write on `kite-releases`. |

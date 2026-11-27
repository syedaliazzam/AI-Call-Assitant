# Desktop release: Mac 1.8.1 and Windows 1.7.5

**For:** the developer, on the Windows laptop with `gh` signed in as the releases owner and the Vercel CLI linked to `kite-call-assistant`.

**Decisions:** ADR-0127. The Mac keys are in ADR-0110's amendment of 27 Nov 2026.

**Rules:**
- Do the steps in order.
- Stop at the first ❌ and use the rollback section.
- No secret is ever printed or pasted.
- Publishing either app is your decision: nothing below has been published.

## Where things stand (filled in by the release run, 27 Nov 2026)

- **Web:**
  - `main` @ `<MERGE>`, deployed to production: `<PROD URL>`, aliased to `call.paramountintelligence.co`.
  - Previous production deployment, for a rollback: `<PREV URL>` (`main` @ `c34dacb` + docs).
- **Windows 1.7.5** (built, not published):
  - Folder: `D:\Paramount Intelligence\AI Call Assistant\aica-mac\apps\desktop\release\`.
  - `Paramount-AI-Setup-1.7.5.exe`: SHA-256 `<EXE SHA>`.
  - Also `Paramount-AI-Setup-1.7.5.exe.blockmap` and `latest.yml` (version 1.7.5).
- **Mac 1.8.1** (dry run, not published):
  - Run: `<RUN URL>`, artifact `paramount-ai-mac-1.8.1`.
  - SHA-256 of the four files: see the run's summary (copied in the release report).
- **`mac-internal-release`:** fast-forwarded to `main`.

## 1. Publish Windows 1.7.5 (about 10 min)

1. **Local install check, before publishing** (optional; already run on 27 Nov 2026 if the report says PASS):
   - It runs a kept copy of 1.7.4 against a feed on this computer.
   - It opens that old app's window and installs nothing.

   ```
   & "C:\Program Files\GitHub CLI\gh.exe" release download v1.7.4 -R Zainpak123/kite-releases -p "Paramount-AI-Setup-1.7.4.exe" -D C:\paramount-1.7.4
   # extract with 7za to C:\paramount-1.7.4\app, copy the .exe to %LOCALAPPDATA%\kite-updater-check\installer.exe, then:
   node --experimental-strip-types apps/desktop/tests/update-check.ts "C:\paramount-1.7.4\app\Paramount AI.exe" "D:\Paramount Intelligence\AI Call Assistant\aica-mac\apps\desktop\release"
   ```

   **Expected:** PASS.
2. **Checksums file** (the same format as 1.7.4's):

   ```
   cd "D:\Paramount Intelligence\AI Call Assistant\aica-mac\apps\desktop\release"
   Get-FileHash Paramount-AI-Setup-1.7.5.exe, Paramount-AI-Setup-1.7.5.exe.blockmap, latest.yml -Algorithm SHA256 |
     ForEach-Object { "{0} *{1}" -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) } |
     Set-Content -Encoding ascii SHA256SUMS.txt
   ```

   The first line must match `<EXE SHA>`.
3. **Publish** as the newest ("latest") release. Windows apps read the latest release's `latest.yml`. `mac-latest` stays a pre-release and is not touched.

   ```
   & "C:\Program Files\GitHub CLI\gh.exe" release create v1.7.5 -R Zainpak123/kite-releases --latest --title "Paramount AI 1.7.5" --notes-file "D:\Paramount Intelligence\AI Call Assistant\aica-mac\docs\deploy\desktop-1.7.5-notes.md" Paramount-AI-Setup-1.7.5.exe Paramount-AI-Setup-1.7.5.exe.blockmap latest.yml SHA256SUMS.txt
   ```

4. **Check:**
   - `gh release list -R Zainpak123/kite-releases -L 3`: `Paramount AI 1.7.5` is **Latest**, and `mac-latest` is still a **Pre-release**.
   - `curl.exe -sI https://call.paramountintelligence.co/download/windows` gives a 302 to `…/Paramount-AI-Setup-1.7.5.exe`, within a few minutes.

## 2. Publish Mac 1.8.1 (about 10 min, from the cloud build)

1. **One-time:** add the repository secret `KITE_RELEASES_TOKEN` (`mac-release-runbook.md`, "One-time set-up"). Never paste it anywhere else.
2. **Run the workflow with Publish ticked,** on `mac-internal-release` (or `main`; both are at the release commit):
   - On GitHub: https://github.com/syedaliazzam/AI-Call-Assitant/actions › **mac-build** › **Run workflow** › branch `mac-internal-release` › tick **Publish** › **Run workflow**.
   - Or from the laptop:

     ```
     & "C:\Program Files\GitHub CLI\gh.exe" workflow run mac-build.yml -R syedaliazzam/AI-Call-Assitant --ref mac-internal-release -f publish=true
     & "C:\Program Files\GitHub CLI\gh.exe" run list -R syedaliazzam/AI-Call-Assitant --workflow mac-build.yml --limit 1
     & "C:\Program Files\GitHub CLI\gh.exe" run watch <run id> -R syedaliazzam/AI-Call-Assitant --exit-status
     ```

   The run builds the same commit again, checks it (ALL CHECKS PASSED) and publishes with `publish-mac.mjs`: the zip, the blockmap and the dmg first, `latest-mac.yml` last. It refuses a version that is not newer than 1.8.0.
3. **Check:**
   - `https://github.com/Zainpak123/kite-releases/releases/download/mac-latest/latest-mac.yml` says `version: 1.8.1`.
   - `mac-latest` is still a **Pre-release**.
   - The Windows "latest" release is unchanged.

## 3. First automatic update: test plan (about 15 min per machine)

Do it on one Windows PC with 1.7.4 and one Mac with 1.8.0, each signed in, with the permissions given and a session with a document.

**Before (both machines):**
1. Note the version:
   - Mac: Paramount AI › About shows **1.8.0**.
   - Windows: Settings › Apps shows **1.7.4**.
2. Note the state:
   - you are signed in (no sign-in page);
   - the session list;
   - on a Mac, System Settings › Privacy & Security: Microphone, Screen Recording and Accessibility are on for Paramount AI;
   - Settings › Private.

**The update (each machine):**
3. With the app open and **no call running**, wait, or quit and reopen it (it checks at start). On 1.7.4 / 1.8.0 there is no menu item yet.
4. **Expected:** within a few minutes, the question "A new version of Paramount AI is ready" with **Restart now / Later**.
5. Start a call before answering. **Expected:** nothing more appears during the call. End the call: the question comes back (or choose Later and quit; it installs on quit).
6. **Restart now.** **Expected:** the app reopens by itself.
7. Check the version:
   - Mac: About shows **1.8.1**;
   - Windows: Settings › Apps shows **1.7.5**;
   - the sidebar says "Desktop app v1.8" or "v1.7".

**After (each machine):**
8. **Kept:**
   - still signed in, with the same sessions;
   - Private is as before;
   - on a Mac, no permission question at the next Connect, and Screen Recording still on (same certificate);
   - on Windows, the Desktop icon still opens the app.
9. **Check for Updates…:**
   - Mac: Paramount AI menu › **Check for Updates…**;
   - Windows: right-click the tray icon › **Check for Updates…**.

   **Expected:** "You're up to date", with Paramount AI 1.8.1 or 1.7.5 named.
10. **New keys, in a call** (play a video with speech as "Them"):

   | Check | Windows 1.7.5 | Mac 1.8.1 |
   |---|---|---|
   | Answer | Ctrl+Enter | ⌃↵ |
   | Show / hide the bars | Ctrl+Alt+Y hides, then shows (Ctrl+Alt+H does nothing now) | ⌃⌥Y |
   | Screenshot | Ctrl+Shift+Enter: a card with a thumbnail; with two screens, "Screen N" and **Wrong screen?** | ⌃⇧↵, the same |
   | Wrong screen? | Click it: the same card answers again about the other screen, and says "Screen M" | the same |
   | Previous / next | Ctrl+← / → | ⌃← / → after turning off Mission Control's "Move left / right a space"; with it on, macOS switches desktops (expected; Settings says so) |
   | ⌘ keys left alone | — | In TextEdit during the call, ⌘← goes to the line's start and ⌘= zooms |
   | Tray / menu | Tray › **Turn click-through off** during a call, after turning Click-through on with Ctrl+Alt+X | Menu bar icon › **Turn click-through off** (as in 1.8.0) |
   | Settings › Hotkeys | Show or hide: Ctrl+Alt+Y | Every row with ⌃; notes under previous / next (Mission Control), zoom (Teams ⌃0), the ⌃⌥ rows (VoiceOver) |

11. **Screen under the pointer** (two screens): with the pointer on the second screen, press the screenshot key. **Expected:** the card says "Screen 2", and the answer is about that screen.

## 4. Rollback

| What broke | Do this |
|---|---|
| **The web app** | `vercel rollback <PREV URL> --yes` (from a folder linked to `kite-call-assistant`). Everyone is on the previous site within a minute, including 1.7.5 / 1.8.1 apps, which keep working with it (their new capture choice is then simply not used). After a rollback, new deploys need `vercel promote`. Then fix forward on a branch, and `git revert -m 1 <MERGE>` on `main` if the merge itself is the problem. |
| **Windows 1.7.5** (before many have it) | `gh release edit v1.7.4 -R Zainpak123/kite-releases --latest`: new checks find 1.7.4 again and download nothing. PCs already on 1.7.5 keep it (the updater never goes back). Fix forward as 1.7.6. Do not delete v1.7.5's files while PCs may be downloading. |
| **Mac 1.8.1** | `publish-mac.mjs` keeps only the newest files on `mac-latest`. To stop it spreading, delete only `latest-mac.yml` from `mac-latest`. The site then says "Mac version coming soon" within ten minutes (ADR-0125), and new Macs cannot install until a fixed 1.8.2 is published. Macs on 1.8.1 keep it. |
| **A key clash found after release** | The keys come from the shell: a fix needs a new desktop version on that system. Until then Settings → Hotkeys shows the clash. |

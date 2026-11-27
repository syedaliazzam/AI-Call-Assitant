# Release: no system notifications (web) and desktop Mac 1.8.2 / Windows 1.7.6

**For:** the developer, on the Windows laptop with `gh` signed in as the releases owner and the Vercel CLI linked to `kite-call-assistant`.

**Decisions:** ADR-0130 (the model ✦ at normal brightness, web only), ADR-0131 (no system notifications; web, and the desktop shell).

**Rules:**
- Do the steps in order.
- Stop at the first ❌ and use the rollback section.
- No secret is ever printed or pasted.
- Publishing either desktop app is your decision: nothing below has been published.

## Where things stand (filled in by the release run, 27 Nov 2026)

- **Rollback target, recorded before the deploy:** production was `https://kite-call-assistant-gpgd8ix47-paramount-intelligence.vercel.app` (`dpl_Asy8JV5oWehdRsyykUfdEGugwCug`, created 27 Nov 2026 19:59 PKT, `main` @ `c140458`).
- **Web:** `main` @ `84e71da`, deployed to production: https://kite-call-assistant-7ghql5kom-paramount-intelligence.vercel.app (`dpl_CM6FhuZy9F9qJAqqW4TLAUyjvJ3x`), aliased to `call.paramountintelligence.co`. Desktop apps already installed (Windows 1.7.5, Mac 1.8.1) pick it up when restarted: the ✦ fix and "no saved-to-Drive notification" need no new app.
- **Checks before the deploy:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (web 3,033, desktop 346 passed); integration `launcher`, `answers`, `live`, `review` (77 passed, 4 skipped as before); `pnpm --filter web build` passed.
- **Production e2e** (27 Nov 2026, disposable account created and deleted; no Claude request): domain, desktop-link, launcher, sync-api, sync-devices, legacy-upload, duplicate-and-keys: 27 passed, 1 skipped (the admin page, which needs an admin account).
- **Windows 1.7.6** (built, not published):
  - Folder: `D:\Paramount Intelligence\AI Call Assistant\AI-Call-Assitant\apps\desktop\release\`.
  - `Paramount-AI-Setup-1.7.6.exe`: SHA-256 `84a83224c9631e3b0c3a728e64197762e57c1cd8119b128c8b90313917642958`.
  - `Paramount-AI-Setup-1.7.6.exe.blockmap`: `346df0198788101cf160cd1a76a29b364767d7f61f399751e32b2b9470f7ed90`; `latest.yml` (version 1.7.6): `52d934669a590ac6afe0728153336d22b8d031392e92cdbd9a85a4c6a68b7667`.
  - Local install check: **not run** (no 7-Zip on this laptop to extract the 1.7.5 installer). Run step 1.1 before publishing.
- **Mac 1.8.2** (dry run, not published):
  - Run: https://github.com/syedaliazzam/AI-Call-Assitant/actions/runs/46028400531 (`main` @ `84e71da`, success, 8 min, ALL CHECKS PASSED), artifact `paramount-ai-mac-1.8.2`.
  - SHA-256: `latest-mac.yml` `df1aa911ffc572219be07fe0e92bfa267b2a02e5968c62f2380ee93b89d6a809`; `Paramount-AI-1.8.2-universal-mac.zip` `f9e598cf8cef03bf8d716165029f925013085dbf8d102e0f04a456a114de9182`; `.zip.blockmap` `0ff600cd551f9a562aa1b127fd601358d26c253f8519d0b26f94c0fc1f927a2d`; `Paramount-AI-1.8.2-universal.dmg` `a4165b505d003a5b5b902fa650f9d1fd25c8e339f0dd7c9ade719020a30edad8`.
  - The publish run builds the same commit again, so its files have their own hashes; the checks are the same.

## 1. Publish Windows 1.7.6 (about 10 min)

1. **Local install check, before publishing** (optional if the report above says PASS):
   - It runs a kept copy of 1.7.5 against a feed on this computer.
   - It opens that old app's window and installs nothing.

   ```
   & "C:\Program Files\GitHub CLI\gh.exe" release download v1.7.5 -R Zainpak123/kite-releases -p "Paramount-AI-Setup-1.7.5.exe" -D C:\paramount-1.7.5
   # extract with 7za to C:\paramount-1.7.5\app, copy the .exe to %LOCALAPPDATA%\kite-updater-check\installer.exe, then:
   node --experimental-strip-types apps/desktop/tests/update-check.ts "C:\paramount-1.7.5\app\Paramount AI.exe" "D:\Paramount Intelligence\AI Call Assistant\AI-Call-Assitant\apps\desktop\release"
   ```

   **Expected:** PASS.
2. **Checksums file** (the same format as 1.7.5's):

   ```
   cd "D:\Paramount Intelligence\AI Call Assistant\AI-Call-Assitant\apps\desktop\release"
   Get-FileHash Paramount-AI-Setup-1.7.6.exe, Paramount-AI-Setup-1.7.6.exe.blockmap, latest.yml -Algorithm SHA256 |
     ForEach-Object { "{0} *{1}" -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) } |
     Set-Content -Encoding ascii SHA256SUMS.txt
   ```

   The first line must match the installer's SHA-256 above.
3. **Publish** as the newest ("latest") release. `mac-latest` stays a pre-release and is not touched.

   ```
   & "C:\Program Files\GitHub CLI\gh.exe" release create v1.7.6 -R Zainpak123/kite-releases --latest --title "Paramount AI 1.7.6" --notes-file "D:\Paramount Intelligence\AI Call Assistant\AI-Call-Assitant\docs\deploy\desktop-1.7.6-notes.md" Paramount-AI-Setup-1.7.6.exe Paramount-AI-Setup-1.7.6.exe.blockmap latest.yml SHA256SUMS.txt
   ```

4. **Check:**
   - `gh release list -R Zainpak123/kite-releases -L 3`: `Paramount AI 1.7.6` is **Latest**; `mac-latest` is still a **Pre-release**.
   - `curl.exe -sI https://call.paramountintelligence.co/download/windows` gives a 302 to `…/Paramount-AI-Setup-1.7.6.exe`, within a few minutes.

## 2. Publish Mac 1.8.2 (about 10 min, from the cloud build)

1. `KITE_RELEASES_TOKEN` must be a repository secret (`mac-release-runbook.md`, "One-time set-up"); it was there for 1.8.1.
2. **Run the workflow with Publish ticked** on `main` (the release commit):

   ```
   & "C:\Program Files\GitHub CLI\gh.exe" workflow run mac-build.yml -R syedaliazzam/AI-Call-Assitant --ref main -f publish=true
   & "C:\Program Files\GitHub CLI\gh.exe" run list -R syedaliazzam/AI-Call-Assitant --workflow mac-build.yml --limit 1
   & "C:\Program Files\GitHub CLI\gh.exe" run watch <run id> -R syedaliazzam/AI-Call-Assitant --exit-status
   ```

   The run builds the same commit again, checks it (ALL CHECKS PASSED) and publishes: the zip, the blockmap and the dmg first, `latest-mac.yml` last. It refuses a version that is not newer than the published 1.8.1.
3. **Check:** `https://github.com/Zainpak123/kite-releases/releases/download/mac-latest/latest-mac.yml` says `version: 1.8.2`; `mac-latest` is still a **Pre-release**; the Windows "latest" release is unchanged.

## 3. What to check on the real machines

### Now, before publishing (web change; restart the app you have)

Quit and reopen Paramount AI (Windows 1.7.5, Mac 1.8.1) so it loads the new site.

1. **Model icon (ADR-0130).** Start a call (a video with speech as "Them" is enough).
   - **Expected:** the ✦ next to **AA** is as bright as the other buttons, in the dark and the light overlay themes, on Windows and on the Mac.
   - Pick another model from it: the ✦ turns accent-coloured with a ring. Pick the default again: back to normal brightness.
   - After the call ends, the ✦ dims (it is disabled then), with the same dimming as any other disabled bar button.
2. **No "saved" notification (ADR-0131).** With Google Drive saving on, share your screen in a test meeting, make a short call, end it and keep sharing for 3 to 5 minutes.
   - **Expected:** no Windows toast, no macOS notification, and no banner at the bottom of the dashboard or the launcher.
   - The session's card in the dashboard (browser) and in the desktop "Your sessions" says **Uploading…** (with a percentage while sending), then **Saved to Drive ✓**. Clicking it opens the session's Drive folder.
   - Optional: in Settings, switch Drive saving off for a moment so an upload fails or waits. The card shows **Upload failed — Retry** (or what to fix, with **Settings**). Switch it back on.
3. Your "saved" email still arrives as before. If your mail app shows notifications, they come from the mail app, not Paramount AI (ADR-0131 "Consequences").

### After publishing 1.7.6 / 1.8.2

4. **The last old-style question.** On 1.7.5 / 1.8.1 the old updater still shows **Restart now / Later** once, when it has downloaded 1.7.6 / 1.8.2 (outside a call, or when a call ends). Choose **Restart now**.
   - **Expected:** the app reopens; Settings › Apps (Windows) shows **1.7.6**, or Paramount AI › About (Mac) shows **1.8.2**.
   - Still signed in, same sessions, same Private setting. On the Mac, Screen Recording is still on.
5. **No restart question any more.** On 1.7.6 / 1.8.2, **Check for Updates…** (Windows tray, Mac app menu):
   - **Expected:** "You're up to date".
   - When a later version comes, nothing pops up at the end of a call. "Check for Updates…" then says it is ready and offers Restart now / Later; otherwise it installs when you quit.
6. **Background upload on exit.** Make a short recorded call with Drive on, end it, and right away quit from the tray (Windows) or Cmd+Q (Mac).
   - **Expected:** no notification. The tray icon stays, and its tooltip and menu say "Uploading 1 recording to Drive: N%".
   - The app quits by itself when the upload is done.

## 4. Rollback

| What broke | Do this |
|---|---|
| **The web app** | `vercel rollback https://kite-call-assistant-gpgd8ix47-paramount-intelligence.vercel.app --yes` (from a folder linked to `kite-call-assistant`). Everyone is back on the previous site within a minute, including desktop apps. After a rollback, new deploys need `vercel promote`. Then fix forward on a branch, and `git revert -m 1 84e71da` on `main` if the merge itself is the problem. Note: a rollback brings back the "saved to Drive" notification on every desktop version older than 1.7.6 / 1.8.2. |
| **Windows 1.7.6** (before many have it) | `gh release edit v1.7.5 -R Zainpak123/kite-releases --latest`: new checks find 1.7.5 again and download nothing. PCs already on 1.7.6 keep it. Fix forward as 1.7.7. Do not delete v1.7.6's files while PCs may be downloading. |
| **Mac 1.8.2** | To stop it spreading, delete only `latest-mac.yml` from `mac-latest`. The site then says "Mac version coming soon" within ten minutes (ADR-0125), and new Macs cannot install until a fixed 1.8.3 is published. Macs on 1.8.2 keep it. |

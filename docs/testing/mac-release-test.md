# Mac release test (stage 6): build, install, use and update Paramount AI on a real Mac

**What this is.** The first real test of Paramount AI on a Mac. Nothing for the Mac is released until every step below passes (ADR-0109, ADR-0110, ADR-0111; since 25 Nov 2026 also the overlay of ADR-0118 and ADR-0119 and the Mac fixes of ADR-0120).

**Who:** the teammate with the build Mac. **Time:** about 2 hours, mostly waiting for builds.

Write down each step's result: ✅ or ❌, plus a short note for every ❌ (what you saw).

**You need:**
- **A Mac with macOS 14.2 or later.** Apple menu ›  About This Mac shows the version. Note whether it says **Apple M…** (Apple chip) or **Intel**.
- **Part C of `docs/deploy/mac-signing-certificate.md` done** on this Mac (the signing keychain).
- **Your Paramount AI account.**
- **The test address** from the developer: the preview deployment of the web app with these changes, `https://kite-call-assistant-<id>-paramount-intelligence.vercel.app`. Previews are made with `vercel deploy` from the command line, which gives each deployment its own address and no fixed branch address, so use the exact one the developer sends for the commit you built. The app normally opens the live site, which does not have the Mac changes yet.
- **The commit** the developer names (`git log --oneline -1` in step 1.3 must show it).
- **Headphones**, and a YouTube interview video (it plays the "other side").
- **Invented data only.** A made-up company and documents; never a real customer call.

**Terminal basics.**
- Open Terminal from Applications › Utilities.
- Paste a line, then press **Return**.
- To stop something that keeps running, press **Ctrl+C**.
- "Repository folder" means the folder where the code is, for example `~/AI-Call-Assitant`.

**Opening Paramount AI for this test.** Whenever this guide says *open Paramount AI for the test*, quit it first (**⌘ Q**) if it is running, then run this in Terminal with the test address:

```
open -a "Paramount AI" --args --kite-url=<test address>
```

The app then shows the test web app (sign in once there). Opened any other way, it shows the live site.

---

## 1. Get ready (once, 15 min)

1. **Apple's command-line tools.** In Terminal run `xcode-select --install`, then click **Install** in the window that opens. If it says they are already installed, that is fine.
2. **Node.** Install **Node 24 LTS** from nodejs.org (the macOS installer). Then run:

   ```
   corepack enable
   ```

   If it says permission denied, run `sudo corepack enable` and type your Mac password.
3. **The code.** In Terminal:

   ```
   cd ~
   git clone <the repository address the developer gives you> AI-Call-Assitant
   cd AI-Call-Assitant
   git checkout mac-internal-release
   git pull
   git log --oneline -1
   ```

   The last line must start with the commit the developer named.

4. Check it is ready:
   - `ls apps/desktop/build/mac-signing/` lists **certificate.pem**;
   - `grep PINNED_CERT_SHA256 apps/web/public/install-mac.sh` shows a long code, not `not-set`.

   If not, ask the developer (Part B of the certificate guide).

## 2. Build two test versions (40 to 60 min, mostly waiting)

The update test needs an older and a newer version. They are the same code with two numbers: **1.7.98** (older) and **1.7.99** (newer).

1. In the repository folder:

   ```
   bash apps/desktop/scripts/mac/build.sh --version 1.7.98
   ```

   macOS asks for the **signing keychain's password** (from your password manager). The build takes 15 to 30 minutes.
2. At the end it runs the checks. **Expected:**
   - every line starts with **PASS**, and the last line says **ALL CHECKS PASSED**;
   - one line says Gatekeeper rejects it: that is expected for our own certificate;
   - the version line says **1.7.98**.
   - If any line says **FAIL**, stop and send the developer the whole list.
3. Keep this build:

   ```
   mkdir -p ~/paramount-test && rm -rf ~/paramount-test/old && cp -R apps/desktop/release ~/paramount-test/old
   ```

4. Build the newer one the same way:

   ```
   bash apps/desktop/scripts/mac/build.sh --version 1.7.99
   rm -rf ~/paramount-test/new && cp -R apps/desktop/release ~/paramount-test/new
   ```

   **Expected:** ALL CHECKS PASSED, version 1.7.99.

| # | Check | Result |
|---|---|---|
| 2.1 | 1.7.98 built, ALL CHECKS PASSED | |
| 2.2 | 1.7.99 built, ALL CHECKS PASSED | |

## 3. Install with the Terminal installer (10 min)

The installer normally downloads from the internet. For this test it reads the older build from this Mac.

1. **Terminal window A:** serve the older build, and leave it running:

   ```
   cd ~/AI-Call-Assitant
   node apps/desktop/scripts/mac/serve-test-feed.mjs ~/paramount-test/old 8765
   ```

2. **Terminal window B** (Shell › New Window):

   ```
   cd ~/AI-Call-Assitant
   PARAMOUNT_AI_FEED=http://127.0.0.1:8765 bash apps/web/public/install-mac.sh
   ```

3. **Expected:**
   - it says **Checksum OK**, **Signature OK (Paramount Intelligence)**, **Installed Paramount AI 1.7.98 in /Applications**;
   - Paramount AI opens;
   - **no** "cannot be opened" or "Apple could not verify" message.
4. In the menu bar: **Paramount AI › About Paramount AI** shows **1.7.98**.
5. Stop window A with **Ctrl+C**.
6. **Open Paramount AI for the test** (see the top of this guide).

| # | Check | Result |
|---|---|---|
| 3.1 | Checksum OK and Signature OK shown | |
| 3.2 | Installed and opened with no Gatekeeper warning | |
| 3.3 | About shows 1.7.98 | |

## 4. First start: the permission card (10 min)

1. Sign in. **Expected:** the home panel shows a card **"Before your first call on this Mac"**, listing **Microphone** and **Screen & System Audio Recording**, both "Not allowed yet".
2. Next to **Microphone**, click **Allow**. **Expected:** macOS asks *"Paramount AI would like to access the microphone"* with our sentence ("…The audio is never stored."). Click **Allow**. The row now says **Allowed** with a tick.
3. Next to **Screen & System Audio Recording**, click **Allow**. **Expected:** macOS shows a screen-recording message; choose **Open System Settings**.
   - If no message appears, click **Open System Settings** on the card instead. It should open System Settings at Privacy & Security › Screen & System Audio Recording.
4. Turn on **Paramount AI** in that list (enter your Mac password if asked). If macOS offers **Quit & Reopen**, choose it; otherwise click **Quit and reopen** on the card.
5. **Expected:** Paramount AI reopens and the card is gone (both allowed).

| # | Check | Result |
|---|---|---|
| 4.1 | Card shows both permissions on first start | |
| 4.2 | Microphone: macOS question with our text; row turns Allowed | |
| 4.3 | Screen recording: System Settings opens at the right page | |
| 4.4 | After quit and reopen, the card is gone | |

## 5. A call in the desktop app (30 min)

Make a session (any type, invented details). Put on headphones. Open a YouTube interview in Chrome, but don't play it yet.

1. **Connect.** Open the session and click **Connect**. **Expected:** the call starts with no new permission question, and the bars appear.
2. **Both sides.** Play the video, then say a sentence yourself. **Expected:** "Them" lines (the video) and "You" lines (you) appear separately.
3. **Answer:** press **⌘ ↵** (Command+Return). **Expected:** an answer streams in.
4. **The Mac keys.** Open TextEdit and type a line of text, keeping the call running:
   - **⌘ ←** and **⌘ →** move to the start and end of the line in TextEdit; Paramount AI does nothing;
   - **⌘ ⌫** deletes to the start of the line in TextEdit;
   - **⌃ ⌥ ←** / **⌃ ⌥ →** (Control+Option+arrows) show the previous / next answer in Paramount AI;
   - **⌃ ⌥ ⌫** clears the answers; **⌃ ⌥ ⇧ ⌫** clears the transcript;
   - **⌃ ⌥ =** / **⌃ ⌥ -** / **⌃ ⌥ 0** zoom the bars;
   - **⌃ ⌥ H** hides and shows the bars;
   - **⌃ ⌘ ↑** / **⌃ ⌘ ↓** move the bars to the top / bottom row.
5. **Settings › Hotkeys** (open it from the call's ⋮ › Dashboard, or after the call) lists the Mac keys with ⌃ ⌥ and ⌘ symbols, and says nothing is "In use by another app". If something is, note which. **Expected** (25 Nov 2026): under the first line, a note starts *"On a Mac, macOS may not tell Paramount AI that another app uses the same keys…"*. If **Rectangle** (or Magnet) is installed, note whether Settings shows ⌃⌥ arrows "In use by another app", and whether ⌃⌥← in a call shows the previous answer or moves the window (this tells us whether macOS reports clashes).
6. **Full screen.** Make the YouTube window full screen (the green button, or ⌃⌘F). **Expected:** the bars float over the full-screen video. When the bars first opened, the Dock icon may have blinked once: note whether it did.
7. **Screenshot answer:** press **⌘ ⇧ ↵**. **Expected:** the answer is about the video page, not about Paramount AI's own bars.
8. **Private.** Open the bars' **⋮** menu. **Expected:** under **Private**, the line *"On Mac, share a single window or tab, not your entire screen."* Then turn **Private** off in that menu. **Expected:** a slim line under the transcript bar says *"Private is off. On a Mac, Private hides the overlay when you share a window or tab, not your entire screen."* with **Turn on**. Click **Turn on**: the line goes. (ADR-0120)
9. **Private in a share** (needs a phone):
   - join a Google Meet from Chrome on the Mac and from your phone;
   - on the Mac, share your **entire screen**;
   - write down whether the phone shows Paramount AI's bars;
   - then share only the **Chrome tab**, and write down again. (This measures what macOS allows; it is not pass or fail.)
10. **The menu.** Click on the bars, then:
    - **⌘ R** does nothing (no reload, the call goes on);
    - **⌘ W** does not close the bars;
    - the **Paramount AI** menu has About, Hide, Hide Others and Quit, and no Reload or Developer Tools;
    - in a text box (Ask AI or the session editor), **⌘ C** and **⌘ V** copy and paste.
11. **Menu bar icon.** **Expected:** a sharp Paramount AI icon at the top right. Click it: a menu with **Open Paramount AI** and **Quit Paramount AI**.
12. **Recording** (only if your account can record): start a recording with the Rec pill or **⌘ ⌥ R**, talk for 30 seconds, stop it.
    - **Expected:** macOS asks once for the **Documents** folder, with our sentence. Allow it.
    - **Expected** (ADR-0120 §4), while a **Screen + audio** recording runs: a slim amber line under the transcript bar says *"On a Mac, Paramount AI's windows appear in this recording, even with Private on"*, with **no** Turn on button, and the Rec pill has an amber dot. (With **Audio only**, no line.)
    - The recording saves and plays from Meetings. Write down whether the bars are visible in the video (expected: yes).
13. **The transcript bar** (ADR-0118). Keep the video playing.
    - **Bar 1** (the top bar) has **no** Transcript switch.
    - **Bar 2** is always there. On it: the green level icon, the latest words as small chips moving in one line, **Clear**, and an expand icon (⤢).
    - Click **⤢**. **Expected:** the full transcript opens **under** bar 2, which stays with its words. Click it again (or the green icon): the full transcript closes.
    - Unplug or mute the other side (pause the video for a minute, or pick a silent audio source). **Expected:** a slim line under bar 2 says *"Can't hear the other side"* with **Choose audio source**, while bar 2 still shows its chips.
14. **Side by side** (ADR-0119). Use the overlay at the size it opened with (do not widen it). Open the full transcript and get an answer (**⌘ ↵**). **Expected:** the transcript on the **left** and the answer on the **right**, next to each other (before this change they were stacked). Write down the window's width if you can (Mission Control or a screenshot's size).
15. **No Chromium zoom** (ADR-0120). Click on the bars, then press **⌘ +** three times and **⌘ −** three times. **Expected:** nothing changes. **⌃ ⌥ =** and **⌃ ⌥ −** still zoom the bars, and **⌃ ⌥ 0** puts them back. The **View** menu has only **Enter Full Screen**.
16. **Snap zones over a full-screen meeting** (ADR-0120). With the YouTube window still full screen (step 6), drag the bars by their move icon. **Expected:** the six snap zones show over the full-screen video, and dropping snaps the bars there.
17. **End** the call. **Expected:** the notes are written as usual.

| # | Check | Result |
|---|---|---|
| 5.1 | Connect with no new permission question | |
| 5.2 | You and Them both transcribed | |
| 5.3 | ⌘ ↵ answers | |
| 5.4 | ⌘← / ⌘→ / ⌘⌫ work in TextEdit during the call | |
| 5.5 | ⌃⌥ keys and ⌃⌘ arrows work as listed | |
| 5.6 | Settings › Hotkeys shows the Mac keys and the Mac note (Rectangle: clash shown? yes / no / not installed) | |
| 5.7 | Bars float over a full-screen window (Dock blink: yes/no) | |
| 5.8 | Screenshot answer is about the page, not Paramount AI | |
| 5.9 | Private note shown in ⋮ | |
| 5.10 | Whole-screen share: bars visible on the phone? (write it down) | |
| 5.11 | ⌘R / ⌘W do nothing to the bars; menu has no Reload; ⌘C/⌘V work | |
| 5.12 | Menu bar icon sharp, its menu works | |
| 5.13 | Recording: Documents question; the Mac recording line (no Turn on); saves and plays; bars in the video? | |
| 5.14 | Bar 1 has no Transcript switch; bar 2 always shows the word chips, Clear and ⤢ | |
| 5.15 | ⤢ opens the full transcript under bar 2 (bar 2 stays); it closes again | |
| 5.16 | A warning shows in a slim line under bar 2; the chips stay | |
| 5.17 | At the size it opened with: transcript left, answer right (window width: …) | |
| 5.18 | ⌘ + / ⌘ − do nothing; ⌃⌥ = / − / 0 zoom; View menu has only Full Screen | |
| 5.19 | Private off: the Mac line with Turn on; Turn on clears it | |
| 5.20 | Snap zones show over a full-screen window | |

## 6. The update keeps the permissions (20 min)

This is the most important part. The app updates itself to 1.7.99 from this Mac, and macOS must **not** ask for any permission again.

1. Before updating, write down the app's signing rule:

   ```
   codesign -dr - "/Applications/Paramount AI.app" 2>&1 | grep designated
   ```

2. **Terminal window A:** serve the newer build:

   ```
   cd ~/AI-Call-Assitant
   node apps/desktop/scripts/mac/serve-test-feed.mjs ~/paramount-test/new 8765
   ```

3. **Terminal window B:** point the installed app at it (a file in its data folder, outside the app):

   ```
   echo "http://127.0.0.1:8765/" > ~/Library/Application\ Support/Kite/test-update-feed.txt
   ```

4. Quit Paramount AI (**⌘ Q**), then **open Paramount AI for the test**.
5. **Expected:**
   - within a minute or two, window A shows requests for **latest-mac.yml** and the **zip**;
   - Paramount AI then asks **"A new version of Paramount AI is ready"**. Click **Restart now**.
6. After it restarts, **open Paramount AI for the test** again (the restart opens the live site). **Expected:**
   - About shows **1.7.99**;
   - **no** permission card and **no** macOS permission question;
   - a new call (**Connect**, play the video, speak) transcribes both sides with **no** question.
7. Run the command from step 1 again. **Expected:** the same signing rule as before.
8. **Clean up:**
   - `rm ~/Library/Application\ Support/Kite/test-update-feed.txt`
   - stop window A with **Ctrl+C**.

**If no "new version" question appears within 5 minutes:**
- write down what window A showed;
- send the developer the last 30 lines of Apple's updater log:

  ```
  tail -30 ~/Library/Caches/co.paramountintelligence.kite.ShipIt/ShipIt_stderr.log
  ```

  It holds file names and signature checks, no call content. If Apple's updater refused our signature, the developer switches to the small custom updater (ADR-0109 §5).

| # | Check | Result |
|---|---|---|
| 6.1 | The app found and downloaded 1.7.99 | |
| 6.2 | Restart now installed it; About shows 1.7.99 | |
| 6.3 | No permission card, no macOS question after the update | |
| 6.4 | A call after the update hears both sides with no question | |
| 6.5 | Signing rule the same before and after | |

## 7. The .dmg fallback (optional, 10 min)

1. Move the installed app to the Bin (Finder › Applications › drag **Paramount AI** to the Bin).
2. Mark the newer `.dmg` as downloaded from the internet, as a browser would, then open it:

   ```
   xattr -w com.apple.quarantine "0081;$(printf %x $(date +%s));Safari;" ~/paramount-test/new/Paramount-AI-1.7.99-universal.dmg
   open ~/paramount-test/new/Paramount-AI-1.7.99-universal.dmg
   ```

3. Drag **Paramount AI** to **Applications**, then open it. **Expected:** macOS says it cannot verify the app.
4. Click **Done**, then **System Settings › Privacy & Security**, scroll to *"Paramount AI was blocked"*, click **Open Anyway**, then **Open**. **Expected:** the app opens. Your permissions are still allowed (same certificate).

| # | Check | Result |
|---|---|---|
| 7.1 | Open Anyway works; permissions still allowed | |

## 8. Chrome on this Mac (10 min)

1. In Chrome, go to the **test address**, sign in, open a session and click **Connect**.
2. In Chrome's share window, pick **Window**, choose any window and share. **Expected:** Paramount AI says *"On a Mac only a browser tab shares its sound…"*.
3. Connect again, pick the **YouTube tab** and turn on **Also share tab audio**. **Expected:** both sides are transcribed.
4. With the Paramount AI tab in front, **⌃ ⌥ ←** and **⌃ ⌥ →** move through the answers, and **⌘ ←** does nothing in Paramount AI.
5. In the sidebar, the desktop app card says **Paramount AI for Mac**, and **Don't have it? Get it for Mac** opens the install steps with the Terminal line and a Copy button.

| # | Check | Result |
|---|---|---|
| 8.1 | Window share: the Mac message about tabs | |
| 8.2 | Tab with audio: both sides transcribed | |
| 8.3 | ⌃⌥ arrows work in the tab; ⌘← left alone | |
| 8.4 | Sidebar card offers the Mac app and its install steps | |

## 9. Send the developer

- This file's tables, filled in (✅ / ❌ and notes);
- the **macOS version** and the **Mac model** (Apple chip or Intel);
- for any ❌, a photo or screenshot that shows **no call content** (no transcript, answer or document text);
- the **commit** you built (`git log --oneline -1`) and the **test address** you used;
- for a build that did not say **ALL CHECKS PASSED**, its whole PASS / FAIL list (step 2).

Then remove the test builds: `rm -rf ~/paramount-test`. Keep Paramount AI installed: it will update itself to the real 1.8.0 once it is released.

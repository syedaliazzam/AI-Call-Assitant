# Paramount AI on a Mac: set up, build and use it every day (self-signed, no Apple account)

**What this is.** One guide, top to bottom, to build the Paramount AI desktop app on a Mac, sign it with the company's own certificate, install it, and use it for calls every day. There is no Apple Developer account yet, so the app is signed with our self-signed certificate (ADR-0109) and built on the Mac itself.

**Time:** 60 to 90 minutes the first time, mostly waiting for downloads and the build.

**Need something today, without any of this?** Paramount AI already works in **Chrome on a Mac**. Skip to [Part 10](#part-10-use-it-in-chrome-today-no-desktop-app).

**Related guides** (more background, not needed to follow this one): `docs/deploy/mac-signing-certificate.md` (the certificate), `docs/testing/mac-release-test.md` (the full release test, including updates).

---

## Who does what

| Part | Who | Where | Time |
|---|---|---|---|
| 1. Check you have everything | Teammate | — | 5 min |
| 2. Set up the Mac | Teammate | The build Mac | 20 min |
| 3. Make and store the certificate (**once, ever**) | **Lead** | The build Mac | 15 min |
| 4. Put the public certificate in the code | **Developer** (on Windows) | Developer's laptop | 10 min |
| 5. Import the certificate | Teammate | The build Mac | 10 min |
| 6. Build the app | Teammate | The build Mac | 20–40 min |
| 7. Install and open it | Teammate | The build Mac | 5 min |
| 8. Allow the two permissions | Teammate | The build Mac | 5 min |
| 9. Feature checklist | Teammate | The build Mac | 20 min |
| 10. Chrome on a Mac (works today) | Anyone | Any Mac | 5 min |
| 11. Troubleshooting | — | — | — |

**How to read the commands.**
- Open **Terminal**: press **⌘ Space**, type `Terminal`, press **Return**.
- Copy a grey box, paste it into Terminal (**⌘ V**), press **Return**. Paste one box at a time and wait until it finishes (the prompt `%` comes back).
- Text in `<angle brackets>` is a placeholder: replace it, including the brackets.
- When Terminal asks for a password, **nothing appears as you type**. That is normal. Type it and press **Return**.
- To stop something that keeps running: **Ctrl+C**.

**Key symbols used below:** ⌘ Command · ⌥ Option · ⌃ Control · ⇧ Shift · ⌫ Delete (the key above Return) · ↵ Return.

**The secrets rule.** The certificate file (`paramount-signing.p12`) and its password are secret. The `.p12` lives only in the lead's **private Google Drive folder**; its password lives only in the company **password manager**. Never put the password in the Drive folder, and never send either in email, Slack, chat, a screenshot or the repository. Never paste them into Claude Code. `certificate.pem` is public and can be sent anywhere.

---

## Part 1. Check you have everything (teammate, 5 min)

- [ ] **A Mac with macOS 14.2 or later.** Apple menu  › **About This Mac**. Write down the macOS version and whether the chip says **Apple M…** or **Intel**. (Older than 14.2: the app cannot hear the other side; use [Chrome](#part-10-use-it-in-chrome-today-no-desktop-app).)
- [ ] **Your Mac login password** (an administrator account: macOS asks for it several times).
- [ ] **About 15 GB free disk space** (Apple menu  › System Settings › General › Storage).
- [ ] **A GitHub account with access to the repository** `syedaliazzam/AI-Call-Assitant`. Ask the developer to add you; accept the email invitation.
- [ ] **Your Paramount AI account** (email and password).
- [ ] **Access to the company password manager** (you will create one entry in it).
- [ ] **Headphones**, and a YouTube interview video for testing (it plays "the other side").
- [ ] From the lead: the **private Google Drive folder** for the certificate will be shared with you for a few minutes in Part 5.
- [ ] From the developer (Part 4): the **preview address**, and word that **preview protection is off** for the test.

---

## Part 2. Set up the Mac (teammate, 20 min)

### 2.1 Apple's command-line tools (includes git)

```
xcode-select --install
```

Click **Install** in the window that opens and wait until it finishes (5–15 min). If Terminal says *"command line tools are already installed"*, that is fine.

Check:

```
git --version
```

**Expected:** `git version 2.…`

### 2.2 Node 24 and pnpm

1. In Safari or Chrome go to **https://nodejs.org/en/download**, choose **Node.js v24 (LTS)**, **macOS**, **macOS Installer (.pkg)**. Open the downloaded file and click through the installer.
2. **Quit Terminal (⌘ Q) and open it again**, so it finds Node.
3. Check, then turn on pnpm (it comes with Node through Corepack):

```
node --version
sudo corepack enable
```

**Expected:** `v24.…`. `sudo` asks for your Mac login password.

### 2.3 Get the code

1. **Make a GitHub access token** (git asks for it instead of your GitHub password):
   - github.com › your picture (top right) › **Settings** › **Developer settings** › **Personal access tokens** › **Tokens (classic)** › **Generate new token (classic)**;
   - Note: `Paramount Mac build`; Expiration: **90 days**; tick **repo**; **Generate token**;
   - copy the token (it starts with `ghp_`). It is a secret: keep it in your password manager.
2. Download the code and switch to the Mac branch:

```
cd ~
git clone https://github.com/syedaliazzam/AI-Call-Assitant.git
cd ~/AI-Call-Assitant
git checkout mac-internal-release
git pull
```

When git asks **Username**, type your GitHub username; for **Password**, paste the token. macOS remembers it.

3. Check pnpm works in the project (it downloads the right pnpm version the first time; answer **Y** if asked):

```
cd ~/AI-Call-Assitant
pnpm --version
```

**Expected:** `12.15.0`.

### 2.4 Claude Code in the repository (for help while you work)

Claude Code is not needed for the build, but it can explain any error. **No Vercel tools are needed on the Mac:** the Mac only builds the desktop app; the web app stays on Vercel.

1. Install it:

```
curl -fsSL https://claude.ai/install.sh | bash
```

2. **Quit Terminal (⌘ Q) and open it again.**
3. Keep Claude Code's local settings out of git, so the build sees a clean repository:

```
cd ~/AI-Call-Assitant
printf '\n.claude/\nCLAUDE.local.md\n' >> .git/info/exclude
```

4. Start it in the repository and sign in with your company Claude account when it asks:

```
cd ~/AI-Call-Assitant
claude
```

It reads the project's `CLAUDE.md` by itself. Type `/exit` to leave. **Never paste the certificate, its password or your keychain password into Claude Code.**

---

## Part 3. Make and store the certificate (LEAD, once ever, 15 min)

> **Only once, ever.** Every Mac build must be signed with the same certificate; a new one means every Mac must reinstall and allow its permissions again. If a `.p12` already exists in the private Drive folder, **skip this part**.

The lead does this on the build Mac (after Part 2), or on any Mac with the repository.

### 3.1 Prepare where the secrets go

1. **Google Drive:** create a folder **Paramount AI – Mac signing (private)** in **My Drive**. Click **Share**: General access **Restricted**; add **the developer** only (Viewer). Do not share it with anyone else yet.
2. **Password manager:** create an entry **Paramount AI Mac signing certificate (.p12)** and let it **generate a password of at least 24 characters**. Save it. Share the entry with the developer only.

### 3.2 Make the certificate

```
cd ~/AI-Call-Assitant
bash apps/desktop/scripts/mac/make-signing-cert.sh
```

- At **Password for the .p12 file:** paste the password from the password-manager entry, press **Return**. Do the same at **The same password again:**.
- **Expected:** `Done. In /Users/<you>/Desktop/paramount-signing-<date>:` and two fingerprints, **SHA-1** and **SHA-256**.

### 3.3 Store it, then remove it from the Mac

1. Copy the two fingerprints from Terminal into the password-manager entry's **notes** (they are public; they help check the certificate later).
2. Show the files in Finder:

```
open ~/Desktop/paramount-signing-*
```

3. Drag **paramount-signing.p12** into the private Drive folder (drive.google.com in the browser). Wait until Drive says the upload is complete.
4. Send **certificate.pem** (the public part) to the developer by Slack or email.
5. Delete the secret file from the Mac:

```
rm ~/Desktop/paramount-signing-*/paramount-signing.p12
```

6. Tell the developer: "certificate made, `.p12` in Drive, `.pem` sent".

---

## Part 4. Put the public certificate in the code (DEVELOPER, on Windows, 10 min)

> **Developer's step.** The teammate waits for "pushed" before Part 5.

In PowerShell, in the repository folder:

**D1. Save the certificate and check it.** Save the received `certificate.pem` as `apps\desktop\build\mac-signing\certificate.pem`:

```
git checkout mac-internal-release
git pull
New-Item -ItemType Directory -Force apps\desktop\build\mac-signing
```

(save the file into that folder, then:)

```
node apps/desktop/scripts/mac/cert-tools.mjs fingerprint apps/desktop/build/mac-signing/certificate.pem
```

**Expected:** `subject: CN=Paramount Intelligence Internal Code Signing, …`, `valid to:` about 2126, and `sha1` / `sha256` equal to the fingerprints in the password-manager entry's notes.

**D2. Pin it in the Terminal installer:**

```
node apps/desktop/scripts/mac/cert-tools.mjs pin apps/desktop/build/mac-signing/certificate.pem apps/web/public/install-mac.sh
```

**Expected:** `pin: install-mac.sh now expects <sha256>`.

**D3. Check the version the teammate will build:**

```
node -p "require('./apps/desktop/package.json').version"
```

The Mac app is desktop **1.8.0** (ADR-0109, ADR-0111). If it prints anything else, set `"version"` in `apps/desktop/package.json` before the teammate builds (its own commit).

**D4. Run the checks, commit only these files, push:**

```
pnpm lint
pnpm typecheck
pnpm test
git add apps/desktop/build/mac-signing/certificate.pem apps/web/public/install-mac.sh
git commit -m "chore(desktop): company Mac signing certificate (public part) and installer pin (ADR-0109)"
git push
```

The test *"pins the committed company certificate"* now runs instead of being skipped.

**D5. Turn preview protection OFF for the test, and send the preview address.** Previews are normally behind Vercel's login, and the desktop app refuses to leave Paramount AI's own address, so it cannot show Vercel's login page (the window stays blank). As for the transcription test, protection is turned off for the test only:
1. Vercel dashboard › the project › **Settings** › **Deployment Protection** › **Vercel Authentication**: turn it **off** and save.
2. In `apps\web`, find the newest **Preview** deployment made from the latest push of `mac-internal-release`:

   ```
   vercel ls
   ```

   (or the Vercel dashboard › the project › Deployments, filtered by the branch).
3. Send the teammate that **preview address** (`https://kite-call-assistant-<id>-paramount-intelligence.vercel.app`) and say protection is off.
4. **After the test** (Part 9 done, or at the end of the day): turn **Vercel Authentication back on** and save. The teammate's app then shows a blank window on the preview; they use the live site (Dock) or Chrome until the next test.

**D6. Tell the teammate: "pushed",** and ask the **lead** to add the teammate as **Viewer** to the private Drive folder and to share the **.p12 password** entry with them, for Part 5 only.

---

## Part 5. Import the certificate on the build Mac (teammate, 10 min)

1. **Get the developer's commit:**

```
cd ~/AI-Call-Assitant
git pull
ls apps/desktop/build/mac-signing/
grep PINNED_CERT_SHA256 apps/web/public/install-mac.sh
```

**Expected:** `certificate.pem` is listed, and the second line shows a long code (not `not-set`). If not, wait for the developer's "pushed".

2. **In your password manager**, create an entry **Build Mac signing keychain** with a newly generated password. This is a new password for a keychain on this Mac only.
3. **Download the certificate:** open the shared private Drive folder, right-click **paramount-signing.p12** › **Download**. It lands in **Downloads**.
4. **Import it:**

```
cd ~/AI-Call-Assitant
bash apps/desktop/scripts/mac/import-signing-cert.sh ~/Downloads/paramount-signing.p12
```

Answer, in this order:
- **password for new keychain:** the *Build Mac signing keychain* password (twice);
- **password to unlock:** the same password;
- **the .p12 file's password:** from the shared *Paramount AI Mac signing certificate (.p12)* entry;
- **the keychain password** again;
- a window asks for **your Mac login password** (to trust the certificate for code signing).

**Expected last line:** `PASS: the build Mac can sign Paramount AI (certificate SHA-1 …)`.

5. **Delete the downloaded file, and tell the lead you are done** (the lead removes your access to the Drive folder and the password entry):

```
rm ~/Downloads/paramount-signing.p12
```

---

## Part 6. Build the app (teammate, 20–40 min, mostly waiting)

Paste these boxes one at a time, in order.

**6.1 Get the latest code and check the version:**

```
cd ~/AI-Call-Assitant
git pull
node -p "require('./apps/desktop/package.json').version"
```

**Expected:** `1.8.0`. If not, ask the developer (Part 4, D3) before building.

**6.2 Install the dependencies for both Mac chips** (Apple chip and Intel, so one app runs on every Mac):

```
cd ~/AI-Call-Assitant
pnpm install --frozen-lockfile --cpu=arm64,x64
```

**6.3 Unlock the signing keychain for the build** (asks for the *Build Mac signing keychain* password):

```
security unlock-keychain "$HOME/Library/Keychains/paramount-signing.keychain-db"
```

**6.4 Build** (15–30 min; it downloads Electron and the speech model the first time):

```
cd ~/AI-Call-Assitant/apps/desktop
rm -rf release
CSC_KEYCHAIN="$HOME/Library/Keychains/paramount-signing.keychain-db" CSC_IDENTITY_AUTO_DISCOVERY=false pnpm dist:mac
```

**Expected:** it ends without `Error`, and `apps/desktop/release` holds `Paramount-AI-1.8.0-universal.dmg` and `Paramount-AI-1.8.0-universal-mac.zip`.

**6.5 Check the build:**

```
cd ~/AI-Call-Assitant
bash apps/desktop/scripts/mac/verify-build.sh
```

**Expected:**
- every check line starts with **PASS**; the last line is **ALL CHECKS PASSED**;
- `version: 1.8.0`;
- one information line says Gatekeeper **rejected** the app: that is expected for our own certificate.

If any line says **FAIL**, stop and send the developer the whole list (it holds no secrets).

**6.6 Lock the keychain again:**

```
security lock-keychain "$HOME/Library/Keychains/paramount-signing.keychain-db"
```

> **The same thing in one command.** `bash apps/desktop/scripts/mac/build.sh` runs 6.2 to 6.6 for you (and refuses to build if the repository has uncommitted changes). Use either way.

---

## Part 7. Install and open it (teammate, 5 min)

**7.1 Install from the .dmg:**

```
open ~/AI-Call-Assitant/apps/desktop/release/*.dmg
```

In the window that opens, drag **Paramount AI** onto **Applications** (choose **Replace** if asked). Then eject the disk (Finder sidebar › the ⏏ next to Paramount AI).

A `.dmg` you built on this Mac opens without a security warning. (A `.dmg` copied from another Mac shows "Apple could not verify": see [Troubleshooting](#part-11-troubleshooting).)

**7.2 Open it on the preview.** Until the Mac changes reach the live site, Paramount AI must open the **preview** (the live site does not have the Mac screens yet). The developer turns preview protection off for the test (Part 4, D5) and back on after. Paste the preview address between the quotes, **keeping the quotes**:

```
open -a "Paramount AI" --args --kite-url="<preview address from the developer>"
```

**Expected:** Paramount AI opens on the preview's sign-in page. Sign in with your Paramount AI account.

**7.3 Set up a one-word command for every day.** Save the preview address and make the command `paramount`:

```
echo "<preview address from the developer>" > ~/.paramount-preview
echo "alias paramount='open -a \"Paramount AI\" --args --kite-url=\"\$(cat ~/.paramount-preview)\"'" >> ~/.zshrc
source ~/.zshrc
```

From now on, **to open Paramount AI: quit it (⌘ Q) if it is running, then type `paramount` in Terminal.** When the developer sends a new preview address, run only the first line again with the new address.

> Opened from the Dock, Launchpad or Finder, Paramount AI shows the **live site**, which is fine for calls but has no Mac permission card and uses the older Windows-style keys. Once the Mac work is merged and live, the Dock is all you need and the `paramount` command can be removed.

---

## Part 8. Allow the two permissions, then quit and reopen (teammate, 5 min)

1. After signing in, the home panel shows **"Before your first call on this Mac"** with **Microphone** and **Screen & System Audio Recording**, both "Not allowed yet".
2. Next to **Microphone**, click **Allow**. macOS asks *"Paramount AI would like to access the microphone"* with our sentence. Click **Allow**. The row says **Allowed**.
3. Next to **Screen & System Audio Recording**, click **Allow**. If macOS shows a message, choose **Open System Settings**. If nothing appears, click **Open System Settings** on the card.
4. In **System Settings › Privacy & Security › Screen & System Audio Recording**, turn **Paramount AI** on (enter your Mac password if asked). On macOS 15 or later, if Paramount AI is also listed under **System Audio Recording Only**, turn it on there too.
5. **Quit and reopen.** If macOS offers **Quit & Reopen**, you may click it, but it reopens on the live site. Better: click **Quit and reopen** on Paramount AI's card, or press **⌘ Q** and type:

```
paramount
```

6. **Expected:** the card is gone (both allowed). If it is still there, see [Troubleshooting](#part-11-troubleshooting).

The permissions stay allowed after every rebuild and update, because every build is signed with the same certificate.

---

## Part 9. Feature checklist (teammate, 20 min)

Make a session (any type; invented details for this first test). Put on headphones. In Chrome, open a YouTube interview but don't play it yet. Open the session in Paramount AI and click **Connect**.

| # | Check | How | Expected | ✅/❌ |
|---|---|---|---|---|
| 9.1 | Both sides heard | Play the video, then say a sentence | "Them" lines (video) and "You" lines (you) appear separately; no new permission question | |
| 9.2 | Answer | **⌘ ↵** | An answer streams in | |
| 9.3 | Screenshot answer | **⌘ ⇧ ↵** | The answer is about the YouTube page, not about Paramount AI's own bars | |
| 9.4 | Voice question | **⌘ ⇧ Space**, ask a question aloud, pause | It is sent when you pause and an answer shows; **Esc** cancels | |
| 9.5 | Bars over a full-screen meeting | Make the Chrome window full screen (green button or **⌃ ⌘ F**) | The bars float over the full-screen video (the Dock icon may blink once when the bars open: normal) | |
| 9.6 | Compact view over full screen | Still full screen: click **Compact** on the bars | A small square with moving level bars floats over the video; click it to bring the bars back | |
| 9.7 | Mac keys leave other apps alone | Open TextEdit, type a line; press **⌘ ←**, **⌘ →**, **⌘ ⌫** | They move/delete in TextEdit; Paramount AI does nothing | |
| 9.8 | Paramount AI's own keys | **⌃ ⌥ ← / →**, **⌃ ⌥ H**, **⌃ ⌘ ↑ / ↓** | Previous/next answer; hide/show bars; bars move to top/bottom row | |
| 9.9 | Recording (only if your account can record) | **Rec** on the bars, or **⌘ ⌥ R**; talk 30 s; stop | macOS asks once for the **Documents** folder (allow it); the recording saves and plays from **Meetings** | |
| 9.10 | Quit during an upload (only if your recordings upload to Google Drive) | Right after stopping a recording, press **⌘ Q** | The windows close but the menu-bar icon stays until the upload finishes; a second **⌘ Q** asks **Quit now?** | |
| 9.11 | Menu bar | Look top right | A sharp Paramount AI icon; its menu has **Open Paramount AI** and **Quit Paramount AI** | |
| 9.12 | End | Click **Exit** / end the call | Notes are written as usual | |

### The Mac keys (desktop app)

Held only during a call (except Ask AI), and listed in **Settings › Hotkeys**, which also says if another app already holds one.

| Action | Keys |
|---|---|
| Answer | ⌘ ↵ |
| Answer from a screenshot | ⌘ ⇧ ↵ |
| Voice question (Esc cancels) | ⌘ ⇧ Space |
| Screenshot and voice question | ⌘ ⌥ ↵ |
| Previous / next answer | ⌃ ⌥ ← / → |
| Clear answers | ⌃ ⌥ ⌫ |
| Clear transcript | ⌃ ⌥ ⇧ ⌫ |
| Zoom in / out / back to 100 % | ⌃ ⌥ = / - / 0 |
| Show or hide the bars | ⌃ ⌥ H |
| Move the bars along the row / to the top or bottom row | ⌃ ⌘ ← / → · ⌃ ⌘ ↑ / ↓ |
| Nudge the bars | ⌘ ⌥ ⇧ arrows |
| Script bar | ⌘ ⌥ S |
| Click-through on/off | ⌘ ⌥ X |
| Start or stop recording (asks first) | ⌘ ⌥ R |
| Transcript on/off (while the bars have focus) | ⌘ ⌥ T |
| Open Ask AI (any time the app runs) | ⌘ ⌥ K |

Send the developer the filled table, the macOS version and the chip (Apple or Intel). For any ❌, a screenshot that shows **no call content** (no transcript, answer or document text).

### Getting new versions

The app's own updater reads the Mac release channel, which the developer has not published yet, so for now it finds nothing (silently). To move to newer code:

```
cd ~/AI-Call-Assitant
git pull
```

then Part 6 (6.1 to 6.6) and Part 7.1 again. Your permissions and sign-in stay.

---

## Part 10. Use it in Chrome today (no desktop app)

This works now on the **live site**, on any Mac, with nothing to install. Checked in the code (20 Nov 2026): the live web app accepts Mac computers' Chrome and Edge, and hears the other side through a shared **Chrome tab with its audio**; Chrome on a Mac can share a tab without macOS's Screen Recording permission. Not yet tried on a real Mac by the team.

1. The meeting must run **in a Chrome tab** (Google Meet, or Zoom/Teams in the browser). On a Mac, the Zoom or Teams *apps'* sound cannot be shared from a browser; for those, use the desktop app.
2. In another Chrome tab go to **https://call.paramountintelligence.co** and sign in.
3. Open a session and click **Connect**. The first time, macOS asks whether **Google Chrome** may use the microphone: **Allow**.
4. In Chrome's share window, choose **Chrome Tab**, pick the **meeting tab**, turn on **Also share tab audio**, click **Share**.
5. **Expected:** "Them" (the meeting tab) and "You" (your microphone) are both transcribed.

Keys in the browser work **only while the Paramount AI tab is in front**:

| Action | Keys (live site today) |
|---|---|
| Answer | ⌘ ↵ |
| Answer from a screenshot (of the shared tab) | ⌘ ⇧ ↵ |
| Previous / next answer | ⌘ ← / → (⌃ ⌥ ← / → once the Mac work is live) |
| Clear answers | ⌘ ⌫ (⌃ ⌥ ⌫ once the Mac work is live) |

Not in the browser: the floating bars over other apps, keys that work from other apps, recording.

If the share has no sound, Paramount AI says so: click **Connect** again, pick the **tab** (not a window or the entire screen) and turn on **Also share tab audio**.

---

## Part 11. Troubleshooting

**Setup (Part 2)**

| You see | Do this |
|---|---|
| `xcode-select: note: install requested` but no window | Look behind other windows, or Apple menu  › System Settings › General › Software Update. |
| `node: command not found` or a version other than `v24` | Install Node 24 again (2.2), then quit and reopen Terminal. |
| `corepack enable` says permission denied | Use `sudo corepack enable` (your Mac password). |
| `pnpm: command not found` | `sudo corepack enable`, quit and reopen Terminal, `cd ~/AI-Call-Assitant`, `pnpm --version`. |
| git: `Repository not found` or `Authentication failed` | Accept the GitHub invitation; use the **token**, not your GitHub password. To re-enter it: `git credential-osxkeychain erase` then type `host=github.com`, `protocol=https`, press Return twice. |

**Certificate (Parts 3 and 5)**

| You see | Do this |
|---|---|
| `… already exists. Move it away first` (make-signing-cert) | A certificate was made earlier. Check the Drive folder before making another. Never make a second one without the developer. |
| `certificate.pem is not in the repository yet` | `git pull`; if still missing, the developer has not finished Part 4. |
| `the keychain already exists` | Part 5 was done before. To start again: `security delete-keychain "$HOME/Library/Keychains/paramount-signing.keychain-db"`, then Part 5 step 4 again. |
| `the .p12 holds a different certificate` | The file is not the company's certificate. Ask the lead. |
| `does not list the certificate as valid for code signing` | Open **Keychain Access**, pick the keychain **paramount-signing**, double-click the certificate › **Trust** › **Code Signing: Always Trust**, close (Mac password). Delete the keychain (row above) and run Part 5 step 4 again. |

**Build (Part 6)**

| You see | Do this |
|---|---|
| `stage-native` or `sherpa-onnx` says a `darwin-x64` or `darwin-arm64` package is missing | Run 6.2 again exactly as written (with `--cpu=arm64,x64`). |
| `Identity name is specified, but no valid identity with this name in the keychain` / `cannot find valid … identity` | The keychain is locked or not listed. Run 6.3, then check `security find-identity -v -p codesigning "$HOME/Library/Keychains/paramount-signing.keychain-db"` lists *Paramount Intelligence Internal Code Signing*. If not, redo Part 5. |
| A window: *"codesign wants to use the paramount-signing keychain"* | Type the *Build Mac signing keychain* password, click **Always Allow**. |
| `build.sh`: `the repository has uncommitted changes` | Run `git status`. If it lists `.claude/`, do Part 2.4 step 3. Otherwise ask the developer before discarding anything. |
| Any **FAIL** in verify-build | Stop; send the developer the whole output. |
| The build stops with a network error | Check the internet connection and run 6.4 again. |

**Install and open (Parts 7 and 8)**

| You see | Do this |
|---|---|
| *"Apple could not verify Paramount AI"* (a `.dmg` copied from another Mac) | Click **Done**, then System Settings › **Privacy & Security**, scroll to *"Paramount AI was blocked"*, **Open Anyway**, **Open**. |
| `zsh: no matches found` | The address was not inside quotes. Paste the command again with `"…"` around the address. |
| `open` does nothing new / still the old site | Paramount AI was already running, so macOS ignored the address. **⌘ Q**, then the command again. |
| The window stays **blank** on the preview | Preview protection is on, so the app cannot open the preview. Ask the developer to turn it off for the test (Part 4, D5). If the developer made a new preview, put its address in `~/.paramount-preview` (7.3, first line). |
| It shows the **live site**, not the preview | It was opened from the Dock or by macOS's **Quit & Reopen**. **⌘ Q**, then `paramount`. |
| Sign-in fails on the preview | Ask the developer (the preview may use other accounts than the live site). |
| The permission card still shows **Screen & System Audio Recording** after you allowed it | Quit with **⌘ Q** and reopen with `paramount` (macOS applies it only to a fresh start). Still there: in System Settings turn Paramount AI **off and on** again, quit and reopen. |
| Permissions are confused or were refused by mistake | Reset them, then reopen and allow again: `tccutil reset Microphone co.paramountintelligence.kite` and `tccutil reset ScreenCapture co.paramountintelligence.kite` (and on macOS 15+ also `tccutil reset AudioCapture co.paramountintelligence.kite`). |

**During a call (Part 9)**

| You see | Do this |
|---|---|
| Only "You" lines, no "Them" | Is the video playing with sound? Is Screen & System Audio Recording on (Part 8)? On macOS older than 14.2 the app says it needs 14.2: use Chrome (Part 10). |
| Only "Them" lines, no "You" | System Settings › Privacy & Security › **Microphone** › Paramount AI on; check the input device in System Settings › Sound › Input. |
| A key does nothing | **Settings › Hotkeys** shows "In use by another app" for keys another app holds (window tools such as Rectangle or Magnet use ⌃ ⌥ arrows; VoiceOver uses ⌃ ⌥). Quit that app or change its keys. |
| The bars disappear when the meeting goes full screen | Note it as ❌ in 9.5 and tell the developer, with the macOS version. |
| **⌘ Q** does not quit at once | A recording is still uploading; it finishes in the background (menu-bar icon). Press **⌘ Q** again and choose **Quit now** to stop it. |

**Still stuck?** In Terminal, `cd ~/AI-Call-Assitant && claude`, describe what you did and paste the error (never a password, the `.p12` or call content). Or send the developer the exact error text.

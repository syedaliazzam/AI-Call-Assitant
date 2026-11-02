# Final human test plan (Day 7)

**What this is:** the one human test pass for Kite, run once on Day 7 after the full implementation. It covers everything automation could not verify: real meetings, real audio, real hardware, phones, installing the app. Automated gates (unit, harness, e2e, evaluations) are not repeated here.

**Who runs it:** the developer, with a phone and, for one section, a second person or a second device in a meeting.

**How to use it:**
- Work through the areas in order; each step lists what to do and what you should see.
- Mark each step ✅ or ❌. For a ❌, write the step number and what you saw.
- Use invented session details and documents only. No real customer calls.
- **Cost:** a full pass sends about 30 answers and 3 notes requests (about $0.15 of the ~$20 monthly limit).

**Kept up to date:** each later stage adds its human checks here. Last updated: parity Phase 2 (session setup).

---

## First: install on a teammate's laptop (Smart App Control)

Do this before everything else: it decides whether Kite can ship unsigned. On the developer's laptop, Windows Smart App Control blocked an unsigned Kite build from starting (Code Integrity events 3033 and 3077, 2 Nov).

| # | Do | Expect / write down |
|---|---|---|
| F.1 | On a **teammate's** Windows 11 laptop, open **Windows Security → App & browser control → Smart App Control settings**. | Write down: **On**, **Evaluation** or **Off**. (Do not change it.) |
| F.2 | Download `Kite-Setup-<version>.exe` from the releases page and open it. | Write down exactly what Windows shows: nothing, the SmartScreen "Windows protected your PC" (then **More info → Run anyway**), or a Smart App Control block ("Part of this app has been blocked…"), which cannot be bypassed. |
| F.3 | If it installed, open Kite from the Start menu. | Write down whether it opens or is blocked. |
| F.4 | If Kite was blocked, follow the user guide's "If Windows blocks Kite" section (`docs/user-guide/install-windows.md`): turn Smart App Control off (with the IT lead's OK) and install again. | Kite installs and opens. Also check the guide's steps match what Windows shows. |
| F.5 | Send the developer the answers and a photo of any block message. | The v1 decision (2 Nov) is to turn Smart App Control off; the Microsoft Store route is post-v1 (`docs/deploy/microsoft-store.md`). |

## 0. Setup

| # | Do | Expect |
|---|---|---|
| 0.1 | Install the desktop app from the Windows installer (§9.1), then open it. | Kite opens on the production sign-in page with the Kite lockup. |
| 0.2 | On the laptop in Chrome, open the production URL. | The same sign-in page; the tab shows the Kite favicon. |
| 0.3 | Sign in with your own account in both. | The dashboard appears. |

## 1. Sessions and the live call (Day 3–4)

| # | Do | Expect |
|---|---|---|
| 1.1 | **New session:** Regular type, a few invented details, upload a short PDF of an invented price list. | The session opens; the document shows as chosen. |
| 1.2 | Start the call in the desktop app. Speak a sentence; play a YouTube interview for "Them". | "You" and "Them" lines appear separately; grey words turn final as you go. |
| 1.3 | Ask aloud (or play) a price question the document answers. Press **Answer**. | An answer streams within about 2 s; headline of 15 words or fewer, at most 5 bullets, figures from the document. |
| 1.4 | **Follow-up:** ask "What are the three phases of the rollout?", answer, then "How long does the second phase of that take?" and answer. | The second answer is about the second phase from the first answer, without asking which plan you mean. |
| 1.5 | Rate an answer thumbs up and another thumbs down with a short note. | Both ratings stay after reloading the page. |
| 1.6 | Look at the final transcript lines (live view, then the review page). | Sentence case: a capital first letter and "I"; your key terms and company spelled as you typed them (for example "Bluefin Route", "CRM"). |
| 1.7 | **Interview** session: say "we used RAG with embeddings in a vector database to cut latency". | RAG, embeddings, vector database and latency come out right more often than before (built-in technical vocabulary). |

## 1b. Session setup (parity Phase 2)

| # | Do | Expect |
|---|---|---|
| 1b.1 | Open a dashboard that held sessions before this update. | They are all there; Sales, Support and Internal ones now say Regular. Their answers and notes still open. |
| 1b.2 | **Create session** → **Mock**. | The wizard starts with Mock chosen. |
| 1b.3 | Paste the link of a real public job posting, press **Import**. | Company, role and job description fill in, and a line says what came in. Change one. Try two more job sites: some refuse, and Kite says so kindly. |
| 1b.4 | Paste `http://localhost` and press Import. | "Kite can only read public web pages." |
| 1b.5 | **Upload a resume**, choose a document from the list. In **Resumes**, delete that resume. | The session still answers from it, and Edit still lists it. |
| 1b.6 | Step 2 → **Answer preferences** → **Show preview** for each question type. Change the tone and look again. Change it back. | A preview appears within a few seconds; going back shows it at once. It reads like the format and tone chosen. |
| 1b.7 | **Set as default**, then create another session. | It starts with those preferences. |
| 1b.8 | Set the language to Spanish, then ask a question in a call. | The answer is in Spanish; the transcript stays English. |
| 1b.9 | During a call, in the overlay's menu, change the format. | The next answer uses it. |
| 1b.10 | On the Connect screen, read the summary sentence and open each app's how-to, on desktop and in Chrome. | The steps fit the platform and are correct. |
| 1b.11 | On the dashboard: tabs and their counts, search, sort, grid and list, rename, duplicate, delete. | Each works; the layout and sort are remembered after a reload; a duplicate has no transcript or answers. |

## 2. Desktop hotkeys

| # | Do | Expect |
|---|---|---|
| 2.1 | Open Notepad and click inside it. Make a "Them" line appear, press **Ctrl+Enter**. | Kite answers; Notepad keeps focus and nothing is typed into it. |
| 2.2 | With Notepad focused: **Ctrl+Shift+Enter**. | A screenshot answer about what is on screen (§4). |
| 2.3 | With Notepad focused: **Ctrl+Alt+H** twice. | The overlay hides, then comes back; Notepad keeps focus. |
| 2.4 | With Notepad focused: **Ctrl+Alt+Arrows**, then with **Shift**. | The overlay moves in small steps, then bigger ones. If Windows rotates the screen instead, your graphics driver holds these keys: Settings → Hotkeys should say so. Press Ctrl+Alt+Up to rotate back. |
| 2.5 | With Notepad focused: **Ctrl+Backspace**, **Ctrl+Left**, **Ctrl+Right**. | Notepad deletes and moves by word as usual: Kite does not take these keys. |
| 2.6 | Click the overlay, then **Ctrl+Shift+Backspace**, **Ctrl+Left**, **Ctrl+Right**, **Ctrl+Backspace**. | The Chat box opens and closes; earlier and later answers show; the answer clears. |
| 2.7 | Settings → Hotkeys. | Every shortcut is listed with where it works; any conflict is named. |

## 3. Overlay and screen-share protection

| # | Do | Expect |
|---|---|---|
| 3.1 | With **Start calls in the overlay** on (Settings; the default), press **Connect**, then **Go live**. | The overlay opens on top of other windows without taking focus; the main window minimises. |
| 3.2 | Look at the three bars during a call. | Mic and audio status; the latest words as chips; the answer card with its question line, answer line, bullets and any tip. Any private note sits apart and looks muted. |
| 3.3 | Press **Chat**, type "What are our next steps?", press Enter. | The answer streams into the card. |
| 3.4 | Rate an answer, copy it, and report it with a short reason. | The thumb stays lit; pasting gives the answer without the private note; the flag shows it is reported. |
| 3.5 | Use the ← and → buttons after two answers; **Clear** on the card and on the transcript bar. | History moves; the answer clears; only the words on screen clear, new ones still appear. |
| 3.6 | Press both expand buttons, then collapse. | One takes the space for the transcript, the other hides the transcript bar; collapse leaves only the controls. Only the card scrolls, never the whole window. |
| 3.7 | Menu: move the opacity slider, then move the pointer away and back. | The window gets more see-through and stays readable; with fading on, it is solid under the pointer. |
| 3.8 | Resize to the smallest size. | Nothing is cut off; button labels lose their shortcuts. |
| 3.9 | Press **End** in the overlay. | The call ends, the overlay closes, the main window comes back with the notes. |
| 3.10 | Menu: check **Hidden from screen share**. In Chrome start a Google Meet, join it from your phone, then on the laptop **Present now → Entire screen**. | — |
| 3.11 | Look at the shared screen on the phone. | The overlay is **not** visible (black or empty there); the rest of the screen is. |
| 3.12 | Turn it off in the menu; look at the phone. | The overlay **is** visible. Turn it back on. |
| 3.13 | In Chrome (browser Kite), start a call and press **Overlay**. | A picture-in-picture window with the same three bars; its menu says opacity works in the desktop app. |

## 4. Screenshot answers (Day 5)

**Evaluation check for the release run:** the `screenshots` group fell from 8.83 to 8.00 in parity Phase 1, right at its limit. Compare it in the `eval:all` run and read the saved grader reasons (`apps/web/eval-results/`).


| # | Do | Expect |
|---|---|---|
| 4.1 | Open an invented slide with numbers. In the desktop app press **Screenshot** (or Ctrl+Shift+Enter). | The answer is about the slide's numbers. Nothing is saved to disk. |
| 4.2 | In Chrome, share a tab with the same slide, press **Screenshot**. | The same kind of answer. |

## 5. Notes, review and lessons (Day 5)

| # | Do | Expect |
|---|---|---|
| 5.1 | Press **End**. | Notes appear: summary, questions, next steps, unclear parts, proposed lessons. |
| 5.2 | Open the session's review page. | Notes, answers with ratings, and the transcript. |
| 5.3 | **Edit** one proposed lesson to "Keep the headline under 10 words", then **Approve**. Reject another. | Approved shows; the rejected one is gone. |
| 5.4 | Open **Settings → What Kite has learned**. | The approved lesson is listed. |
| 5.5 | Create a new session of the same type, start it, ask a question. | The answer follows the lesson (headline under 10 words). |
| 5.6 | Back on the first review page press **Regenerate**. | New notes; your lesson decisions are kept. |
| 5.7 | Delete that session (in-app dialog). | Back on the dashboard; the session is gone. |
| 5.8 | Settings → **Clear all lessons**. | The list is empty. |

## 6. New speech engine (Day 6, only if adopted)

| # | Do | Expect |
|---|---|---|
| 6.1 | In the desktop app, start a call for the first time after the update. | The model downloads once with progress, then the call starts. |
| 6.2 | Read 10 sentences from the names list (`apps/web/tests/fixtures/stt/names-sentences.txt`). | Grey words are replaced with the final text within about a second; at least 8 of the 10 names come out right. |
| 6.3 | Settings → turn **Accurate transcription (desktop)** off, then on. | Off: the old engine only. On: the final replacement again. |

## 7. Error screens (Day 6 Stage 4)

| # | Do | Expect |
|---|---|---|
| 7.1 | During a call, turn Wi-Fi off for 20 s, press Answer, then turn it on. | A "No connection" banner: answers are paused, the transcript keeps going; Answer says so. The banner goes when Wi-Fi is back, and Answer works again. |
| 7.2 | Block the microphone (Windows privacy settings or the browser's site settings) and start a call. | A message saying the microphone is blocked and how to allow it. |
| 7.3 | Share a silent tab as "Them" for 20 s. | A message to check the right tab or app is shared. |
| 7.4 | Sign out in another tab (browser) during a call, then press Answer. | A "Signed out" box with **Sign in again**: a dialog over the call; after signing in, the call, transcript and answers are all still there and Answer works. Repeat in the desktop app by disabling and re-enabling your account from an admin account. |

## 8. Auto-answer (Day 6 Stage 4, beta)

| # | Do | Expect |
|---|---|---|
| 8.1 | Settings → Answers → turn **Auto-answer (beta)** on, then start a new call. Play "Them" asking "What does the plan cost?" and pause. | An answer starts by itself, marked **Auto**. |
| 8.2 | Ask two questions within 15 s. | Only the first is answered automatically. |
| 8.3 | Turn Auto-answer off. | Questions are no longer answered by themselves. |

## 9. Installer and updates (Day 6 Stage 3)

| # | Do | Expect |
|---|---|---|
| 9.1 | Run `Kite-Setup-<version>.exe`. If SmartScreen says "Windows protected your PC", click **More info → Run anyway** (the installer is not signed yet). | Installs without an admin prompt into `%LOCALAPPDATA%Programskite`; Start-menu shortcut "Kite"; the Kite icon on the taskbar. |
| 9.2 | When a new version is published, start Kite (or wait up to 6 hours). Also try during a live call. | Kite downloads it in the background and asks **Restart now / Later**; Later installs it when you quit. During a live call it does not ask until the call ends. |
| 9.3 | Uninstall from Windows Settings → Apps → Kite; answer **No** to "Keep your Kite data on this computer?". | No `kite` folder left in `%LOCALAPPDATA%Programs` or `%APPDATA%`. |
| 9.4 | Reinstall, sign in, create a session, uninstall answering **Yes** to "Keep your Kite data", reinstall. | The session is still on the dashboard. |

## 9b. Microsoft Store version (only if the Store route is used; docs/deploy/microsoft-store.md)

| # | Do | Expect |
|---|---|---|
| 9b.1 | Signed in to the Microsoft Store with your listed Microsoft account, open the private Store link and click **Get**. | Kite installs with no SmartScreen or Smart App Control warning. |
| 9b.2 | Start Kite from the Start menu and sign in. | The dashboard appears. |
| 9b.3 | Create a session, **Connect**: allow the microphone. | Windows asks once; **Settings → Privacy & security → Microphone** lists Kite; the You meter moves. |
| 9b.4 | Play a video for the other side (system audio). | The Them meter moves and Them lines appear. |
| 9b.5 | First call after installing: the speech model downloads. Close Kite, open it again, start another call. | The model is not downloaded again (kept inside the package's data). |
| 9b.6 | With Notepad focused, press **Ctrl+Enter**. | Kite answers; Notepad keeps focus. |
| 9b.7 | **Compact view**, then share the entire screen in Google Meet and look from your phone. | Hidden in screen share: not visible; Visible: visible. |
| 9b.8 | Leave Kite open for a day after a new Store version is published. | The Store updates Kite; Kite itself never shows its own Restart now / Later question. |
| 9b.9 | Uninstall from Windows Settings → Apps. | No question about keeping data; no Kite folder left in AppData. |

## 9c. Export and import your data (Day 6)

| # | Do | Expect |
|---|---|---|
| 9c.1 | In the **browser**: Settings → Local data → **Export my data**. | A warning: "This file contains your session documents and transcripts — keep it private."; after **Save file**, `kite-export-<date>.json` downloads and Settings says how many sessions it holds. |
| 9c.2 | In the **desktop app**: Settings → Local data → **Import data**, pick that file. | "Added N sessions…"; the dashboard shows them with their transcripts, answers and notes; their documents are there too (answers can use them). |
| 9c.3 | Import the same file again. | "Added 0 sessions… already on this computer"; nothing appears twice. |
| 9c.4 | Pick any other file (a photo, a random .json). | A clear message; nothing changes. |

## 10. Look and phones (UI U1–U4)

| # | Do | Expect |
|---|---|---|
| 10.1 | On the laptop click through Sign-in → Dashboard → New session → Documents → Settings → a review page → Admin (if admin). | The navy and cyan look throughout; nothing overlaps or is cut off. |
| 10.2 | Use only the keyboard (Tab, Enter) from sign-in to creating a session. | A cyan focus ring is always visible; everything can be reached. |
| 10.3 | On your phone, open the production URL and sign in. | Nothing scrolls sideways; buttons are easy to tap; fields don't zoom in when tapped. |
| 10.4 | On the phone, open a session's live page. | "Live calls need a computer" instead of the live view. |
| 10.5 | On the phone, open a review page. | Notes and transcript are readable. |

## 11. Admin (Day 1–2)

| # | Do | Expect |
|---|---|---|
| 11.1 | As admin, create an invented user, then sign in as them in a private window. | Asked to change the temporary password first. |
| 11.2 | Disable that user while they are signed in. | Within about a minute their next action sends them to sign-in. Delete the invented user afterwards. |

## 12. Subdomain (Day 7, only if the DNS change is made)

| # | Do | Expect |
|---|---|---|
| 12.1 | Open `https://kite.paramountintelligence.co`, sign in. | Works like the vercel.app address. |
| 12.2 | The desktop app (pointing at the subdomain) signs in and answers. | Works; no other address loads in the app. |

## 13. macOS (only if a Mac is available)

Follow `docs/testing/macos-checklist.md` (Day 6 Stage 6).

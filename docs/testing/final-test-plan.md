# Final human test plan (Day 7)

**What this is:** the one human test pass for Kite, run once on Day 7 after the full implementation. It covers everything automation could not verify: real meetings, real audio, real hardware, phones, installing the app. Automated gates (unit, harness, e2e, evaluations) are not repeated here.

**Who runs it:** the developer, with a phone and, for one section, a second person or a second device in a meeting.

**How to use it:**
- Work through the areas in order; each step lists what to do and what you should see.
- Mark each step ✅ or ❌. For a ❌, write the step number and what you saw.
- Use invented session details and documents only. No real customer calls.
- **Cost:** a full pass sends about 30 answers and 3 notes requests (about $0.15 of the ~$20 monthly limit).

**Kept up to date:** each later stage adds its human checks here. Last updated: responses and speech — honesty, answer shape, admin rollback and number key terms (ADR-0032, §6b). v1.1.0 (ADR-0041 to ADR-0044): the home panel, the bars and panels, Private on every window, Auto for accurate transcription.

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

## 1c. The home panel (v1.1.0, ADR-0041)

| # | Do | Expect |
|---|---|---|
| 1c.1 | Start the desktop app. | A small panel opens, about 400 wide: your sessions, newest first. The first time on this computer, the acceptable-use notice shows once. |
| 1c.2 | Type in the search box, then press the sort button. | The list filters, then turns round. |
| 1c.3 | Look at an ended session and a ready one. | Ended: status, length and **View transcript**. Ready: **Start**. |
| 1c.4 | Drag the header, drag an edge, quit Kite and start it again. | It moves and resizes, and comes back where you left it. |
| 1c.5 | **⋮**: Zoom + and −, each Theme, Private's info mark. | The panel follows at once. The tooltip says all of Kite's windows, and that it does nothing against monitoring tools. |
| 1c.6 | **View in dashboard**, then **Create session**. | A larger window opens the dashboard, then the wizard. The panel stays. |
| 1c.7 | Press **×** on the panel with the larger window open, then close the larger window. | The panel steps aside, then comes back. **×** with nothing else open quits Kite. |

## 2. Desktop hotkeys

| # | Do | Expect |
|---|---|---|
| 2.1 | Open Notepad and click inside it. Make a "Them" line appear, press **Ctrl+Enter**. | Kite answers; Notepad keeps focus and nothing is typed into it. |
| 2.2 | With Notepad focused: **Ctrl+Shift+Enter**. | A screenshot answer about what is on screen (§4). |
| 2.3 | With Notepad focused: **Ctrl+Shift+Space**. | Chat opens in bar 1 with the keyboard, ready to type. |
| 2.4 | With Notepad focused: **Ctrl+Alt+H** twice. | The bars hide, then come back; Notepad keeps focus. |
| 2.5 | With Notepad focused: **Ctrl+Alt+Arrows**, then with **Shift**. | The bars move in small steps, then bigger ones. If Windows rotates the screen instead, your graphics driver holds these keys: Settings → Hotkeys should say so. Press Ctrl+Alt+Up to rotate back. |
| 2.6 | With Notepad focused: **Ctrl+Backspace**, **Ctrl+Left**, **Ctrl+Right**, **Ctrl+Shift+Backspace**. | Notepad deletes and moves by word as usual: Kite does not take these keys. |
| 2.7 | Click the bars, then **Ctrl+Left**, **Ctrl+Right**, **Ctrl+Backspace**, **Ctrl+Shift+Backspace**. | Earlier and later answers show; the card goes back to the newest answer; the words on screen clear. |
| 2.8 | Settings → Hotkeys. | Every shortcut is listed with where it works; any conflict is named. |

## 3. The bars and panels, and Private (v1.1.0, ADR-0041, ADR-0042)

| # | Do | Expect |
|---|---|---|
| 3.1 | Press **Start** on a card, then **Connect** and **Go live**. | Slim bars open at the top centre, without taking focus. The larger window minimises and the panel steps aside. |
| 3.2 | Look at bar 1. | Sound and microphone status with a red dot; **▾**; Answer, Screenshot and Chat with their keys; move, collapse, **⋮**, and a timer. |
| 3.3 | Press **▾**, choose another microphone, and keep talking. | The "You" lines carry on from the new microphone. |
| 3.4 | Hover the timer, press it, then **Cancel**; press it again and confirm. Do this at the very end. | "End call", then a confirmation. The call ends, the bars close, the panel comes back with the notes. |
| 3.5 | Look at bar 2 while you both talk. | Level bars move; chips show the latest words with no "um" or "so" at the start. While they ask something, it shows highlighted. |
| 3.6 | Press **⤢**. | The transcript panel replaces bar 2: Language, Clear, collapse; you on the right, them on the left with their name or "Client 1", and "Name · time" under each. |
| 3.7 | Scroll up in it while they talk, then press **Jump to latest**. | It stops following while you read, and then catches up. |
| 3.8 | Make a question appear. Press **Answer this** on it, and hover a greeting. | It answers that question. A greeting shows Answer this only under the pointer. |
| 3.9 | Press **Answer** (**Ctrl+Enter**). | The answer panel opens by itself, with the question at once, **Thinking…** and **Stop**, then the answer line, bullets and any Tip. |
| 3.10 | Rate an answer, copy it, and report it with a short reason. | The thumb stays lit; pasting gives the answer without the private note; the flag shows it is reported. |
| 3.11 | Open both panels; drag the bottom edge; close and reopen the overlay in a new call. | Transcript above answer; the height sticks; the panels open as you left them. |
| 3.12 | **⋮ → Opacity** down to its minimum over a light, a dark and a busy page; **Font size**. | Only the background gets more see-through; the text stays solid and readable. Text size changes in both panels. |
| 3.13 | Drag the bars by the move handle. | Three places light up along the top; the one under the pointer stands out; dropping there snaps the bars to it. Move them on a second screen, and each screen remembers its own place. |
| 3.14 | **⋮ → Dashboard** and **Edit session** during a call. | A window of its own opens; the call keeps going. |
| 3.15 | **⋮ → Open call window**, then **Back to compact**. | The full view shows and the bars hide, then the reverse. Closing the full view's window during a call only minimises it. |
| 3.16 | **⋮ → Private** on. In Chrome start a Google Meet, join it from your phone, then on the laptop **Present now → Entire screen**. Open each of Kite's windows in turn: bars and panels, the call window, the panel, Ask Kite, a side window. | — |
| 3.17 | Look at the shared screen on the phone. | **None** of Kite's windows is visible; the rest of the screen is. Kite is still in the taskbar. |
| 3.18 | Turn Private off in Settings; look at the phone; check both **⋮** menus. | Kite's windows **are** visible, and every menu agrees it is off. |
| 3.19 | Connect, then leave the call silent for 10 minutes, then 30. | "Still in a call?" with **Yes**; then listening pauses with **Resume**, which starts it again without asking for the microphone. |
| 3.20 | Use speakers and let the other side talk. | Echoed lines stay hidden, and a hint suggests headphones, once. |
| 3.21 | In Chrome (browser Kite), start a call and press **Back to compact**. | A picture-in-picture window with the same bars and panels, on a solid background. |

## 3b. Browser split call view (live-ui-split)

In Chrome, on a laptop (1280 px or wider), start a call sharing a real tab (for example a YouTube video).

| # | Do | Expect |
|---|---|---|
| 3b.1 | Look at the call screen. | Left: the shared tab plays as a live preview with a translucent control strip on top (Stop with a mic dot, Clear, Language, Change tab, Minimize) and the transcript below it in bubbles, oldest at the top. Right: the answers as cards, the message box and the big Answer and Screenshot buttons. Across the top: the microphone, Answer, Screenshot, Chat, the timer, Back to compact, ⋮ and End. |
| 3b.1a | ⋮: Theme, Larger text, Smaller text, Auto answer, Edit session. | Each works. Edit session opens in a new tab, and the call keeps going. |
| 3b.2 | Drag the divider between the halves, then reload. | The halves resize; the position is remembered after the reload. |
| 3b.3 | Narrow the window below 1280 px (or open on a phone). | The two halves stack, the preview above the answers; no divider. |
| 3b.4 | Press **Change tab** and pick a different tab. | The preview and the transcript follow the new tab; the call, answers and transcript so far are kept (the call does not end). |
| 3b.5 | Change **Language** to Spanish, then press **Answer**. | The next answer is in Spanish; the transcript stays English. |
| 3b.6 | Press **Clear** on the control strip. | The transcript on screen clears; new lines still appear. The answers are untouched. |
| 3b.7 | Press **Minimize**, then the side arrow. | Minimize opens the picture-in-picture overlay; the side arrow collapses the answers panel, leaving the preview the whole width. |

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

## 5b. The session window (parity Phase 3)

| # | Do | Expect |
|---|---|---|
| 5b.1 | Open a finished call. Use the side menu. | AI notes, Transcript, Ask AI and Call details each show their own content. |
| 5b.2 | Read the transcript. | Them on the left, You on the right, Kite's answers inline at the right moments. |
| 5b.3 | Rate an answer, then report it with a short reason. Reload. | Both stay. |
| 5b.4 | **Download TXT** and **Download PDF**; open both. | Same content, readable, no private notes. Each opens in Notepad and in a PDF reader. |
| 5b.5 | Ask AI: "What did they ask about?", then a follow-up, then something the call never covered. | Short answers from the call; the follow-up understands the first question; the last says it is not there. |
| 5b.6 | **Clear transcript**: cancel once, then confirm. | Only the transcript goes; answers and notes stay. |

## 5c. Prepare tools (parity Phase 4)

| # | Do | Expect |
|---|---|---|
| 5c.1 | **Mock Interview**: choose an Interview session with a real-looking job description and resume, in the desktop app, wearing headphones. | The questions fit the job and resume. Each is read aloud; a voice you can understand. |
| 5c.2 | Answer two questions out loud. | "What Kite heard" follows you, and your answer is not mixed with Kite's voice. The feedback is short and about what you said. |
| 5c.3 | Do the same in Chrome, with speakers instead of headphones. | The question's sound does not show up as your answer. |
| 5c.4 | Finish, then **Review this interview**. | A Mock session: the questions and answers as a chat, feedback inline, the summary in AI notes. It is on the dashboard as Ended. |
| 5c.5 | Refuse the microphone (browser setting), then start again. | Kite says so, and typed answers work. |
| 5c.6 | **Question Bank**: write one for an Interview session. Open answers. Leave and come back. | Questions by type; answers in your format, with nothing made up (gaps in square brackets). It shows again at once, with no waiting. |

## 5d. Ask Kite and answer quality (ADR-0030)

| # | Do | Expect |
|---|---|---|
| 5d.1 | During a call, with lines arriving, look at the live view and at the overlay's expanded transcript. | The newest line is at the top. There is no "Jump to latest" button. |
| 5d.2 | Scroll down in the transcript while lines keep arriving. | Your place stays put. Scrolling back to the top shows the newest. |
| 5d.3 | Open the finished call's Transcript. Look at **Conversation** and **Answers**; press a **Kite answered** chip; untick **Oldest first** and reload the page. | Oldest first by default, the speaker above each turn; the chip opens the answer in place; Answers lists the cards; a session with two calls has a divider; the choice survives the reload. |
| 5d.4 | In a call, press **Chat** and type "what is 17% of 2,340?" on Auto. | A private answer with the working, marked "Just for you". It appears nowhere as a "You" line. |
| 5d.5 | Type "what should I say to their last question?" on Auto. | A speakable first-person answer. |
| 5d.6 | Set the switch to **Ask Kite**, close and reopen the session. | Still on Ask Kite. Set it back to Auto. |
| 5d.7 | Have them ask a coding question ("write a function that reverses a list"), then press Answer. | Approach, steps, complexity, edge cases, a code block with **Copy code**, and a "Say" line; in Python by default. Readable in the overlay at its smallest size. |
| 5d.8 | Settings → Answers: change the coding language to JavaScript, then repeat 5d.7 in a new call. | The code is JavaScript. Set it back. |
| 5d.9 | On that answer card, change the type from the small muted label to "System design". | A new answer in the design shape. |
| 5d.10 | Ask something your CV does not cover. Then switch Settings → "When your CV has no example" to **Full example story** and ask again in a new call. | Never "not in your notes" or similar. First: "I would…" with specific steps. Then: a generic story tagged **Example**. |
| 5d.11 | Ask for a price your documents do not have. | No figure; a natural offer to confirm. If any figure appears, it is underlined with **Check before saying**. |
| 5d.12 | Ask the same question twice in one call. | The same figures and nearly the same words. |
| 5d.13 | Open **Ask Kite** in the sidebar. Ask something, attach a resume, then attach a past session; paste a screenshot with Ctrl+V. | Answers use them. The chat is still there after a reload. The screenshot shows "not kept". |
| 5d.14 | With another app in front and no call on, press **Ctrl+Alt+K** in the desktop app. | Kite comes forward on the Ask Kite page. |
| 5d.15 | Press **Ctrl+Alt+K** during a call. | The call keeps running; the overlay's chat box opens set to Ask Kite. |
| 5d.16 | Settings → Hotkeys. If another app holds Ctrl+Alt+K, it says so. | "Open Ask Kite" is listed as "Any app". |

## 6. Accurate transcription (beta) — v1.0.1, ADR-0034

ADR-0027 adopted nothing as the default engine; v1.0.1 adds Parakeet as a **second pass** (desktop app only). v1.1.0 (ADR-0044) adds **Auto**, the default: on when plugged in, off on battery, once the model is downloaded. Kite never starts the download by itself. Do these once on Windows:

| # | Step | Expected |
|---|---|---|
| 6.1 | Desktop app → Settings → Transcription. | It is on **Auto**. With no model downloaded, nothing downloads by itself, and the home panel offers it once. |
| 6.2 | Press **Download**. | A download starts (about 661 MB) with a progress line. |
| 6.3 | Quit Kite halfway, start it again, open Settings → Transcription. | It shows the bytes already done; **Download** continues from there, not from zero. |
| 6.4 | Let it finish. | "The accurate engine is downloaded and ready." |
| 6.5 | Start a call; say a sentence with names from your key terms. | The line appears as before; about a second later its words change to the improved text (mixed case, punctuation). |
| 6.6 | On **Auto**, unplug during a call, then plug in again. | On battery the lines keep the live engine's words, with marks from the punctuation pass; plugged in they are improved again. |
| 6.7 | Set it to **Off**; start a call. | The live engine's words stay, with marks and capitals. Set to **On**, they are improved on battery too. |
| 6.7a | A key term the engine tends to mishear. | It is spelled as you wrote it. |
| 6.8 | Settings → **Delete the download**. | The model is removed; the setting can download it again. |
| 6.9 | Open Kite in Chrome → Settings → Transcription. | It says the setting needs the desktop app. |

## 6b. Responses and speech (Part 1 — responses-and-speech)

| # | Do | Expect |
|---|---|---|
| 6b.1 | **Honesty:** Interview session with a short CV (for example "packaged three Python services in Docker"). Ask about a detail the CV does not give ("what was your rollback strategy and how long did deploys take?"), press Answer. | The CV project is kept as written; extra depth is given as the approach ("I'd typically…"), with no invented tool, number, team size or result. |
| 6b.2 | **Answer length:** a Balanced (medium-length) session; ask a broad question. | The answer is a full reply of about 20–40 seconds to say (one line + 2–4 bullets), not a bare line and not a ramble. |
| 6b.3 | **Behavioural:** ask "tell me about a time you led a difficult migration". | A short STAR answer built from the closest real CV project, with no result invented if the CV states none. |
| 6b.4 | **Rollback (admin):** Settings → Answers → set **Answer style version** to **v-previous**, reopen a session and ask a question. Then set it back to v-current. | The setting shows only for an admin. On v-previous the answers follow the earlier style; on v-current the new style. A non-admin never sees the switch. |
| 6b.5 | **Number key terms:** add key terms "BM25", "H100" and "2026"; in a call say a sentence containing each. | The transcript shows them spelled as typed ("BM25", "H100", "2026"), not as "BM", "H" or spelled-out words. |
| 6b.6 | **Stuck-transcript guard:** if a call ever shows audio meters moving but the transcript stays frozen for about 8 s. | Kite shows "Transcription restarted" and the transcript resumes without the call ending. (Hard to force on purpose; note it if it happens.) |

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

# Final human test plan (Day 7)

**What this is:** the one human test pass for Kite, run once on Day 7 after the full implementation. It covers everything automation could not verify: real meetings, real audio, real hardware, phones, installing the app. Automated gates (unit, harness, e2e, evaluations) are not repeated here.

**Who runs it:** the developer, with a phone and, for one section, a second person or a second device in a meeting.

**How to use it:**
- Work through the areas in order; each step lists what to do and what you should see.
- Mark each step ✅ or ❌. For a ❌, write the step number and what you saw.
- Use invented session details and documents only. No real customer calls.
- **Cost:** a full pass sends about 30 answers and 3 notes requests (about $0.15 of the ~$20 monthly limit).

**Kept up to date:** each later stage adds its human checks here. Last updated: Day 6 Stage 4f.

---

## 0. Setup

| # | Do | Expect |
|---|---|---|
| 0.1 | Install the desktop app from the Windows installer (§9.1), then open it. | Kite opens on the production sign-in page with the Kite lockup. |
| 0.2 | On the laptop in Chrome, open the production URL. | The same sign-in page; the tab shows the Kite favicon. |
| 0.3 | Sign in with your own account in both. | The dashboard appears. |

## 1. Sessions and the live call (Day 3–4)

| # | Do | Expect |
|---|---|---|
| 1.1 | **New session:** sales type, a few invented details, attach a short PDF of an invented price list. | The session opens; the document shows as ready. |
| 1.2 | Start the call in the desktop app. Speak a sentence; play a YouTube interview for "Them". | "You" and "Them" lines appear separately; grey words turn final as you go. |
| 1.3 | Ask aloud (or play) a price question the document answers. Press **Answer**. | An answer streams within about 2 s; headline of 15 words or fewer, at most 5 bullets, figures from the document. |
| 1.4 | **Follow-up:** ask "What are the three phases of the rollout?", answer, then "How long does the second phase of that take?" and answer. | The second answer is about the second phase from the first answer, without asking which plan you mean. |
| 1.5 | Rate an answer thumbs up and another thumbs down with a short note. | Both ratings stay after reloading the page. |
| 1.6 | Look at the final transcript lines (live view, then the review page). | Sentence case: a capital first letter and "I"; your key terms and company spelled as you typed them (for example "Bluefin Route", "CRM"). |
| 1.7 | **Interview** session: say "we used RAG with embeddings in a vector database to cut latency". | RAG, embeddings, vector database and latency come out right more often than before (built-in technical vocabulary). |

## 2. Desktop hotkeys (Day 4)

| # | Do | Expect |
|---|---|---|
| 2.1 | Open Notepad and click inside it. Make a "Them" line appear, press **Ctrl+Enter**. | Kite answers; Notepad keeps focus and nothing is typed into it. |
| 2.2 | With Notepad focused: **Ctrl+Shift+Enter**. | A screenshot answer about what is on screen (§4). |
| 2.3 | With Notepad focused: **Ctrl+Left**, **Ctrl+Right**, **Ctrl+Backspace**. | Previous answer, next answer, answers cleared. |

## 3. Compact window and screen-share protection (Day 5)

| # | Do | Expect |
|---|---|---|
| 3.1 | In the live view press **Compact view**. | A small window opens on top of other windows, without taking focus. |
| 3.2 | Click **Type a question**, type "What are our next steps?", press Enter. | The answer's headline streams into the compact window. |
| 3.3 | Click the answer to expand the details, then click again. | Details show, then collapse. |
| 3.4 | Check the compact window's toggle says **Hidden from screen share**. In Chrome start a Google Meet, join it from your phone, then on the laptop **Present now → Entire screen**. | — |
| 3.5 | Look at the shared screen on the phone. | The compact window is **not** visible (black or empty there); the rest of the screen is. |
| 3.6 | Switch the toggle to **Visible in screen share**; look at the phone. | The compact window **is** visible. Switch it back to hidden. |
| 3.7 | In Chrome (browser Kite), start a live call and open the compact view. | A picture-in-picture window with the latest answer and an Answer button. |

## 4. Screenshot answers (Day 5)

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
| 7.1 | During a call, turn Wi-Fi off for 20 s, then on. | A clear "connection lost" message; the transcript keeps going; answers resume. |
| 7.2 | Block the microphone (Windows privacy settings or the browser's site settings) and start a call. | A message saying the microphone is blocked and how to allow it. |
| 7.3 | Share a silent tab as "Them" for 20 s. | A message to check the right tab or app is shared. |
| 7.4 | Sign out in another tab during a call, then press Answer. | Asked to sign in again; after signing in the session and transcript are still there. |

## 8. Auto-answer (Day 6 Stage 4, beta)

| # | Do | Expect |
|---|---|---|
| 8.1 | Settings → Answers → turn **Auto-answer (beta)** on, then start a new call. Play "Them" asking "What does the plan cost?" and pause. | An answer starts by itself, marked **Auto**. |
| 8.2 | Ask two questions within 15 s. | Only the first is answered automatically. |
| 8.3 | Turn Auto-answer off. | Questions are no longer answered by themselves. |

## 9. Installer and updates (Day 6 Stage 3)

| # | Do | Expect |
|---|---|---|
| 9.1 | Run the installer. If SmartScreen warns, **More info → Run anyway**. | Installs without an admin prompt; Start-menu shortcut "Kite"; Kite icon on the taskbar. |
| 9.2 | Install the next beta when it is published (or let the app update on start). | The app downloads in the background and asks to restart; it never restarts during a call. |
| 9.3 | Uninstall from Windows Settings → Apps, without "keep my local data". | No Kite folder left in AppData or Program Files. |
| 9.4 | Reinstall, run a session, uninstall **with** "keep my local data", reinstall. | The earlier session is still there. |

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

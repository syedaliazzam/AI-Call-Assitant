---
title: "Kite — Architecture and 7-Day Build Plan"
version: "4.5.0"
status: "Current: the single document the team builds from"
date: "2026-11-09"
supersedes: "v3.0 (sign-in changed to admin-created email + password accounts, ADR-0022)"
authoritative_source: "docs/architecture/kite-architecture-v3.1.md"
doc_label: "ARCHITECTURE AND BUILD PLAN"
header: "Kite v3.5.0 · architecture and build plan"
page_breaks: "1,3,5,7,9,11,13"
---

# Kite: Architecture and 7-Day Build Plan v3.5.0

## Document control

| Field | Value |
|---|---|
| Version | 4.5.0, **Current**: the only document to build from |
| Changes in 4.5.0 | **Call quality, Phase 3** (ADR-0064; web only). §6.1 step 2: the **coupling gate** in the speech worker (`core/stt/coupling.ts`): it learns how late and how loud the other side comes back on the microphone (laptop speakers) from the two channels' loudness, and silences a "You" chunk that echo fully explains; the user talking over them passes; with headphones nothing is learnt. A "You" chunk waits at most one step for its reference. Measured on the synthetic speakers call: right-channel words 91% → 100%, "You" WER 49% → 5%. A line of listening sounds with one stray word ("um … O K") is a blip; the other side's "mm-hm" is never part of their next question. |
| Changes in 4.4.0 | **Call quality, Phase 2** (ADR-0063; web only). §11: the **synthetic call harness**: `calls:make` builds a three-minute two-voice interview (Windows text-to-speech) in four variants (headphones, speakers, reverse echo, noise); `stt:calls` plays it through the real speech worker in Chromium at real time and replays the lines through the transcript and auto-answer code on a simulated clock, scoring right-channel words, WER, noise lines, split questions, whole/duplicate/non-question answers and answer delay against the script, for this checkout or another (`--src`, a baseline). §7.5 (found by it): the user's grey words no longer hold auto-answer back; the other person's "mm-hm" is never more of the question; §6.1: a "Them" line that started over 0.5 s after a "You" line is never that line's original; the user's own echo on "Them" needs 0.6 (0.5 overlapping) and must end after the user's words; one-word "Them" noise while the user talks is hidden. |
| Changes in 4.3.0 | **Call quality, Phase 1** (ADR-0062; web only, no desktop release). §6.1 step 2: the speech worker passes each final line's confidence (`LineConfidence`, from sherpa-onnx `ys_probs`); a line that is very likely another language is stored, shown and sent as "[non-English speech]" (`core/stt/language.ts`) and is never a question; a lone "a", "and", "the"… is dropped as noise; the desktop loopback track asks for no echo cancellation, noise suppression or auto gain (`DESKTOP_DISPLAY_OPTIONS`). A line joins the same speaker's previous line across the other person's blips (`core/transcript/blip.ts`), after up to 4 s when it sounds cut off (`complete.ts`, `merge.ts` `mergeGapFor`); turns show blips after the turn. Echo: sound-alike words, one- and two-word echoes inside "Them" speech, 50% inside "Them" speech, and the user's own voice coming back on "Them" (hidden, `hiddenAs: 'you-echo'`). §6.1 step 3: talk about the call is a line kind (`meta`) that is never answered; a remark looks back to the last real question; a request worded as a statement is a question. §7.5: auto-answer answers the question window with adaptive pauses and reruns on the same card; no 15 s limit. Headphones hint when the output is speakers (`Platform.outputKind`). `docs/testing/calls/` is git-ignored. |
| Changes in 4.2.0 | **Release 1.3.2.** §5, §7.3: **typing behind the open panels** (ADR-0061). The panels are as tall as their content and the page sends `OverlayLayout.contentHeight`; a 1.3.2 shell fits the window to it (`fittedHeight`), so the space beside a shorter panel passes clicks through. A click on a panel button gives the keyboard back to the app behind (`releaseOverlayFocus`, IPC `kite:overlay-release-focus`, a blur while the overlay has focus). New global shortcut Ctrl+Alt+X and ⋮ switch **Click-through**: everything but the bars passes the mouse through; bar 1 shows "Click-through on". §5, §7.4: **the transcript reads like an Otter export** (ADR-0061): turns (`core/transcript/turns.ts`: same speaker, pauses up to 8 s) headed "<name>  <mm:ss>", the account's display name for You (`AccountNameProvider`), the session's renamable name for Them (Review; synced). Answers record `sourceLineId` and sit right after the turn they answered in Review, TXT and PDF ("Paramount AI answered  <mm:ss>", Question, Answer). The logo and desktop icons are the green parrot (ADR-0060). |
| Changes in 4.1.0 | **Release 1.3.1.** §9.1: a green accent (`#16A34A`, text `#15803D`), strong text, the card inner grey, the dark compact view's white text, `#A1A1AA` muted and `#22C55E` indicators, the desktop cards' glow and dot texture, and motion tokens that "reduce motion" turns off (ADR-0058). §7.3, §10: the streaming speech model (204 MB) ships in the desktop installer with a SHA-256 manifest; the shell answers the model's exact addresses from it through a `kite-model:` scheme (checked on first use; a missing or damaged file still downloads), the launcher prepares the model in the background, and the Speech model needed dialog is gone (ADR-0059). The 661 MB accurate model is still downloaded on demand. |
| Changes in 4.0.0 | **Release 1.3.0 is live for everyone (9 Nov 2026).** Call data lives in the account for every user (ADR-0049; `KITE_SYNC_USERS=*` in Production; the switch's code stays until 16 Nov 2026 as a kill switch, then the classic path is removed). One dashboard in the browser; the desktop app is Your sessions → Start → Connect and the overlay (ADR-0051, ADR-0053, ADR-0055); desktop link codes (ADR-0052); six overlay positions (ADR-0056); the reference typography (ADR-0057). Desktop 1.3.0 is the Latest release. Sign-in forms post and wait for hydration (PR #32). |
| Changes in 3.28.0 | §5, §7.3: **the overlay has six positions** (ADR-0056), a 2 × 3 grid 16 DIPs inside the display's work area (`apps/desktop/src/positions.ts`). Ctrl+Alt+Left / Right jump within the row, Ctrl+Alt+Up / Down to the top or bottom row, Ctrl+Alt+Shift+Arrows nudge; dragging shows six zones and snaps to the nearest; the ⋮ menu has a Position grid; the last position is remembered per display. On the bottom row the window is anchored at its bottom edge and the page mirrors itself (panels and menus above the bars), told by `kite:overlay-position-changed`. New bridge methods `getOverlayPosition`, `setOverlayPosition`, `onOverlayPosition`. Ctrl+Alt+T toggles the transcript while the bars have focus. |
| Changes in 3.27.0 | §4, §5, §7.3: **the desktop flow and call UI match the reference** (ADR-0055), behind the accountSync switch. The desktop app has no dashboard: `AppShell` keeps only the call page; other pages open in the browser. The home panel is a frame (logo, Buy credits on Start and Connect, compact, move, ⋮, close) with one card: Your sessions (all, the browser's first) → Start your session (Free / Paid tiles; Buy credits only shows a toast, no payments) → Connect Call Session (System audio, tips, a speech model dialog). Connect asks the main window's live page to start the call (`core/live/callStart.ts`: a 60 s localStorage note and a BroadcastChannel); desktop 1.3.0 opens that window minimised (`openCallWindow`) and sizes the panel 560 × 720 (`sizePanel`). Bar 1 gets a Transcript pill; the bars are 900 wide; the chat bar is the reference's. The overlay's `data-gap` boxes pass clicks through in 1.3.0 (`setOverlayClickThrough`). Private: every window as it is created, `<select>` lists in the page and no native tooltips in the desktop app. The logo is the company mark `images/logo-mark.png` (BRAND_LOGO_SRC), one swappable file. |
| Changes in 3.26.0 | §5: **two themes** (ADR-0054). The dashboard (web pages, home panel; `kite.theme`) is Light until chosen; the call (compact view, call windows; `kite.callTheme`) is Dark until chosen. Each menu changes its own. Web only. |
| Changes in 3.25.0 | §3.3, §5, §7.2, §7.3: **desktop 1.3.0 and link codes** (ADR-0052). Desktop app in the browser asks `POST /api/desktop/link-code` for a one-time code (32 random bytes, 60 s, once; only its SHA-256 stored, in Better Auth's `verification` table; 10 a minute) and opens `paramountai://session/<id>/<code>`. The 1.3.0 shell keeps the code in memory, loads `/desktop/link` (open to signed-out visits), and gives the code once through `consumeLinkCode()` (IPC `kite:link-code`); the page peeks (`/api/auth/desktop-link/peek`), asks before switching accounts, and redeems (`/api/auth/desktop-link/redeem`: one atomic delete, a session of the app's own). The start card says "Signed in as …" and pulls a session it does not have yet. The session file hand-off is gone (web, with account sync; shell from 1.3.0: `pickHandoffFile`, `deleteHandoffFile` and their channels removed, `handoff.ts` → `links.ts`). A 1.2.0 shell ignores a link with a code; the browser page says how to update. |
| Changes in 3.24.0 | §5 (Home panel): **one dashboard, and a launcher in the desktop app** (ADR-0051), behind the accountSync switch. `/home` lists the account's ready sessions with Start, "Call ended · View notes" for a call in the last 2 hours, and Open dashboard; no search, create, card menu or dashboard pages. Open dashboard, View notes, Dashboard ↗, Get help and Edit session open the web app in the system browser (the custom domain from the desktop's `vercel.app` address). Web only: 1.2.0 shells get it. |
| Changes in 3.23.0 | §5 (Dashboard, Home panel), §7.1 (`core/sync/legacyUpload.ts`): **the one-time upload** (ADR-0049), behind the accountSync switch. When this device's own `kite` database holds data, the dashboard and the home panel ask "This computer has N sessions that aren't in your account yet. Add them to <email>?" (Add / Not now). Add inserts each session with its documents, lines, answers, notes and question bank, then lessons, library items, chats and the defaults, only where the account has none with that id ("N added, K were already there"); lessons with the same wording key and library items with the same kind, name and text are skipped; `kite` is only read. Once every session is in the account, it is not asked again on that address. Each web address and the desktop app ask for their own data. |
| Changes in 3.22.0 | §7.1, §7.4: **account sync on the device** (ADR-0049), behind the accountSync switch: a per-account IndexedDB cache (`kite-u-<id>`, schema version 9 adds `outbox`, `syncRevs`, `syncMeta`), changes recorded in the same transaction as the change (a Dexie middleware), pushes 2 s after a change and transcript lines every 15 s or 50 lines, held while an answer streams, pulls on open, focus and reconnect only, a keepalive push when the page closes, a flush at End; Settings offers "Delete all my data" for synced accounts. Accounts without the switch keep `kite` and see no change. No desktop release. |
| Changes in 3.21.0 | §7.2, §8.1: **call data in the account, server side** (ADR-0049): table `call_record` (additive migration `0002_call_records.sql`), the `/api/sync/*` routes and AES-256-GCM encryption, all behind the accountSync switch (`KITE_SYNC_USERS`); nothing uses them yet. **One production database with write guards** (ADR-0050): database-writing scripts need `--prod`; migrations are additive only. No desktop release. |
| Changes in 3.20.0 | §5 (Connect, overlay), §7.1 (`core/audio/micPreview.ts`): **Connect starts the call** (ADR-0053). The sound check and "Go live" are removed. Connect opens the overlay first, inside its click (measured in Chrome 156: the share picker still opens after picture-in-picture used the click), then the capture, then the live view. The microphone's level shows on the Connect card before the call. Web only; no desktop release. |
| Changes in 3.19.0 | §2 (F2), §7.4: the company field suggests from past sessions and Brandfetch, and session cards show logos, with an off switch in Settings → Privacy (ADR-0048). The browser talks to Brandfetch directly; a picked company's name and domain are kept on the device. No desktop release. |
| Changes in 3.18.1 | §10.2, §14: the desktop app keeps the `*.vercel.app` address, which must never be removed or redirected (ADR-0047). |
| Changes in 3.18.0 | §10.2, §14: production answers on `call.paramountintelligence.co` and on the `*.vercel.app` address that installed desktop apps load, with no redirect (ADR-0046). New setting `KITE_TRUSTED_ORIGINS`. Call data and sign-in stay separate per address. |
| Changes in 3.17.1 | The full evaluation suite runs at release only when the live-answer prompts or answer pipeline changed; otherwise only the groups a change touches run. |
| Changes in 3.17.0 | v1.2.0 (ADR-0045; the screens are in `docs/design/paramount-ai-ui-spec.md`). The product is shown as **Paramount AI**; identifiers, the data folder and the update feed keep their names. §3.3: `overlayIconMode`, `moveOverlay`, `setChatHotkey`, `pickHandoffFile`, `deleteHandoffFile`. §5: Choose platform, the `paramountai://` hand-off with a one-session file, the start card, the Connect card; the call bars with a 48 px icon, the chat bar, panels side by side when wide; own not-found and error pages. §7.2: `/api/preview` removed, `/api/models` added. §7.3: Ctrl+Alt+Enter, held only while the chat bar is open. Bar opacity defaults to 82 %. |
| Changes in 3.16.1 | §5, layout only: the browser call view fills the window over the sidebar. The shared tab sits edge to edge at the top left in its own shape, with the control strip under it instead of over it; the brand, timer, ⋮ and End move to the top of the right column. The desktop's call window is unchanged. |
| Changes in 3.16.0 | v1.1.0 (ADR-0041 to ADR-0044). §5: the **home panel** (`/home`) is the desktop app's first window; during a call, **stacked bars and panels** in one overlay window that the page sizes; **snap zones** (`/overlay-zones`); a separate side window for pages during a call; oldest first everywhere live; Review tabs. §6.1: only real questions are answered (`questionKind.ts`, Claude's `garbled` type); one entry per question within a call and 60 s; screen types; the 12-word answer line, cut at a clause by the card; **offline punctuation** in its own worker (`core/punctuation`, ONNX Runtime 1.30.0, 21.7 MB from our own origin); key terms corrected in the accurate pass; Accurate transcription **Auto**; hygiene prompts. §7.3: `home.ts`, `snapZones.ts`; new optional bridge methods `openPagesWindow`, `windowControl`, `setOverlayLayout`, `onSnapZone`. §7.4: schema version 8 (answers' `callStartedAt`, sessions' `lastCallMs`, `contactName`). §8: **Private covers every window**. §10: the build fetches and checks the punctuation files. |
| Changes in 3.15.0 | v1.0.4 (ADR-0040). §5: ⛶, the words chips, ⋮ "Open call window" and the taskbar open the **full call window** (the main window), not a bigger overlay; "Back to compact" and Esc return; one call view at a time; the shell mode `expanded` is gone, and the bridge gains `showCallWindow` (older shells close the overlay instead). The full window: the overlay's top bar across its width, transcript left, a card per question right (selected expanded, others collapsed), one screen high. The overlay shows the current live question above the card. One entry per question in the call window, the overlay's history and Review. The clean question everywhere, the raw words on hover. The latest answer is the default selection. Transparency only in the compact overlay. §11: the rig is a simulated call in the real windows (`call-window-shots.ts`, `browser-shots.ts`). |
| Changes in 3.14.0 | v1.0.3 (ADR-0039). §5: the overlay panel opacity is stored under a new key (migrated once; default 70%), fading away from the pointer is off by default and never more solid than chosen; Windows uses plain transparency (no acrylic); ⛶ expands the window (shell mode `expanded`), "Back to compact" and Esc return; default 640×480, minimum 560 wide; one Clear and one ⛶ on the answer row; key hints, call timer, level bars, no fillers in the chips; the top-left microphone dictates, with listening and "didn't catch a question" states. §6: the answer line is one short sentence (at most 12 words) with no "Here are…" or CV mention; list questions name the items, then one bullet each; the card shows a bold "Answer:". §11: on-screen visual checks before release (`apps/web/tests/visual`, `apps/desktop/tests/visual`). |
| Changes in 3.13.0 | v1.0.2. **Daily limit and usage counts (ADR-0036):** the accounts database now also holds per-user daily Claude request **counts** (`usage_day`) and one admin setting (`app_setting`: the daily limit, default 300); never text. Every Claude route (`/api/answer` modes answer, chat, screenshot and kite; `/api/notes`, `/api/ask`, `/api/prepare`, `/api/job-import`, `/api/preview`) counts the request before calling Claude and, over the limit, answers 429 `daily_limit` with a friendly message; warm-ups and hello never count. §5: Admin → Usage (`/admin/usage`). §7.2: error code `daily_limit`. §8.1: what the accounts database holds. **Live view and overlay (ADR-0035, ADR-0037, ADR-0038):** §5: the desktop main window and the browser split view share one answers panel (call timer, ⋮ menu, Exit; the answers as a list, newest first; the message box always shown, with screenshot attach, microphone and Send; large Answer and Screenshot buttons with their keys; a collapse arrow); transcript bubbles (same speaker within 4 s, Them left, You right, "Answer this" on Them questions); the overlay window is truly transparent (see-through first, acrylic or vibrancy blur where the system draws it), resizable from its edges, with presets (Top centre default, Top right, Bottom centre), Reset size and position, edge snapping, "Back to compact" and Escape, and a script bar (Ctrl+Alt+S). §6: every current-rules reply also ends with a hidden **last** line `[[question\|…]]` (the cleaned question), removed by the server and sent as a `question` event after the words, so the first word is not delayed; the card shows the raw words until it arrives; the v-previous rules are unchanged. The rules forbid filler openers and lines about the other person (depth only as the Tip). Answer is idempotent per speech: auto-answer never repeats answered speech, and a manual press within 10 s shows the existing answer. §3.3: `placeOverlay`, `getOverlayPreset`, `resizeOverlay`, `setOverlayMode` on `window.kiteDesktop`; hotkey `script-bar`. Voice: dictation in calls turns speech into text only (kept out of the transcript unless the mode is For the call); read-aloud and hands-free only on the Ask Kite page. |
| Changes in 3.12.0 | v1.0.1 (ADR-0034). §6.1: optional **accurate transcription (beta)**, desktop app only, off by default: each final line's audio is transcribed again by Parakeet TDT 0.6B v2 (sherpa-onnx 1.13.8) in an Electron utility process and replaces the line's words; the live engine's line is the fallback. A lone, quiet one-word line is dropped as noise. §3.3: `accurateStatus`, `accurateDownload`, `accurateRemove`, `accurateTranscribe` on `window.kiteDesktop`; `platform.accurate`. §7.3: `src/accurate/` (model, verified resumable download, worker, host). §7.4: schema version 7 rewrites key terms one per line. Key terms are split on commas, semicolons and new lines and sanitised, never a reason for an answer to fail; Answer is idempotent for 3 s. |
| Changes in 3.10.0 | Ask Kite and answer quality (ADR-0030). §3.3: `ask-kite` hotkey action, `onAskKiteHotkey`. §5: newest first in the live view, overlay and review, no jump-to-latest button; the Ask Kite page; the type label, source tag and claim check on answer cards; the chat switch. §6: every reply opens with a hidden line, removed by the server and sent as a `meta` event; the answer limit is 1,500 tokens; `temperature` cannot be set on the fast model. §7.2: `/api/answer` mode `kite`. §7.4: `chats` store (schema version 6); `meta` and `claims` on answers. |
| Changes in 3.9.0 | Parity Phase 4, the Prepare tools (ADR-0029). §5: Mock Interview and Question Bank pages. §7.2: `/api/prepare`. §7.4: `questionBanks` store (schema version 5). |
| Changes in 3.8.0 | Parity Phase 3, after the call (ADR-0029). §5: the session window has a side menu; the transcript is a chat with answers inline; Report, Download (TXT and PDF), Clear transcript, Ask AI. §7.2: `/api/ask`. |
| Changes in 3.7.0 | Parity Phase 2, session setup (ADR-0029). §5: dashboard, wizard, Connect screen; new Resumes and Documents pages. §7.2: `/api/job-import` and `/api/preview`; `language` in the session details. §7.4: new session types, `library` store (schema version 4), documents keep `kind` and `sourceId`. |
| Date | 2 November 2026 |
| Changes in 3.6.0 | Parity Phase 1, the live call (ADR-0029; plan in `docs/design/parakeet-parity.md`). §3.3: new hotkey actions and optional bridge methods. §5: the overlay has three stacked bars; "Start calls in the overlay". §6: first-person answers with an optional tip and a private note. §7.3: new default hotkeys; only Answer, Screenshot, show or hide and move are global; opacity and collapse. |
| Changes in 3.5.0 | Day 5 (compact view, screen-share protection, screenshots, notes, review, learning loop), matching what was built (ADR-0026). §3.3: the adapter as built (`captureScreenshot` returns a JPEG ≤ 1,568 px; `openCompactView(sessionId, render?)`, `closeCompactView`, `get`/`setShareProtection`). §4: protection is **off by default**, remembered per device; the Windows result. §5: the `/compact/[id]` route, the review page, Settings "What Kite has learned". §7.1: `core/live` (a BroadcastChannel between the live page and the compact view), `core/notes`, `core/review`, `core/lessons`, `core/screenshot`, `features/review`, `platform/pip.ts`. §7.2: `screenshot` mode built; `/api/notes` (JSON, Sonnet); the `lessons` request field and the rules block's learned preferences; the `claude_unavailable` error code. §7.3: windows, screenshot and protection as built. §7.4: the `lessons` store (schema version 3); notes fields. §7.6: the learning loop as built. §10: **one Claude key and one Console spend limit** for production, development and evaluations. §13: the API usage limit. |
| Changes in 3.4.0 | Day 4 (answers), matching what was built and measured (ADR-0025). §6.1: the request carries **the whole call** (stable lines and earlier answers) instead of a 3-minute window; question selection; End waits for the last line. §6.2: measured latency (20 answers per platform, production). §6.3: **three cache breakpoints** with an **append-only, chunked conversation**, stable lines, the long-call cap in steps, the idle re-warm, re-warm on Connect; the rules block is now above the caching minimum and shared. §7.1: `core/answer` (context, keepWarm, latency, format), `core/transcript` (stability, question, endCall), `core/storage/answers.ts`, `features/live` answer components, `platform/keymap.ts`. §7.2: request shape (`conversation`, `tail`; `transcript` removed), `answer` and `chat` built, the prompt structure, `jsonReply()` for the evaluation grader. §7.3: `hotkeys.ts` and the bridge's hotkey methods; global shortcuts only during a call. §7.4: answers gain `rating` and `note` and are saved even with "Save transcript" off. §7.6 (new): the learning loop. §11: answer harness test (CI), answer evaluation, `/dev/latency`, the production suites with answers. §13: latency from far regions. |
| Changes in 3.3.0 | Day 3 (sessions, documents, local storage, session prompt), matching what was built and measured. §5: the screens as built (dashboard, Create / Edit session wizard, Choose platform, Connect with saved transcript, Settings). §6.1/§6.3: session hotwords; the warm-up is a **non-streaming** `max_tokens: 0` request with the same thinking setting as the answers (the official prompt-caching docs reject `max_tokens: 0` with `stream: true`); measured cache write 4,508 → read 4,508 tokens. §7.1: `core/storage`, `core/documents`, `core/stt/sessionHotwords.ts`, `core/transcript/saver.ts`, `core/answer/warm.ts`, the new screens. §7.2: three differences from the 3.2.0 request example: `session` gains `description` and `keyTerms`; the answer style is in the cached session block, not the system block; thinking is off per model tier (fast `disabled`, smart `between_tools`, because Sonnet 5.5 rejects `disabled`). The prompt has the imperfect-transcript rule. §7.3: `security.ts` grants `persistent-storage` to the Kite origin. §7.4: the data model as built (`lastActiveAt`, status values, `settings` store, the 12-hour stale-live rule). §8.1: documents are stored locally as extracted text; the browser and the desktop app have separate local data (ADR-0024). §8.3: lost-laptop risk (local data is not encrypted by Kite). §9.1: files built on Day 3. §11: the manual production end-to-end suites (Chrome and the desktop app). ADR-0024 added; ADR-0020 records the session-hotword result. |
| Changes in 3.2.0 | Day 2 (audio and transcript), matching what was built and measured. §6.1: speech-to-text is streaming-only (Zipformer 2023-06-21 + hotwords, energy gate instead of Silero VAD, echo filter; ADR-0020 Accepted; a second pass was tried and rejected). §6.2: measured lag and latency. §7.1: the real `core/audio`, `core/stt`, `core/transcript`, `features/live` and `platform` files. §7.3: `media.ts` and the files built so far. §9.1: STT files, tests and `next.config.ts` (no COOP/COEP). §10.1: no COOP/COEP headers; model files from Hugging Face, runtime from our origin (ADR-0023); deployment is CLI-only with no Git integration or automatic previews (as already practised since Day 1). §11: the STT integration test (Playwright, fake microphone) and its CI job. §13: battery, model size, macOS loopback and transcription accuracy (the main known limitation). The DOCX version of this document is regenerated separately. |
| Changes in 3.1.2 | §8.3: the desktop shell allows exactly one origin (the Kite URL's). Any future payment or SSO page on another origin must be added to the allowlist on purpose. Day 1 Stage 5. |
| Changes in 3.1.1 | §5 (Admin: users) and §8.2: the server **generates** the temporary password (14 readable random characters) when an admin creates a user or resets a password, and shows it to the admin once; the admin no longer types one in. Matches Day 1 Stage 2 and the create-admin script. |
| Changes in 3.1 | Sign-in uses **email + password accounts created by an admin** (Better Auth, admin page, free Neon Postgres for accounts only) instead of Google/Microsoft sign-in (ADR-0022). Deployment uses the **Vercel CLI**, and the Vercel-provided `*.vercel.app` address until the company domain is connected. |
| Replaces | v3.0; before that the v2.0 plan (desktop-only) and v1.1 (fully local), kept for reference only. |
| Build window | 7 working days: Day 1 = Mon 26 Oct 2026 … Day 7 = Mon 2 Nov 2026 (Sunday off) |
| Platforms | Desktop app for macOS and Windows, **and** the same app in a browser (Chrome or Edge) |
| Paid services | Claude API (usage-based) and Vercel Pro hosting (section 10.4). The Neon database free plan covers user accounts and daily request counts (ADR-0036). |

## 1. Summary

Kite is a small internal call assistant. During a call it listens to both sides, shows a live transcript, and, when you press a key, streams a short answer from **Claude** that uses your session details and documents. It can also answer about a screenshot.

Like ParakeetAI, Kite can be used in two ways from the same dashboard:

- **Desktop app** (macOS and Windows): best experience. It hears any meeting app, has global hotkeys and an always-on-top live window, and can hide that window from screen sharing on Windows.
- **Open in browser** (Chrome or Edge): no install. It works with calls running in a browser tab, using an in-page live view and a small picture-in-picture overlay.

**The key design choice:** there is **one web application** (Next.js, hosted on Vercel at `call.paramountintelligence.co`). The desktop app is a **thin Electron shell that loads that same web app** and adds a few native features. All screens, logic, speech-to-text and storage are written once.

| Decision | Choice |
|---|---|
| Main application | Next.js (React + TypeScript), one codebase for desktop and browser |
| Hosting and domain | Vercel; `call.paramountintelligence.co`, and the `*.vercel.app` address that installed desktop apps load (ADR-0046) |
| Desktop app | Electron shell that loads `kite.company.com` and adds native audio, hotkeys, live window, screenshots and screen-share protection |
| Answers | Claude API through one server route (`/api/answer`). Live answers use `claude-haiku-5-5`; notes and the "smart" option use `claude-sonnet-5-5`. Prompt caching is on. |
| Speech-to-text | Runs **on the laptop** inside the page (sherpa-onnx compiled to WebAssembly) with Silero VAD. Audio never leaves the device. |
| Storage | On the device, in the browser database (IndexedDB). Desktop and browser each keep their own sessions. |
| Sign-in | Email + password accounts created by an admin on an admin page; no public sign-up (Better Auth with its admin plugin) |
| Accounts database | Neon Postgres (free plan, added from the Vercel Marketplace) holding **only** user accounts, sign-in sessions and, since v1.0.2, per-user daily Claude request **counts** and the daily-limit setting (ADR-0036). Call data, and any text, never goes there. |
| API key | Stored only in Vercel environment variables, never on laptops |

**Latency target (better than ParakeetAI):** first answer words **≤ 1.0 s** (p50) after the hotkey, and a readable headline **≤ 1.5 s** (p50). ParakeetAI publishes no figure; third-party reviews report 2 to 4 s pauses. Kite's targets are measured on Day 4 and Day 7 (section 6).

## 2. Features

The feature set mirrors the ParakeetAI screens we reviewed: dashboard, create-session wizard, choose platform, connect, live session window and transcript view. Nothing outside this list is built in v3.0.

| # | Feature | Desktop | Browser |
|---|---|---|---|
| F1 | **Dashboard**: list of call sessions, search, filter by type (Interview / Sales / Support / Internal), "Start session" | ✓ | ✓ |
| F2 | **Create session, step 1 (Details)**: type, company (with suggestions, ADR-0048), role or topic, description, documents (PDF / DOCX / TXT) | ✓ | ✓ |
| F3 | **Create session, step 2 (Preferences)**: language (English in v3.0), model (Fast = Haiku, Smart = Sonnet), answer format / length / tone, AI instructions, save-transcript toggle, auto-answer toggle (beta) | ✓ | ✓ |
| F4 | **Choose platform and connect**: "Desktop app" or "Open in browser", then a connect dialog with how-to and a test | ✓ | ✓ |
| F5 | **Live transcript**: "You" (mic) and "Them" (other side), live partial text | ✓ any meeting app | ✓ calls in a browser tab |
| F6 | **Answer**: hotkey or button → streamed answer (headline + bullets); cancel; previous/next answer; copy | ✓ global hotkey | ✓ key when Kite is focused |
| F7 | **Chat**: type a question during the call | ✓ | ✓ |
| F8 | **Screenshot**: hotkey or button → answer about what is on screen | ✓ one key | ✓ uses the shared screen |
| F9 | **Compact overlay**: small always-on-top view of transcript and answer | ✓ live window | ✓ picture-in-picture (Chrome / Edge) |
| F10 | **Screen-share protection** for the live window | ✓ Windows reliable, macOS limited | ✗ not possible in a browser |
| F11 | **After the call**: AI notes (summary, questions asked, next steps), transcript view, delete session | ✓ | ✓ |
| F12 | **Auto-answer (beta)**: answers automatically when the other person finishes a question | ✓ | ✓ |

Not in v3.0: mock interviews, question bank, resume maker, headshots, multi-language transcription, browser-tab reading, team sync of sessions between devices.

## 3. Architecture

### 3.1 Big picture

![Figure 1. One web app used two ways, with Vercel holding the Claude key](diagrams/v3-overview.png)

There are three parts:

1. **Kite web app** (runs in the user's desktop app or browser). It renders all screens, captures audio, runs speech-to-text locally, stores sessions locally, and shows streamed answers.
2. **Kite server** (Vercel functions in the same Next.js project). It handles sign-in (accounts in a small Neon Postgres database) and `/api/answer` + `/api/notes`, which add the system prompt and the Claude key, call Claude and stream the reply back. It **stores no call data**; it only counts each user's Claude requests per day for the daily limit (ADR-0036).
3. **Kite desktop shell** (Electron). It opens `kite.company.com` in its own window and adds native features through a small, typed bridge (`window.kiteDesktop`).

### 3.2 Why this shape

- **Written once.** Screens, speech-to-text, storage and prompt logic exist in one place, so testing covers both desktop and browser.
- **Instant updates.** A Vercel deploy updates every user, desktop included. The desktop shell itself rarely changes.
- **No secrets on laptops.** The Claude key lives only on Vercel. Rotating it does not touch any device.
- **Private by default.** Audio and stored sessions stay on the laptop. Only the text needed for an answer (and a screenshot when asked) is sent, and the server passes it straight to Claude.

### 3.3 The platform adapter (the only place desktop and browser differ)

The web app calls one interface. At start-up it picks the desktop implementation if `window.kiteDesktop` exists, otherwise the browser one.

```ts
// apps/web/src/platform/types.ts
export type HotkeyAction = 'answer' | 'screenshot' | 'chat' | 'clear' | 'prev' | 'next' | 'ask-kite';

export interface Platform {
  kind: 'desktop' | 'browser';
  getMicStream(): Promise<MediaStream>;
  getOtherSideStream(): Promise<MediaStream>;
  captureScreenshot(): Promise<Blob>; // JPEG, long side ≤ 1,568 px (Day 5)
  openCompactView(sessionId: string, render?: PipRenderer): Promise<void>;
  closeCompactView(): Promise<void>;
  onHotkey(handler: (action: HotkeyAction) => void, onTaken?: (shortcuts: string[]) => void): () => void;
  setShareProtection(on: boolean): Promise<ShareProtectionState>;
  getShareProtection(): Promise<ShareProtectionState>;
}
```

| Method | Desktop (Electron) | Browser (Chrome / Edge) |
|---|---|---|
| `getOtherSideStream` | Page calls `getDisplayMedia`; the shell auto-approves it with **system-audio loopback** (Windows; macOS 14.2+), with no picker | `getDisplayMedia` with the share picker. The user picks the meeting tab and ticks "Also share tab audio". On Windows, sharing the entire screen can include system audio. |
| `captureScreenshot` | The shell captures the display the Kite window is on (`desktopCapturer` thumbnail, already scaled so the long side is ≤ 1,568 px; IPC `kite:capture-screenshot`, Kite main frame only; macOS asks for Screen Recording permission). The page encodes it once (`core/screenshot/prepare.ts`: JPEG ≤ 1 MB, checked to start with FF D8 FF) | Draws the current frame of the screen or tab the user already shared at Connect (a hidden video element plays the share's video track, so a frame is ready at once), then the same `prepare.ts` encoding. Never saved to disk |
| `openCompactView` | The shell opens `/compact/[id]` in a frameless window, always on top (`floating`), shown without taking focus (`showInactive`) but accepting typing; position and size remembered (`kite-shell.json` in the app data folder) | Document Picture-in-Picture (Chrome/Edge 116+), opened by a click; the features layer passes a render function, so `platform/` holds no React. Elsewhere: a clear message |
| `onHotkey` | Electron global shortcuts for Answer and Screenshot, forwarded to the page; the keys that work only while Kite is focused come from the page (`listenForFocusedHotkeys`) | Keyboard shortcuts while the Kite tab or PiP window has focus |
| `overlayWindowControls`, `setOverlayOpacity`, `setOverlayCollapsed`, `minimizeMainWindow`, `checkHotkeys` | Opacity, collapse, minimising the main window and checking which global shortcuts are free (optional bridge methods: older installs skip them) | No window control; opacity is not offered, and `checkHotkeys` reports nothing |
| `setShareProtection` | `setContentProtection(on)` on the compact window, **off by default**, the user's choice remembered per device and re-applied every time the window is shown | Not supported; Settings explains why |

## 4. Desktop vs browser: what users get

| | Desktop app | Browser |
|---|---|---|
| Install | `.dmg` / `.exe` (one-time warning, section 10.3) | None. Open `call.paramountintelligence.co`. |
| Meeting apps | Any: Zoom, Teams, Meet, Webex, phone apps | Calls running in a Chrome/Edge tab (Meet, Teams web, Zoom web) |
| Hotkeys | Work from any app | Only when Kite is focused |
| Overlay | Always-on-top live window | Picture-in-picture mini view |
| Screen-share protection | **Off by default**; a switch in Settings, remembered per device. The compact window shows "Hidden from screen share" or "Visible in screen share". Windows (measured Day 5): hidden from an entire-screen share in Chrome 155 (0 of 75,816 window pixels captured with protection on, all of them with it off); a real meeting-app check is on the human checklist. macOS: not verified (no Mac); apps built on ScreenCaptureKit may still capture the window (§13). | Not available. Share a single tab or window, or keep Kite on a second monitor. |
| Supported browsers | (built in) | Chrome or Edge, current versions. Safari and Firefox are not supported (no tab-audio sharing). |

Kite never hides from the taskbar, Dock or process lists, and does not try to evade monitoring or proctoring software.

## 5. Main application screens

**Look (v3.11, ADR-0031):** neutral theme and a see-through desktop overlay; layout, flow and hotkeys unchanged. Sidebar groups, session cards, the wizard rows and the upload window are described in `docs/design/kite-ui-theme.md` §6.

| Screen | Route | Content (mirrors ParakeetAI) |
|---|---|---|
| Sign in | `/login` | Email and password form (no sign-up link) |
| Change password | `/change-password` | Forced on first sign-in and after an admin password reset |
| Admin: users | `/admin/users` | Admins only: list users, create user (name, email, role; the server generates the temporary password and shows it once), reset password (new generated temporary password), disable or enable, change role |
| Admin: usage | `/admin/usage` | **v1.0.2 (ADR-0036).** Admins only: the daily limit (Claude requests per person per day, UTC; default 300), and each person's requests today and over the last 7 days. Counts only, never text. Linked from Admin: users |
| Dashboard | `/` | **Built Day 3, rebuilt in parity Phase 2.** "Call Sessions": type tabs with counts (All / Interview / Regular / Mock), search by role or company, sort, grid or list (remembered in this browser), and a Create session menu of types. Each card shows date, company, role or topic, type and transcript chips, and status (Ready to start / Live / Ended; a "live" session idle for 12 hours shows as Ended), with Start session or Review, and a ⋮ menu: Edit, Rename, Duplicate, Delete (asks first). |
| Create / edit session | `/sessions/new`, `/sessions/[id]/edit` | **Built Day 3, reworked in parity Phase 2.** Step 1 Details: type, "Paste a job link" (Interview and Mock), company, role or topic, job description, Resume picker (Interview and Mock) and Documents picker, from the libraries with upload; files are converted to text on this computer, at most 100,000 characters per document and 150,000 per session. Step 2 Preferences: Answer preferences (a window with format, length, tone, a preview per question type, Set as default), AI instructions (a window), answer language, model, key terms, save transcript, auto-answer. |
| Mock Interview | `/mock` | **Built parity Phase 4.** Kite asks questions written from a session's job description and resume, read aloud by the browser's own voice; listens through the microphone with on-device speech-to-text, or takes typed answers; gives brief feedback on each and a summary; saves it as a Mock session. |
| Question Bank | `/question-bank` | **Built parity Phase 4.** Likely questions for a session, by type, each with a suggested answer in its format. Saved per session on this computer. |
| Resumes, Documents | `/resumes`, `/documents` | **Built parity Phase 2.** Upload once (PDF, DOCX or TXT), reuse in any session, delete. Stored on this computer. |
| Choose platform | dialog | **Built Day 3.** In the browser only: "Desktop app" (explains that the installer arrives on Day 6) or "Open in browser", plus "What's the difference?" (section 4 table). The desktop app opens the session directly |
| Connect | `/live/[id]` (first view) | A sentence saying what the session is, "Listening for N key terms" (the session hotwords, Day 3), how to connect (generic icons for Zoom, Teams, Google Meet, Webex and phone, each with a short how-to for this platform; a video tutorial placeholder; a link to a practice video), the microphone picker and its **level meter** (starts by itself when the microphone is already allowed, always so in the desktop app; otherwise **Test microphone**), "Connect" button, Back. **Connect starts the call** (v3.20.0, ADR-0053): the overlay opens first when calls start in it, then the other side and the microphone, then the live view. There is no sound check or "Go live" step; a failed capture stays here with Try again. Underneath: the transcript saved by earlier calls of this session, or a note that the session does not save its transcript |
| Home panel (desktop) | `/home` | **v1.3.0 (ADR-0055), accounts with account sync:** a 560 × 720 frame with one card: Your sessions → Start your session → Connect Call Session; Connect starts the call in the minimised main window. **v1.1.0 (ADR-0041):** the desktop app's first window, 400×560 and resizable: session search and sort, cards, Dashboard, Create session, and ⋮ (account, Dashboard, Private, Zoom, Theme, Sign out). Theme: the dashboard's, Light until chosen; the call views have their own, Dark until chosen (ADR-0054). Anywhere but a shell from 1.1.0 it redirects to the dashboard. |
| Snap zones (desktop) | `/overlay-zones` | **v1.1.0 (ADR-0041):** ghost layouts shown while the overlay is dragged, in a see-through, click-through window. Holds no call content. |
| Live session | `/live/[id]` | **The full call window since v1.0.4 (ADR-0040): the top bar (mic, Answer, Screenshot, Chat, timer, Back to compact, ⋮, End), the transcript on the left, one card per question on the right with the selected one expanded, the message box, the big Answer and Screenshot buttons; solid.** Earlier layout: Top bar: Answer · Screenshot · Chat · Clear · End. Transcript strip (live chips). Answer panel (Question, Answer headline, bullets, time, copy, prev/next). Chat input. |
| Overlay (compact view) | `/compact/[id]` (desktop window, outside the app layout: no sidebar) / Document PiP | **v1.0.4 (ADR-0040): the current live question above the card; ⛶ opens the full call window.** **Built Day 5, rebuilt in parity Phase 1 (ADR-0029).** Three stacked bars: controls (mic and system-audio status, Answer, Screenshot, Chat, move, collapse, menu, End); the live transcript (latest words as chips, Clear, expand); the answer card (question, answer line, bullets, optional tip, private note apart and muted; time, thumbs, copy, report; history; Clear; expand). One scroll area, 16–18 px text. Desktop: opacity 35–100% and fade when the pointer is elsewhere. Default 720 × 520, smallest 460 × 260. With "Start calls in the overlay" (Settings, on by default), **Connect opens it first, inside its click** (v3.20.0, ADR-0053; a browser's picture-in-picture window needs the click, and the share picker still opens afterwards), and the main window minimises once the call is connected; closing it brings the main window back. The "Claude is unavailable" message shows on the card. It talks to the live page over a per-session `BroadcastChannel` (`kite-live-<id>`): the live page publishes its state and runs the commands; the compact view never calls Claude itself. Desktop: the protection label |
| Session window | `/sessions/[id]` | **Built Day 5, reworked in parity Phase 3.** A side menu of four sections. AI notes: summary, questions with ratings, next steps with owners, parts too unclear to summarise, proposed lessons with Approve / Edit / Reject and a scope, with Regenerate, labelled "Written from answers only" when no transcript was saved. Transcript: a chat (Them left, You right) with Kite's answers inline, each with its time, thumbs and Report this answer; Download TXT or PDF; Clear transcript. Ask AI: a short chat about this call. Call details. Delete session asks first. |
| Settings | `/settings` | **Built Day 3.** Default preferences for new sessions, hotkeys list (read-only; shortcuts arrive Day 4), share-protection switch (desktop, Day 5, off by default), "What Kite has learned" (Day 5: approved lessons with edit, delete and "Clear all lessons"), "Delete all local data" (asks first, then shows what was deleted; the downloaded speech model is kept) |

## 6. Live answer flow and latency

### 6.1 Flow

![Figure 2. Live answer flow, from audio to a streamed answer in the overlay](diagrams/v3-flow.png)

1. **Capture.** Mic → "You" channel. Other side → "Them" channel. The two are never mixed.
2. **Transcribe.** An AudioWorklet resamples each channel to 16 kHz and sends it straight to one Web Worker running sherpa-onnx v1.13.7 (WebAssembly, single-threaded) with the streaming Zipformer 2023-06-21 model and session **hotwords** (ADR-0020), built from the session's key terms and company (boost 2) and its role or topic and document names (boost 1.5) by `core/stt/sessionHotwords.ts` (Day 3; measured: no overall WER change, names right more often). Each channel has its own recognizer stream and an **energy gate** that skips silence (no Silero VAD). An utterance ends by the model's endpoint rule or after 1.2 s with no new words. The worker emits **partial** and **final** text; each final carries its end of speech, for latency measurement. The transcript core labels lines "You"/"Them" and hides "You" lines of 4+ words that echo "Them" through the speakers. Finals are saved to IndexedDB when the session saves its transcript (`core/transcript/saver.ts`; echo lines are never saved, and a saved line later found to be an echo is deleted). Streaming-only: a second, non-streaming pass was measured on Day 2 and rejected (ADR-0020). Model files load from pinned Hugging Face URLs with SHA-256 checks and are cached on the device (ADR-0023).
3. **Trigger.** The user presses the hotkey or button (or auto-answer fires, section 7.5), or types a question in Chat. The question is picked by `core/transcript/question.ts`: the "Them" lines since the user last really spoke (a short "right" does not count; echoes are already hidden), trimmed to the latest question-like run, or the last "Them" line if they have not spoken since. Since 4.3.0 (ADR-0062): talk about the call ("can you repeat that?", "can you hear me?") and a remark ("that's great") look back to the last real question; "[non-English speech]" is never a question; new plain words that continue the question just answered are joined to it and asked again on its card.
4. **Request.** `core/answer/context.ts` builds `POST /api/answer` from memory: the session details, **the whole call so far** as append-only conversation chunks (stable lines and the answers already given in this call, in time order), the lines that may still change (the tail), and the question (section 7.2). One request at a time: a new one cancels the old.
5. **Claude.** The server builds the prompt from three cached parts (the rules, the session block, the conversation chunks; section 6.3) and an uncached tail with the question. It calls Haiku with streaming (`max_tokens` 400) and forwards each text delta to the client immediately (Server-Sent Events).
6. **Show.** The answer panel renders the headline as it arrives, then the bullets, with the question used ("from N lines"), Cancel, Previous / Next, Copy, the time to the first word, and 👍 / 👎 with an optional note. Each finished answer is saved on the device (section 7.4).
7. **End.** End stops both channels, waits for the line still being spoken to become final and be saved, then clears the transcript (Day 4 fix for a Day 3 finding: the last line used to be lost).

### 6.2 Latency targets (to be measured; better than ParakeetAI)

| Stage | Target (p50) | Target (p95) | How we keep it fast |
|---|---|---|---|
| Speech → partial text on screen | ≤ 0.8 s | ≤ 1.5 s | Streaming STT in a worker; small model; energy gate skips silence |
| Hotkey → request leaves the laptop | ≤ 50 ms | ≤ 100 ms | Context already built in memory; transcript window precomputed |
| Hotkey → **first answer words** | **≤ 1.0 s** | **≤ 1.8 s** | Haiku; prompt-cache hit (pre-warmed at session start); no extended thinking; SSE with no buffering; Vercel function region near Anthropic (`iad1`) |
| Hotkey → **readable headline** (~20 tokens) | **≤ 1.5 s** | **≤ 2.5 s** | Headline-first answer format; `max_tokens` ≈ 400 |
| ParakeetAI (reference) | No published figure | — | Third-party reports of 2 to 4 s (unverified) |

**Measured on Day 2** (`docs/testing/benchmark-results.md`): speech → first partial (lag) 347–973 ms in Chrome and the desktop app, plugged in and on battery (after the Day 2 lag fix); end of speech → final line p50 1.5–1.7 s (p95 1.9–2.3 s). Accuracy is the weak point: about 27% WER on the 3 test sentences, with names and technical terms often wrong in a real call (§13).

**Measured on Day 4** (production, from the developer's laptop in Pakistan; `/dev/latency`, 20 answers each, cache read on 20/20; `docs/testing/benchmark-results.md`): key press → request sent p50 0 ms; **first word p50 1,076–1,155 ms** (p95 1,327–1,934) in Chrome and the desktop app; headline p50 1,379–1,454 ms (p95 1,641–2,174). The server's own part (request received → first text) is p50 560–643 ms; the rest, about 500 ms, is the network between that laptop and the `iad1` function (requests enter Vercel at the `bom1` edge). The levers were applied in order: (1) cache hits confirmed; (2) the tail was already empty; (3) `max_tokens` 400 → 250 made no difference beyond noise and was reverted; (4) the region is already next to Anthropic, and moving it nearer the laptop would put the sign-in database and Claude a round trip away instead. The first-word target is met on the server side but not end to end from South Asia; see §13. **Accepted for v1** (Day 5 decision): about 1.1 s to the first word from Pakistan is still well below the 2–4 s reported for ParakeetAI. From Day 5, the 60-second session cookie cache (§8.2) also removes the per-answer database lookup and its cold starts.

These are **targets**. On Day 4 and Day 7 we record 20 hotkey answers per platform (desktop macOS, desktop Windows, browser) with timestamps logged in the page, and write the measured p50/p95 into `docs/testing/benchmark-results.md`. If a target is missed, the levers are, in order:

1. Confirm cache hits (`cache_read_input_tokens > 0`).
2. Shorten the transcript window (3 → 2 minutes).
3. Lower `max_tokens`.
4. Move the function region.

### 6.3 Prompt caching rules

- **Pre-warm.** When a live session opens, and again on Connect (Day 4: the first warm-up may have expired while the user read the Connect screen), the client calls `/api/answer` with `mode: "warm"` (`core/answer/warm.ts`; the screen never waits for it). The server sends the cached blocks with `max_tokens: 0` and a placeholder user turn, so the first real answer is a cache hit. Two rules from the official prompt-caching docs apply:
  - `max_tokens: 0` is rejected together with `stream: true`, so the warm-up is a plain request. Streaming is not part of the cached prompt, so the streamed answers still read the entry.
  - The thinking setting is part of the cached prompt, so the warm-up sends the same one as the answers (`thinkingFor()` in `server/claude.ts`).

  Measured on Day 3 against the real API (`pnpm --filter web verify:warm`, invented 2,000-word document): call 1 wrote 4,508 tokens, call 2 read 4,508; no output tokens either time.
- **Keep the prefix identical.** The cached block must be byte-for-byte the same on every request: same order, same text, no timestamps.
- **Cache lifetime.** The cache lives 5 minutes and refreshes each time it is used. During a call, answers keep it warm. **Idle re-warm** (Day 4, `core/answer/keepWarm.ts`): while connected, if no warm-up or answer was sent for 4.5 minutes, one warm-up is sent with the conversation chunks sent so far, so the next answer still reads the cache. It stops at End and logs only timings and token counts.
- **Minimum size.** The newest Claude models cache prompts of 512 tokens or more. A normal session context is larger. A session with no documents and few details can be smaller; it is then simply not cached (no error).
- **Three breakpoints** (Day 4, ADR-0025; Anthropic allows 4): the rules block, the session block, and the **last conversation chunk** each carry `cache_control`. With the Day 4 rules the rules block is about 836 tokens, above the minimum, so it is cached once and shared by every session (measured: a new session's first warm-up reads 836 and writes only its own block).
- **Append-only conversation.** The call so far is sent as **chunks**: each request adds at most one new chunk at the end (the lines that became stable and the answers that finished since the last request), and a chunk is never changed once sent. Each chunk is its own text block, because Claude reads the cache only at a position where an earlier request put a breakpoint, and each breakpoint looks back at most 20 blocks: one growing text block would never read its own cache. So request N+1 starts with request N's blocks byte for byte, and its read lands on request N's breakpoint, one block back. Measured (`verify:answer-cache`, real API): reads 4,833 → 4,954 → 5,220, each the previous read plus the previous write; each write is only the new chunk.
- **Stable lines** (`core/transcript/stability.ts`): final, not an echo, at least 5 s old, and no line still being heard that could merge into it (same speaker, within the 1.5 s merge gap) or mark it as an echo (a "Them" line within the 2 s echo window). Anything else is in the uncached tail. A sent line that still grows later (rare) is continued with only its new words.
- **Long calls.** The server keeps about 20,000 estimated tokens of conversation (about 90 minutes of speech; characters ÷ 4). Above that it drops the **oldest whole chunks in steps of 5,000 tokens**, and the first kept chunk starts with "[Earlier part of the call omitted]". Because the cut moves only at each step, the cached start of the conversation stays the same between steps. Requests may carry at most 40,000 estimated tokens and 300 chunks; the client trims its oldest chunks to stay under that.

## 7. Component design

### 7.1 Web client modules (apps/web/src)

| Module | Responsibility | Key files |
|---|---|---|
| `features/dashboard` | Session list, filters, search, delete | `Dashboard.tsx`, `SessionCard.tsx` |
| `features/session-setup` | Two-step create/edit wizard, document upload, Choose platform dialog | `SessionWizard.tsx`, `DetailsStep.tsx`, `PreferencesStep.tsx`, `ChoosePlatformDialog.tsx`, `draft.ts`, `labels.ts` |
| `features/settings` | Default preferences, hotkey list, screen-share protection, What Kite has learned, Delete all local data | `Settings.tsx`, `LearnedLessons.tsx` |
| `features/live` | Connect view, live view, compact view, answer panel, chat | Built on Day 2: `LivePage.tsx`, `ConnectPanel.tsx`, `TranscriptStrip.tsx`, `AudioMeter.tsx`, `HealthNotice.tsx`, `speakers.ts`; Day 3: `LiveSession.tsx` (loads the session, its documents and saved lines, builds hotwords, starts the warm-up), `SavedTranscript.tsx` (`demoHotwords.ts` removed). Day 4: `LiveAnswers.tsx` (top bar, chat box and answer panel, hotkeys through the platform), `TopBar.tsx`, `AnswerPanel.tsx` (headline then bullets, cancel, previous/next, copy, 👍 / 👎 and note), `ChatBox.tsx`, `useLiveAnswers.ts` (requests, saving, idle re-warm). Later: `CompactView.tsx` |
| `features/review` | Review page: notes with Regenerate, proposed lessons (Approve / Edit / Reject), answers, transcript, delete (Day 5) | `ReviewPage.tsx`, `SessionReview.tsx`, `ReviewSections.tsx`, `ProposedLessons.tsx`, `LessonEditor.tsx` |
| `core/live` | The per-session `BroadcastChannel` between the live page and the compact view (state out, commands in) | `liveChannel.ts` |
| `core/notes` | The notes request built from the call, sent at End (never blocking it) and from Regenerate; saved on the device | `generate.ts`, `regenerate.ts` |
| `core/review` | Loads a session's review data | `load.ts` |
| `core/lessons` | Matching proposals to decisions (same text, or ≥ 80% word overlap, from the same session), approve / reject / edit / remove, the lessons sent with answers | `match.ts`, `decide.ts`, `active.ts` |
| `core/screenshot` | The single JPEG encoder for screenshots | `prepare.ts` |
| `core/audio` | Get streams via the platform; AudioWorklet resampling to 16 kHz; audio levels for the meters; the Connect card's microphone level before a call (v3.20.0, ADR-0053) | `capture.ts`, `micPreview.ts`, `resampler.worklet.ts`, `resample.ts`, `levels.ts`, `recordingStream.ts` (test recordings as a stream) |
| `core/stt` | Engine (one worker, two channels); worker with sherpa-onnx WASM; per-channel decoding with energy gate and endpoint rules; pinned model list; verified download and caching; hotwords, session hotwords; health status; WER and timing helpers for the test page | `sttEngine.ts`, `sessionHotwords.ts`, `stt.worker.ts`, `channel.ts`, `gate.ts`, `models.ts`, `download.ts`, `hotwords.ts`, `sentencepiece.ts`, `health.ts`, `protocol.ts`, `metrics.ts`, `wer.ts` |
| `core/transcript` | Utterance list (You/Them), echo filter, line merging and display hold; saving final lines to storage; ending a call without losing the last line; stable lines and question selection (Day 4) | `transcript.ts`, `echo.ts`, `merge.ts`, `display.ts`, `saver.ts`, `endCall.ts`, `stability.ts`, `question.ts` |
| `core/answer` | Calls `/api/answer`, reads SSE, cancel; one answer at a time with timings (key press → sent → first word → headline → done); session warm-up and the idle re-warm; the request builder (append-only conversation log, tail, question); headline/bullet split; the `/dev/latency` measurement | `answerClient.ts`, `warm.ts`, `keepWarm.ts`, `context.ts`, `format.ts`, `latency.ts` |
| `core/documents` | PDF (pdf.js 6.4.299; worker served from our origin), DOCX (mammoth 1.13.0), TXT → text with clear error codes (unsupported type, too large, encrypted, no text); size caps (20 MB file, 100,000 characters per document, 150,000 per session) | `extract.ts`, `limits.ts` |
| `core/storage` | IndexedDB via Dexie 4.4.6 (ADR-0024); repositories; default preferences; persistence request; delete all | `db.ts`, `types.ts`, `sessions.ts`, `documents.ts`, `utterances.ts`, `settings.ts`, `persist.ts`, `wipe.ts`, `answers.ts` (Day 4: save, list, rate, note) |
| `core/sync` | **v3.22.0 (ADR-0049), accounts with the accountSync switch only.** The account cache: recording changes in an outbox in the same transaction (`capture.ts`), push and pull with the field-level conflict merge (`engine.ts`, `outbox.ts`), when they run (`client.ts`: 2 s after a change, lines every 15 s or 50, held while an answer streams `foreground.ts`, pulls on open/focus/online, keepalive on page close, flush at End), the three account preferences (`prefs.ts`). `features/sync/SyncScope.tsx` selects the database before a page loads data | `mapping.ts`, `capture.ts`, `outbox.ts`, `engine.ts`, `client.ts`, `foreground.ts`, `prefs.ts`, `prefsSignal.ts` |
| `platform` | Platform adapter (section 3.3); shared media helpers and capture errors; the §7.3 key map for in-page shortcuts (Day 4); the frame source for browser screenshots and Document Picture-in-Picture (Day 5) | `types.ts`, `desktop.ts`, `browser.ts`, `index.ts`, `media.ts`, `errors.ts`, `keymap.ts`, `pip.ts` |

### 7.2 Server (apps/web/src/server and apps/web/app/api)

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/[...all]` | GET, POST | Better Auth handler: sign-in, sign-out, session, change password, and admin operations (admin plugin). Public sign-up is disabled. |
| `/api/answer` | POST, SSE response | `mode`: `hello` (Day 1 test) / `warm` (Day 3) / `answer` / `chat` / `screenshot` → builds the prompt, calls Claude, streams text. `answer` and `chat` built on Day 4; `screenshot` built on Day 5 (a JPEG data URL ≤ 1,400,000 characters, checked by its bytes, placed uncached before the question) |
| `/api/prepare` | POST, JSON response | **Built parity Phase 4.** The Prepare tools: mock interview questions and summary, and the question bank, with Sonnet; feedback on an answer, with Haiku. Logs the kind and token counts only. |
| `/api/ask` | POST, JSON response | **Built parity Phase 3.** Answers a question about a finished call with Sonnet, from its transcript, answers, notes and documents. Rules, session and call are cached blocks. Logs token counts only; the cost in development only. |
| `/api/job-import` | POST, JSON response | **Built parity Phase 2.** Fetches a public job page (public addresses only: `server/job-page.ts`) and extracts the company, role and description with Haiku for the user to check. Logs sizes and token counts only. |
| `/api/models` | GET, JSON response | **Built v1.2.0 (ADR-0045).** Which models this account may choose: the admin's `deep_model_enabled` setting, cached for 60 s. With it off, a session set to Sonnet uses Haiku. |
| `/api/notes` | POST, JSON response | **Built Day 5.** Post-call notes with Sonnet in one structured-output request (110 s limit): summary (≤ 6 bullets), questions (their ratings taken from the request, never from the model), next steps with owners, parts too unclear to summarise (with a time range), up to 3 proposed lessons. Not streamed: nobody waits word by word after a call |
| `/api/sync/push`, `/api/sync/pull`, `/api/sync/record`, `/api/sync/status` | POST / GET, JSON | **v3.21.0 (ADR-0049), behind the accountSync switch (`KITE_SYNC_USERS`).** An account's call data in `call_record`, AES-256-GCM encrypted (`KITE_DATA_KEY_V<n>`): push operations with a base revision (conflicts return the server copy), insert-if-missing, deletes with tombstones (a session takes its children), clear lines, delete all; pull pages of changes since a time; one record by kind and id. The account always comes from the signed-in session (database read); another account's record is 404. Accounts without the switch get 404 (status answers false). Logs counts and timings only. `server/calldata/` |

**`POST /api/answer` request:**

```json
{
  "mode": "answer",
  "model": "fast",
  "session": {
    "type": "sales",
    "company": "Acme",
    "role": "Account review",
    "description": "...",
    "instructions": "...",
    "keyTerms": ["Bluefin Route", "Professional plan"],
    "style": { "format": "headline+bullets", "length": "short", "tone": "simple" },
    "documents": [{ "name": "pricing.pdf", "text": "..." }]
  },
  "conversation": [
    [
      { "kind": "line", "speaker": "you", "text": "Thanks for joining.", "at": 4 },
      { "kind": "line", "speaker": "them", "text": "How much is the Professional plan?", "at": 9 }
    ],
    [
      { "kind": "answer", "mode": "answer", "question": "How much is the Professional plan?", "text": "52 dollars per seat per month.\n- Billed yearly", "at": 12 },
      { "kind": "line", "speaker": "you", "text": "It is 52 dollars per seat.", "at": 15 }
    ]
  ],
  "tail": [
    { "speaker": "them", "text": "What would the rollout timeline be?", "at": 31 }
  ],
  "question": "What would the rollout timeline be?",
  "image": null
}
```

Differences from the 3.2.0 example, decided on Day 3:
- `session.description` (the call description from the wizard, ≤ 5,000 characters) and `session.keyTerms` (the key terms typed for the session, one per entry, ≤ 100) are added. The key terms let Claude recognise misheard names.
- `mode: "warm"` requires `session`; the other fields are not used.
- Validation (`server/validate.ts`, zod): unknown fields are rejected; documents ≤ 150,000 characters in total; request ≤ 4 MB. Errors name the field and never echo its content (for example `session: required for mode warm`).

Differences decided on Day 4 (ADR-0025):
- `transcript` (the 3-minute window) is **removed**. `conversation` is the call so far as chunks (oldest first) of items: `{ kind: "line", speaker, text, at }` and earlier answers `{ kind: "answer", mode, question, text, at }`; `at` is whole seconds since Connect (shown as mm:ss). A chunk never changes once sent. `tail` holds the lines that may still change.
- Limits: at most 40,000 estimated tokens and 300 chunks of conversation, 100 tail lines, 2,000 characters per line or question, 4,000 per earlier answer.
- Every mode but `hello` requires `session`; `chat` requires `question`. `warm` may carry `conversation` (the idle re-warm).

Differences decided on Day 5:
- `image` (mode `screenshot` only, and required there).
- `lessons`: the approved lessons for the session's type (at most 20, each ≤ 200 characters, oldest approval first), sent with every warm-up and answer of a call (loaded once when the session opens). They go in the rules block's "Learned preferences" (§7.6).
- Error code **`daily_limit`** (v1.0.2, ADR-0036): this user has made more Claude requests today (UTC) than the daily limit; HTTP 429 before anything is sent to Claude, with the message "You've reached today's limit of N answers. It resets at midnight UTC; an admin can raise it.", shown as it is in the live view, the overlay, Ask Kite, the notes status, the review and Prepare. Refused requests are counted too.
- Error code **`claude_unavailable`**: Claude cannot answer for anyone right now: the usage limit (HTTP 400 "usage limits", `billing_error`, "credit balance") or an overload (529, or `overloaded_error` mid-stream). The message is fixed ("Answers are unavailable right now: the team's Claude usage limit has been reached. Your transcript is still being recorded.", or the overload version) and shown as it is in the live view and the compact view; `/api/notes` answers 503 and the notes status says why. Listening, the transcript and saving keep working.

**Response:** `text/event-stream` with events `delta` (`{ "text": "..." }`), `done` (`{ "usage": {...}, "ms": {...} }`) and `error` (`{ "code": "...", "message": "..." }`). A warm-up sends only `done` (cache counts and timings) or `error`.

**Prompt structure (`server/prompt.ts`, built Day 3):**

| Part | Content | Cached |
|---|---|---|
| System | Fixed rules, the same for every session: Kite's role; answer rules (headline ≤ 15 words and ≤ 5 bullets for headline+bullets, one short paragraph for paragraph; follow the session's length, tone and instructions; use only session facts and documents for claims about the user, their company, offer, prices, dates or commitments; if unsure or unclear, say what to clarify); the **imperfect-transcript rule**: the transcript is made by on-device speech recognition and often mishears names and technical terms, so Claude infers the intended words from the context and the session's key terms, company, role or topic and documents | Yes (`cache_control`) |
| Session block | Fixed order and labels: call type, company, role or topic, description, key terms, answer format / length / tone, instructions, then each document in `<document name="…">` tags (`&`, `<`, `>` escaped, so a document cannot close its tag). Empty fields are written as "(not given)". Byte-for-byte the same for the same session: no timestamps or ids | Yes (`cache_control`) |
| Conversation (Day 4) | One user-turn text block per chunk: `[mm:ss] Them: …` lines and `[mm:ss] Kite's earlier answer (question: …):` blocks, opened by `<conversation>`; the breakpoint is on the last chunk only. Over the long-call cap, the oldest whole chunks are dropped in steps with "[Earlier part of the call omitted]" | Yes (`cache_control` on the last chunk) |
| Tail | Closes `</conversation>`, then `<latest>` (lines that may still change), then "Question to answer: …" or "Question typed by the user: …" (+ image for screenshots, Day 5); for a warm-up, a fixed placeholder | No |

The system block also holds the Day 4 **consistency rules** ("Earlier answers in this call are shown in the conversation. Stay consistent with them. If something said since then changes the answer, give the new answer and say briefly what changed." and "If the same question is asked again, build on the earlier answer instead of starting over."), the rules tuned by the answer evaluation (headline of at most 15 words with conditions kept out of it, also when the session cannot answer; bullets only from session facts; no offers beyond the documents; `docs/testing/answer-eval.md`), and an empty **Learned preferences** slot for §7.6.

The answer style is in the session block, not in the system block (a difference from 3.2.0): it differs per session, and keeping the system block identical for every session is what lets it be shared.

**Thinking** is off for live answers, set per model tier by `thinkingFor()` in `server/claude.ts`: `fast` (claude-haiku-5-5) sends `{ type: "disabled" }`; `smart` (claude-sonnet-5-5) sends `{ type: "between_tools" }`, because Sonnet 5.5 rejects `disabled` with a 400 (Anthropic model docs). Kite uses no tools, so `between_tools` means no thinking.

**Server rules:**

- Validate input with zod.
- Cap the total size (documents ≤ ~150k characters; request ≤ 4 MB).
- Set a 60 s timeout and do not retry mid-stream.
- Never log transcript, document or answer text; log ids, timings and token counts only (the answer route logs the number of chunks and tail lines, never their text).
- `server/claude.ts` also has `jsonReply()` (structured outputs: `output_config.format` with a JSON schema), used by the notes (Day 5) and by the evaluations' graders (Sonnet).
- **Learned preferences (Day 5):** `rulesBlock(lessons)`. Without lessons it is the Day 4 rules block byte for byte (pinned by its SHA-256 in a unit test), so sessions without lessons share one cache entry. With lessons: the core rules unchanged, then a heading saying these are the user's preferences, which adjust style and content and never override the rules above, then one bullet per lesson (cleaned to one line of ≤ 200 characters, so a lesson cannot start a section or replace a rule). The block changes only when a lesson is approved, edited or removed; the next session's first request then pays one cache write.

### 7.3 Desktop shell (apps/desktop)

| File | Responsibility |
|---|---|
| `main.ts` | App start, single instance, workspace window loading the Kite URL (`*.vercel.app` now, `kite.company.com` later), tray (built Day 1; tray later) |
| `config.ts` | The Kite URL (default production; `--kite-url` or `KITE_URL` for development) and its single allowed origin (Day 1) |
| `windows.ts` | Workspace window; the compact window (Day 5): `/compact/[id]`, frameless, always on top (`floating`), resizable, opened with `showInactive` (does not take focus, accepts typing), bounds remembered in `kite-shell.json` |
| `media.ts` | `session.setDisplayMediaRequestHandler`: for the Kite origin only, approves `getDisplayMedia` with **system-audio loopback and no picker**; every other origin is denied. Permission handler: microphone for the Kite origin only; camera, notifications and everything else denied (Day 2). Windows verified; macOS loopback not yet verified (§13). |
| `hotkeys.ts` | **Built Day 4.** Electron `globalShortcut` with the defaults below, forwarded to the page as `kite:hotkey` messages. The page turns them on for a live call and off at End over `kite:set-hotkeys` (accepted only from the Kite origin's main frame); they are also released on reload, when the window closes and on quit. Global shortcuts take their keys from every other app while registered (Ctrl+Backspace, Ctrl+← / → edit text everywhere), which is why they are on only during a call. A shortcut another app already holds is reported back and the live view says which one (it then works only while Kite has focus). Channel names are in `channels.ts` |
| `screenshot.ts` | `desktopCapturer` thumbnail of the display the Kite window is on, scaled so the long side is ≤ 1,568 px (no full-resolution image over IPC); `kite:capture-screenshot` from the Kite main frame only; macOS permission check (Day 5) |
| `protection.ts` | `setContentProtection(on)` on the compact window, **off by default**, the choice stored per device and re-applied every time the window is shown. `setContentProtection` only: the window stays in the taskbar, the Dock and Alt+Tab (Day 5) |
| `preload.ts` | Exposes `window.kiteDesktop` (typed in `packages/shared`, frozen): `version`, `os`, and from Day 4 `setHotkeysEnabled(on)` (sends only a boolean) and `onHotkey(handler)` (passes only valid actions, never the IPC event); from Day 5 `captureScreenshot()`, `openCompactView(sessionId)`, `closeCompactView()`, `setShareProtection(on)` and `getShareProtection()`. Nothing else. A desktop app installed before Day 4 has neither method; the page then uses in-page shortcuts only. |
| `security.ts` | Blocks navigation to any other origin; opens external links in the system browser; `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Permissions for the Kite origin only: microphone, `display-capture` (handled in `media.ts`) and, from Day 3, `persistent-storage`: Electron routes `navigator.storage.persist()` through the permission handlers, so without this grant the request always fails in the desktop app and local sessions could be cleared when the disk is short of space (ADR-0024) |

Default hotkeys (ADR-0029). The page's keys are in `platform/keymap.ts` and do not fire while typing in a text box. Settings → Hotkeys lists them all and names any global shortcut another app holds:

| Action | macOS | Windows | Works |
|---|---|---|---|
| Answer | ⌘ Enter | Ctrl+Enter | Any app, during a call |
| Screenshot | ⌘ Shift Enter | Ctrl+Shift+Enter | Any app, during a call |
| Send chat with a screenshot (v1.2.0) | ⌘ Alt Enter | Ctrl+Alt+Enter | Any app, only while the chat bar is open (a shell before 1.2.0: while focused) |
| Show or hide overlay | ⌘ Alt H | Ctrl+Alt+H | Any app, during a call |
| Move overlay (Shift: bigger steps) | ⌘ Alt Arrows | Ctrl+Alt+Arrows | Any app, during a call |
| Chat | ⌘ Shift Backspace | Ctrl+Shift+Backspace | Kite focused only |
| Clear answer | ⌘ Backspace | Ctrl+Backspace | Kite focused only |
| Previous / next answer | ⌘ ← / ⌘ → | Ctrl+← / Ctrl+→ | Kite focused only |

### 7.4 Data model (IndexedDB, Dexie)

Built on Day 3 (`core/storage`, ADR-0024). One IndexedDB database, `kite`, opened with Dexie 4.4.6. The field types and their comments are in `core/storage/types.ts`.

| Store (indexes) | Fields |
|---|---|
| `chats` (id; updatedAt), schema version 6 | id, title, createdAt, updatedAt, attachments (its own copies), messages (role, text, at, screenshot count, meta). Ask Kite chats. Screenshots are never stored (ADR-0030). |
| `questionBanks` (sessionId), schema version 5 | sessionId, groups (type; questions with suggested answers), createdAt. Goes with its session. |
| `library` (id, kind), schema version 4 | id, kind (`resume` / `document`), name, text, chars, addedAt. A session keeps its own copy of what it uses. |
| `sessions` (id, createdAt, type, status) | id, type (`interview` / `regular` / `mock`; older types become `regular` in schema version 4), company, role, description, preferences (language `en`, model `fast`/`smart`, style {format, length, tone}, keyTerms: one per line), instructions, saveTranscript, autoAnswer, createdAt, status (`not-started` / `live` / `ended`), lastActiveAt |
| `documents` (id, sessionId) | id, sessionId, name, text (extracted text only, never the file), chars, addedAt, kind (`resume` or `document`), sourceId (the library item it was copied from) |
| `utterances` (id, sessionId) | id (`<session>:<call>:<line>`), sessionId, speaker (`you`/`them`), text, tStart, tEnd |
| `answers` (id, sessionId) | id, sessionId, mode, question, text, model, msFirstToken, msTotal, createdAt, **rating** (`up` / `down` / null) and **note** ("What was wrong / better answer"), Day 4. Written when an answer finishes (a cancelled or failed one is not saved), **even when "Save transcript" is off**, because the review page and the learning loop need them; the preferences step says so. No index changed, so no new Dexie version. v1.3.2 (ADR-0061): **sourceLineId**, the live id of the line an answer's question ended on, so Review and the downloads place it after that turn (not indexed) |
| `notes` (sessionId) | sessionId, notes (summary, questions, nextSteps, unclear, lessons: the proposals), callStartedAt, createdAt, fromAnswersOnly (Day 5). One set per session (the latest call); Regenerate replaces it |
| `lessons` (id, sourceSessionId, status), schema version 3 | id, text (one line, ≤ 200 characters, as sent), scope (`all` or a session type), status (`approved` / `rejected`), sourceSessionId, sourceKey (the proposal's normalised text, never changed by edits), evidence, decidedAt, approvedAt (Day 5). Only decisions are stored, apart from the notes, so regenerating notes never loses or duplicates them |
| `outbox` (++seq, ref), `syncRevs` (ref), `syncMeta` (id), schema version 9 | **ADR-0049, account caches only:** changes waiting to be sent (record reference, put or delete, the fields changed), the server revision of each record held, the last pull time and pending account preferences. Unused in `kite` |
| `settings` (id), schema version 2 | one row `defaults`: the default model, style, instructions and save-transcript setting for new sessions |

Rules:
- Ids come from `crypto.randomUUID()`; times are Unix milliseconds.
- **Status shown:** a session stored as `live` whose `lastActiveAt` is more than **12 hours** old is shown as Ended (the window was closed or crashed during a call). `lastActiveAt` is set on Connect and refreshed every 60 s during a call.
- **Delete a session** removes its documents, transcript lines, answers, notes and rejected lesson decisions in one transaction. Approved lessons from it stay (they are the user's preferences, managed in Settings). "Delete all local data" removes lessons too.
- If "save transcript" is off, utterances are kept in memory only and discarded when the session ends. Echo lines are never stored.
- Schema changes add a new Dexie version; earlier versions are never edited.

### 7.5 Auto-answer (beta)

Auto-answer is off by default. **Since 4.3.0 (ADR-0062)** it answers the **question window**: every unanswered "Them" line since the user really spoke (the user's blips such as "okay" or "um" do not count), leaving out greetings, instructions and talk about the call. It answers when **all** of these are true (`core/answer/autoAnswer.ts`):

- the window is a question or a request (`questionKind.ts`), never talk about the call ("can you repeat that?", "can you hear me?") or another language;
- nobody is speaking (a grey line unchanged for 5 s does not count);
- the pause since the window's last line is 1.2 s when it sounds finished, 3.0 s when it sounds cut off (`complete.ts`), and up to 1.5 s more while the desktop's accurate engine is still rewriting a line of it;
- the question ended at most 10 s ago, and its lines were not answered before.

If the other person goes on within 4 s of an auto-answer starting, the answer is cancelled and asked again with the whole question **on the same card** (a rerun). There is no rate limit (the 15 s limit of Day 6 is gone): one answer per question. Answer pressed after new plain words that continue the question just answered (within 8 s, no reply from the user) does the same. Each automatic answer can be cancelled with Clear. Tests: `tests/unit/core/answer/autoAnswer.test.ts` and the simulated call (e) in `tests/integration/sim-calls.spec.ts`.

### 7.6 Learning loop

How Kite gets better for each user, from their own ratings (ADR-0025):

- **Day 4 (built):** every answer is saved on the device with its rating (👍 / 👎) and an optional note ("What was wrong / better answer"). The system block has a "Learned preferences" slot, empty for now.
- **Day 5 (built):** after a call, the notes (Sonnet) propose up to 3 short lessons from that call's ratings and notes. On the review page the user approves (this session type by default, or all calls), edits (one line, ≤ 200 characters, shown exactly as it will be sent) or rejects each. Decisions are stored in the `lessons` store, apart from the notes. A proposal from the same session with the same normalised text, or ≥ 80% word overlap, is matched to its earlier decision, so Regenerate never asks twice or duplicates. Approved lessons are managed in Settings → What Kite has learned.
- **Sent with answers:** approved lessons for the session's type plus `all`, oldest approval first, at most 20 (the newest approvals), loaded once when a session opens and sent with every warm-up and answer; they go into the rules block's "Learned preferences" (§7.2). Nothing is learned without the user's approval, and nothing leaves the laptop except as part of an answer request.
- **Evaluation:** scenarios 19–20 (group `lessons`) are answered with and without their lesson (`--without-lessons`); the lesson must raise the score. Queued until the API is available again.

## 8. Security and privacy

### 8.1 Where data lives

| Data | Location |
|---|---|
| Audio | Only in memory on the laptop; never stored, never sent |
| Sessions (including a picked company's domain, ADR-0048), documents, transcripts, answers, notes, lesson decisions, default preferences | IndexedDB on the laptop (ADR-0024). Documents are stored as extracted text only; the original file is read in the browser and never kept or uploaded. **The browser and the desktop app have separate local data**, and so does each browser profile: a session created in Chrome does not appear in the desktop app, and the other way round. There is no sync in v1 (§14). |
| Downloaded speech model | Cache Storage on the laptop. Public, checksum-pinned files only; "Delete all local data" keeps it. |
| Text for an answer (session block, approved lessons, the call so far and the earlier answers in it, question) and screenshots on request | Sent over HTTPS to Vercel, then to Claude. Not stored by Kite's server. Screenshots exist only in memory until the request is sent; never saved to disk or logged |
| Claude API key | Vercel environment variable only |
| User accounts (name, email, role, password hash, sign-in sessions) | Neon Postgres on Vercel. Passwords are hashed (scrypt) and never stored or logged in plain text. |
| Daily request counts (user id, UTC day, number of Claude requests) and the daily-limit setting | Neon Postgres on Vercel (`usage_day`, `app_setting`; v1.0.2, ADR-0036). Counts only: no question, answer, transcript or document text. Deleted with the account. |
| Synced call data (accounts with the accountSync switch, v3.21.0, ADR-0049) | Neon Postgres, table `call_record`: each record encrypted with AES-256-GCM (key in Vercel, `KITE_DATA_KEY_V<n>`), bound to its account, kind and id; readable columns hold ids, revision, tombstone flag, key version and the session's Save transcript setting only. Lines are refused for a session that does not save its transcript. Deleted with the account; deleted records keep a content-free tombstone. The device keeps a cache. Audio, screenshots and the speech model never leave the device. |

Internal approval is needed that transcript text, documents and screenshots are sent to Anthropic's API to generate answers.

### 8.2 Sign-in

- **How accounts are created:** an admin opens `/admin/users` and enters a name, email and role (`admin` or `user`). The server generates a temporary password (14 random characters, without look-alikes such as 0/O and 1/l) and shows it to the admin **once**; the admin shares it with the person directly. It is stored only as a hash. There is no public sign-up and no email sending.
- **Password reset:** an admin can reset a user's password from the same page. The server generates a new temporary password (shown once), signs the user out on every device and flags the account `mustChangePassword`.
- **First sign-in:** the account is flagged `mustChangePassword`, so the user is sent to `/change-password` before anything else. The same happens after an admin resets a password.
- **First admin:** created once from the command line (`pnpm --filter web create-admin --prod`; ADR-0050), which generates and prints a temporary password the same way.
- **Desktop app:** shows the same `/login` page inside its window. Email + password works inside an app window, so no browser hand-off is needed.
- **Library:** Better Auth with email + password (`disableSignUp: true`) and the admin plugin (create user, list users, set role, set password, ban/unban). Sessions are stored in Postgres and use secure, HTTP-only cookies; they expire after 30 days.
- **Session cookie cache** (Day 5, ADR-0022 update): the session is also kept in a signed cookie for 60 s.
  - The answer routes read it, so an answer skips the database lookup. They send any refreshed cookie back on their response.
  - Pages and server actions always read the database.
  - Trade-off: a disabled user, or one whose password was reset, is refused by pages at once and by answers within 60 s.

### 8.3 Controls

| Risk | Control |
|---|---|
| Strangers using the URL to spend Claude credits | Sign-in required on every page and API route; no public sign-up (admin-created accounts only); disabled accounts lose their sessions immediately; Claude Console monthly spend limit |
| Key leakage | Key only on Vercel; never sent to the client; never logged |
| Malicious page inside the desktop shell | Only the Kite URL can load; navigation to other origins blocked; minimal preload API. Every other origin is blocked, so any future payment or SSO origin must be added to the allowlist (`apps/desktop/src/config.ts` / `security.ts`) on purpose, with a review. |
| Prompt injection from documents | Documents are placed in a clearly marked context block; the answer path has no tools and can take no actions |
| Lost laptop | Data is in the browser profile or the desktop app's profile, **not encrypted by Kite** (ADR-0024). Mitigations: the operating system's disk encryption (FileVault / BitLocker), "Delete all local data" in Settings, sign-in sessions expire after 30 days (the app then asks for the password before showing its screens, but the IndexedDB files stay readable to anyone signed in to that operating-system account) |
| Local data cleared by the browser | Kite asks for persistent storage when the first session is saved. The desktop shell grants `persistent-storage` to the Kite origin only (§7.3); Chrome decides by itself, and without it data is kept as long as there is disk space |

## 9. Folder structure and code rules

### 9.1 Folder structure

```
kite/
├── apps/
│   ├── web/                          # THE application (deployed to Vercel)
│   │   ├── app/                      # Next.js routes (thin)
│   │   │   ├── login/page.tsx
│   │   │   ├── change-password/page.tsx
│   │   │   ├── admin/users/page.tsx  # admins only
│   │   │   ├── page.tsx              # dashboard
│   │   │   ├── sessions/new/page.tsx # create session
│   │   │   ├── sessions/[id]/edit/page.tsx  # edit session (Day 3)
│   │   │   ├── sessions/[id]/page.tsx  # review
│   │   │   ├── live/[id]/page.tsx    # connect + live session
│   │   │   ├── settings/page.tsx
│   │   │   └── api/
│   │   │       ├── answer/route.ts
│   │   │       ├── notes/route.ts
│   │   │       └── auth/[...all]/route.ts
│   │   ├── src/
│   │   │   ├── features/             # UI by feature
│   │   │   │   ├── dashboard/
│   │   │   │   ├── session-setup/
│   │   │   │   ├── live/
│   │   │   │   ├── review/
│   │   │   │   └── settings/
│   │   │   ├── core/                 # browser logic, no React
│   │   │   │   ├── audio/
│   │   │   │   ├── stt/
│   │   │   │   ├── transcript/
│   │   │   │   ├── answer/
│   │   │   │   ├── documents/
│   │   │   │   └── storage/
│   │   │   ├── platform/             # desktop vs browser adapter
│   │   │   ├── server/               # server-only: claude, prompt, auth, db
│   │   │   └── ui/                   # shared buttons, dialogs, layout
│   │   ├── scripts/
│   │   │   ├── create-admin.ts       # creates the first admin account
│   │   │   ├── fetch-models.ts       # pinned STT files: runtime (every build), model (dev, CI)
│   │   │   ├── check-stt-runtime.ts  # fails the build if a runtime file is missing or wrong
│   │   │   └── verify-warm.ts        # developer-only: warm-up write/read against the real API
│   │   ├── public/stt-runtime/       # STT runtime, unpacked at build time (git-ignored)
│   │   ├── public/models/stt/        # STT model files for development and CI (git-ignored;
│   │   │                             #   production loads them from Hugging Face, ADR-0023)
│   │   ├── tests/
│   │   │   ├── unit/                 # Vitest, same paths as src/ and scripts/
│   │   │   ├── integration/          # Playwright: STT pipeline with a fake microphone
│   │   │   ├── fixtures/audio/       # official LibriSpeech test recordings + SOURCES.md
│   │   │   └── fixtures/documents/   # small invented PDF/DOCX/TXT files + generator, SOURCES.md
│   │   ├── next.config.ts            # no COOP/COEP headers (single-threaded STT runtime)
│   │   └── package.json
│   └── desktop/                      # thin Electron shell
│       ├── src/
│       │   ├── main.ts
│       │   ├── windows.ts
│       │   ├── media.ts
│       │   ├── hotkeys.ts
│       │   ├── screenshot.ts
│       │   ├── protection.ts
│       │   ├── security.ts
│       │   └── preload.ts
│       ├── tests/                    # Electron smoke tests
│       ├── electron-builder.yml      # .dmg + .exe
│       └── package.json
├── packages/
│   └── shared/                       # types used by web + desktop
│       └── src/
│           ├── desktop-bridge.ts
│           ├── api.ts
│           └── hotkeys.ts
├── docs/                             # this document, decisions, results
├── .github/workflows/ci.yml
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── CLAUDE.md
```

### 9.2 Code rules

- TypeScript `strict` everywhere. ESLint + Prettier, enforced in CI.
- **Routes are thin.** Pages render feature components; API routes call `src/server/*`.
- `src/core` has no React; `src/features` has no direct `fetch`, IndexedDB or media calls (they use `core` and `platform`).
- `src/server` is server-only (`import 'server-only'`). It is the only place the Claude SDK and key are used.
- All desktop/browser differences live in `src/platform`. No `if (desktop)` checks elsewhere.
- Shared request/response and bridge types live in `packages/shared`.
- Every module has unit tests next to the folder (`tests/unit/<module>`).
- Never log transcript, document, answer or screenshot content.
- One reason per new dependency, written in the PR.

## 10. Hosting, domain and installation

### 10.1 Vercel project

| Setting | Value |
|---|---|
| Framework | Next.js (project root `apps/web`) |
| Function region | `iad1` (US East), close to the Claude API. Day 4: server time to first text p50 560–643 ms; from South Asia the network adds about 500 ms (§6.2, §13) |
| Function runtime | Node.js; streaming responses for `/api/answer` and `/api/notes` |
| Environment variables | `ANTHROPIC_API_KEY` (**one key**, the same in Production, Preview and Development and in `apps/web/.env.local`: the deployed app, local development, the verify scripts and the evaluations all use it; Day 5 decision), `DATABASE_URL` (added automatically by the Neon integration), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `KITE_MODEL_FAST=claude-haiku-5-5`, `KITE_MODEL_SMART=claude-sonnet-5-5`; from v3.21.0 (ADR-0049) `KITE_DATA_KEY_V1` (Production; a copy in the company password manager) and `KITE_SYNC_USERS` (the accountSync switch) |
| Deployment | **Vercel CLI only**: `vercel link` (once), `vercel env add` / `vercel env pull`, `vercel deploy` (preview), `vercel deploy --prod` (production). There is no Git integration: pushes and pull requests do not deploy. |
| Build | `pnpm run stt:runtime && next build`: the STT runtime (13.3 MB) is downloaded from the pinned sherpa-onnx release (175 MB archive), checked by SHA-256 and served from `/stt-runtime/v1.13.7/` (ADR-0023) |
| Speech-to-text model files | Not deployed. The browser loads them from pinned Hugging Face commit URLs, checks each SHA-256 and caches them in Cache Storage (ADR-0023). |
| Headers | No COOP/COEP: the STT runtime is single-threaded and needs no cross-origin isolation (ADR-0020). |
| Previews | `vercel deploy` by hand when needed (no automatic previews) |

### 10.2 Company domain

Production answers on `https://call.paramountintelligence.co` and on `https://kite-call-assistant.vercel.app`, with no redirect, because installed desktop apps are locked to the second (ADR-0046). `BETTER_AUTH_URL` is the first, and `KITE_TRUSTED_ORIGINS` lists both. Each address has its own sign-in and its own local data. **The desktop app stays on the `*.vercel.app` address, which must never be removed or redirected** (ADR-0047). Steps, checks and rollback: `docs/deploy/subdomain.md`.

### 10.3 Desktop app install (unsigned, free)

| | Windows | macOS |
|---|---|---|
| File | `Kite-Setup-x.y.z.exe` | `Kite-x.y.z-arm64.dmg` |
| First launch | SmartScreen warning → More info → Run anyway | Right-click the app → Open (or System Settings → Privacy & Security → Open Anyway) |
| Permissions | Microphone (Windows prompt) | Microphone + Screen & System Audio Recording (granted once). Requires macOS 14.2 or later. |
| Keeping macOS permissions after updates | — | Sign every build with the same free self-signed certificate (created once in Keychain Access) |
| Updates | The web app updates on every Vercel deploy. The shell only needs reinstalling when `apps/desktop` changes. | Same |

### 10.4 Costs

| Item | Cost |
|---|---|
| Claude API | Usage-based, with **one Console spend limit (about $20 a month)** for everything: production, development and evaluations share it (Day 5 decision, after the evaluations used up the limit on 30 October). Every paid run is agreed first with its estimated cost; evaluations re-run only the groups a change touches, and the full suite at release only when the live-answer prompts or answer pipeline changed. Prompt caching cuts repeated context to about 10% of the input price on Haiku. |
| Vercel | **Pro plan required for company use.** The free Hobby plan is for non-commercial personal use only. Pro is $20 per month per developer seat; app users do not need Vercel seats. |
| Accounts database | Neon Postgres free plan (via the Vercel Marketplace); a few users and sessions fit easily |
| Domain, DNS, certificates | `call.paramountintelligence.co` on the company domain, plus the `*.vercel.app` address; Vercel certificates are free |
| Everything else | Free and open source |

## 11. Testing

| Level | What | Tool | When |
|---|---|---|---|
| Unit | Prompt builder, question selection, transcript window, document extraction, storage repositories (fake IndexedDB), SSE parser, platform adapters (mocked APIs), auto-answer rule | Vitest | Every PR |
| Integration | `/api/answer` with a mocked Claude stream (deltas, errors, cancel) | Vitest | Every PR |
| Call quality (synthetic) | The ADR-0063 call in four variants through the real worker at real time, then the transcript and auto-answer code on a simulated clock; metrics against the script (`pnpm --filter web calls:make`, then `stt:calls --label=<name> [--src=<apps/web>]`, `--report=a,b`) | Playwright (Chromium) + tsx | By hand, before a change to the speech, transcript or answer rules ships; results in `benchmark-results.md` |
| Integration (STT) | Official LibriSpeech recordings played by Chromium's fake microphone through the real worklet → worker → recognizer → transcript; a final line and WER ≤ 10% per recording (`pnpm --filter web test:stt`) | Playwright (Chromium) | Every PR and push to `main` (`stt-integration` job; model files cached by their pinned SHA-256s) |
| Harness (answers) | Built Day 4 (`pnpm --filter web test:answers`). The real `LiveAnswers` component on a fixture transcript, no sign-in, with a mocked, slowly streaming `/api/answer`: Ctrl+Enter → headline before bullets, cancel, previous/next, copy, chat, append-only requests, rating and note survive a reload, deleting the session removes its answers | Playwright (Chromium) | Every PR and push to `main` (in the `stt-integration` job) |
| Answer quality | Built Day 4 (`pnpm --filter web eval:answers`). 15 invented scenarios through the real server prompt with Haiku, graded by Sonnet against a rubric plus two code checks; score table only (`docs/testing/answer-eval.md`) | Script (real API) | By hand after a prompt change; never in CI |
| Latency | Built Day 4: `/dev/latency` (admin), 20 answers through the live client path, p50/p95 and cache hits; run in production by `tests/e2e-prod/latency.spec.ts` as an admin test account that stays disabled between runs (`pnpm --filter web e2e-admin --prod --enable` / `--disable`) | Page + Playwright | Day 4 and Day 7, by hand |
| End-to-end (production, manual) | Built Day 3 (`apps/web/tests/e2e-prod/`, `pnpm --filter web test:e2e-prod`). Runs against production as a dedicated test account (`create-e2e-user`; disable at `/admin/users`). **Chrome:** session with a document and key terms → key-term count → warm-up cache write then read (real Claude) → fake microphone and fake shared tab → final lines → **Answer (Ctrl+Enter) streams and is rated (Day 4)** → saved transcript after reload → delete. **Desktop app** (fresh profile): empty dashboard (separate data) → Open without dialog → Connect without picker → final lines → **a Chat answer streams and is rated (Day 4)** → Delete all local data. Fake media feeds the "Them" audio into "You" too, so the echo filter hides "You" lines there; the suites count final lines from either side | Playwright (Chromium, Electron) | By hand, before a pull request is marked ready; never in CI (real API, real account) |
| Harness (screenshot) | Built Day 5 (`pnpm --filter web test:screenshot`). Chromium shares a fake tab; the browser adapter grabs a frame and `prepare.ts` encodes it (JPEG, ≤ 1,568 px, ≤ 1 MB) | Playwright | Every PR (CI) |
| Harness (review and lessons) | Built Day 5 (`pnpm --filter web test:review`). The real review page and Settings "What Kite has learned" on invented sessions in IndexedDB, with a mocked `/api/notes`: notes, answers, transcript, Regenerate (reworded proposals keep their decisions), the usage-limit message, "Save transcript" off ("Written from answers only"), Approve / Edit / Reject, Clear all lessons, Delete (in-app dialog) | Playwright | Every PR (CI) |
| Notes and lessons quality | Built Day 5 (`eval:notes`; `eval:answers --only=lessons`, with and without lessons). Developer-only, real API, run only after the developer agrees to the estimated cost | Scripts | When notes or lessons change |
| Desktop smoke | Shell launches, loads the app, `window.kiteDesktop` exists, the compact window opens (always on top, not focused), protection toggles (default off) | Playwright for Electron | Every PR (macOS + Windows runners) |
| Manual | Real calls in Zoom, Teams and Meet × desktop macOS, desktop Windows, browser; screen-share check; fresh installs | Checklist | Day 5 to 7 |
| Measured | Latency (section 6.2), transcript lag | In-page timings | Day 4 and Day 7 |

CI never calls the real Claude API. Real-API checks (verify scripts, evaluations) are run by hand with the one key, only after the developer agrees to their estimated cost (§10.4).

## 12. Seven-day build plan

### 12.1 Team

| Track | Owner | Owns |
|---|---|---|
| **A: Web app and UI** | Engineer A | Dashboard, wizard, live page, compact view, review, settings, picture-in-picture |
| **B: Audio and transcript** | Engineer B | Capture, AudioWorklet, STT worker, VAD, transcript, auto-answer |
| **C: Server, desktop and quality** | Engineer C | Vercel, sign-in, `/api/answer`, prompts, Electron shell, CI, tests, packaging |

Daily rhythm: 09:30 stand-up; 13:00 merge to `main` with CI green and the preview deployed; 17:30 demo against the day's checks. With two engineers, merge tracks A and C; with one engineer, expect about 10 days.

### 12.2 Timeline

| Day | Date | Phase | Goal |
|---|---|---|---|
| 1 | Mon 26 Oct | Setup | Repo, Vercel (CLI) + accounts database + sign-in + admin page, streamed Claude reply, desktop shell loads the app, STT spike |
| 2 | Tue 27 Oct | Audio and transcript | Live two-channel transcript in desktop and browser |
| 3 | Wed 28 Oct | Dashboard and sessions | Dashboard, wizard, documents, local storage, cache pre-warm |
| 4 | Thu 29 Oct | Answers | Hotkey/button answers streamed with cancel, history, chat; latency measured |
| 5 | Fri 30 Oct | Overlay, screenshots, notes | Compact view (both), screenshots (both), share protection (desktop), AI notes; feature-complete |
| 6 | Sat 31 Oct | Desktop packaging and polish | Installers, auto-answer beta, error states |
| 7 | Mon 2 Nov | Test and release | Real-call testing, fixes, measured results, user guide, v1.0.0 |

### 12.3 Daily tasks and checks

**Day 1: Setup (Mon 26 Oct)**

| Track | Tasks |
|---|---|
| A | pnpm monorepo per section 9.1; Next.js app shell and layout; login page; empty dashboard |
| B | **Spike:** sherpa-onnx WASM streaming English model in a Web Worker on Chrome (macOS and Windows) and in Electron; measure real-time factor and partial lag; pick the model (ADR-0020) |
| C | Vercel project via CLI + Neon database + Better Auth (email + password, admin plugin, no sign-up) + `/admin/users` + forced password change; `/api/answer` streaming "hello" from Haiku with `cache_control`; Electron shell loading the Vercel URL with security settings; CI (lint, typecheck, unit) |

Checks:

- [ ] The `*.vercel.app` URL loads the login page; the admin can create a user; the new user must change their password; non-admins cannot open `/admin/users`.
- [ ] Haiku streams a reply into the page.
- [ ] The desktop shell opens the app and you can sign in inside it (on your machine; the other OS as soon as available).
- [ ] The STT model is chosen with measured numbers.
- [ ] CI is green.

**Day 2: Audio and transcript (Tue 27 Oct)**

| Track | Tasks |
|---|---|
| B | `core/audio` (mic + other side via platform), resampler worklet, `stt.worker.ts` with VAD, partial/final events; model files served from `/models` and cached |
| C | Desktop `media.ts` (auto-approve loopback for our origin), mic permission; browser `getOtherSideStream` with tab-audio guidance |
| A | Connect view (how to connect, audio meters, test) and `TranscriptStrip` |

Checks:

- [ ] Real call in desktop (macOS and Windows): both sides transcribed and labelled.
- [ ] Meet in a Chrome tab: both sides transcribed.
- [ ] STT integration test on recorded WAV passes.

**Day 3: Dashboard and sessions (Wed 28 Oct)**

| Track | Tasks |
|---|---|
| A | Dashboard, two-step wizard, choose-platform dialog, settings |
| B | `core/storage` (Dexie) repositories; `core/documents` (PDF/DOCX/TXT); transcript saving honouring the toggle |
| C | `server/prompt.ts` (system + cached session block); `mode: "warm"`; zod validation and size caps; unit tests |

Checks:

- [ ] Create a session with documents, reload: data is still there (desktop and browser).
- [ ] The second request logs `cache_read_input_tokens > 0`.

**Day 4: Answers (Thu 29 Oct)**

| Track | Tasks |
|---|---|
| A | Live page: top bar, `AnswerPanel` (incremental headline + bullets, prev/next, copy), chat box |
| B | `core/transcript` question selection; `core/answer` SSE client with cancel and timings; in-page hotkeys |
| C | Desktop global hotkeys → page; `/api/answer` modes `answer` and `chat`; error codes; E2E test with fake audio and mocked Claude |

Checks:

- [x] The answer uses session facts (evaluation 9.43 / 10).
- [x] Cancel works (harness test).
- [x] **20 timed answers per platform recorded** (Chrome and the desktop app on Windows; production). p50 first words 1,076–1,155 ms, above 1.0 s; the levers were applied and recorded (section 6.2). macOS is measured on Day 7.

**Day 5: Overlay, screenshots, notes (Fri 30 Oct)**

| Track | Tasks |
|---|---|
| A | `CompactView`; browser picture-in-picture; session review page |
| C | Desktop live window (always on top) + `protection.ts`; `screenshot.ts`; `/api/notes` with Sonnet |
| B | Browser screenshot from the shared stream; image downscaling (≤ 1,568 px, JPEG); `mode: "screenshot"` |

Checks:

- [ ] Screenshot of code or a slide gives a correct answer (desktop and browser).
- [ ] Windows full-screen share hides the live window; macOS behaviour matches section 4.
- [ ] Notes are generated at session end.
- [ ] **Feature-complete F1 to F11.**

**Day 6: Desktop packaging and polish (Sat 31 Oct)**

| Track | Tasks |
|---|---|
| C | electron-builder `.dmg` + `.exe`; self-signed macOS signing; download links on the dashboard banner |
| B | Auto-answer beta (section 7.5) with fixture tests |
| A | Empty, loading and error states (no mic, no tab audio, sign-in expired, Claude error, offline); "What's the difference?" dialog |

Checks:

- [ ] Fresh install from the installers on a clean Mac and Windows PC in under 5 minutes.
- [ ] All tests green on CI (Linux web, macOS and Windows desktop).
- [ ] **App icons (added Day 5, UI U4):** replace the placeholder icons (`apps/desktop/build/icon-512.png`, `icon-1024.png`, `icon.ico`; `apps/web/public/brand/favicon.svg`) with ones made from the designer's vector logo, then run `pnpm --filter web make-brand`. The placeholders are scaled from the 304 px PNG, so the 512 and 1024 px ones are soft.
- [ ] **macOS checks (added Day 5):**
  - Screen-share protection of the compact window in a full-screen share from Zoom, Teams and Google Meet (Chrome). On recent macOS versions, apps built on ScreenCaptureKit may capture the window despite `setContentProtection` (Electron docs); record each app and version, and say so honestly in the app if it is visible.
  - Screen Recording permission for screenshots (a denied permission shows the typed error).
  - The compact window: always on top, shown without taking focus, position remembered.

**Day 7: Test and release (Mon 2 Nov)**

| Time | Tasks |
|---|---|
| Morning | Three people use Kite on real internal calls: desktop Mac, desktop Windows, browser. Log issues. |
| Midday | Fix blockers only; rerun all tests; repeat the latency measurement. |
| Afternoon | Write `docs/user-guide.md`; record measured results; tag **v1.0.0**; production deploy; share installers. |

Release checks (all must pass):

- [ ] F1 to F11 work on desktop macOS, desktop Windows and browser (F12 may stay beta).
- [ ] Measured latency recorded and compared with the targets in section 6.2.
- [ ] Sign-in required everywhere; no public sign-up; Claude spend limit set.
- [ ] No transcript, document or answer text in any logs.
- [ ] "Delete session" and "Delete all local data" work.

## 13. Risks and fallbacks

| Risk | When | Fallback |
|---|---|---|
| **Transcription accuracy: names and technical terms often wrong** (Day 2 real call; ≈27% WER on the test sentences). The main known limitation. | Day 2 (measured) | In order: session hotwords from the session's details and documents (Day 3); the answer prompt tells Claude the transcript may contain misheard names and terms (Day 4); a native sherpa-onnx engine in the desktop app with a larger model, spiked after Day 4 (own ADR). A second pass in WebAssembly was tried and rejected (ADR-0020). |
| WebAssembly STT too slow on some laptops, especially on battery | Day 1–2 (measured) | Two channels used 0.30–0.44 of one core plugged in, **0.86 on battery** (still keeping up; the "Plug in your laptop" hint appears above 0.5). Fallbacks: the hint; one channel at a time; the native desktop engine behind `src/platform/` |
| STT model download size (204.5 MB first load) | Day 2 | Resolved for hosting: pinned Hugging Face URLs with SHA-256 checks and Cache Storage (ADR-0023); fallback Vercel Blob (Pro), Cloudflare R2 or a company server by changing only the URLs. Remaining: the first load takes about 30 s; Day 3 starts it when a session opens |
| Short echoes on speakers ("OKAY SO") | Day 2 (measured) | The echo filter judges only lines of 4+ words, so short replies are never hidden by mistake. Recommend headphones in the Connect view |
| **macOS: screen-share protection may not hide the compact window** | Day 5 (Electron docs; not verified: no Mac) | macOS applies `NSWindowSharingNone`, but apps built on ScreenCaptureKit (many recent meeting apps) can still capture the window. Checked on Day 6 on a Mac; if visible, the app says so next to the protection switch. Fallback: share a single window, or keep Kite on another monitor |
| Screenshots cover one monitor only | Day 5 | The desktop app captures the display the Kite window is on (the primary one if that cannot be told). A known v1 limit; a display picker is backlog |
| macOS system-audio loopback fails in Electron | Day 2 (not yet verified: no Mac; deferred to Day 6/7) | Use the browser path inside the shell (share-picker with audio), or a free virtual audio device (BlackHole) |
| **Claude usage limit reached**: every answer, warm-up, screenshot and note fails until the limit is raised or the month resets | Day 5 (happened on 30 Oct; access back 1 Nov 00:00 UTC) | The live view, the compact view and the notes say so plainly (`claude_unavailable`); the transcript and saving keep working. One spend limit for everything, the cost agreed before every paid run, evaluations by touched group only |
| Neon free-plan limits reached | Any | Upgrade the Neon plan; only accounts, sessions and daily request counts (one small row per user per day) are stored, so data is tiny |
| Latency above target **from far regions** | Day 4 (measured) | First word p50 about 1.1 s from Pakistan, of which about 0.5 s is the network to the US function; the server part (0.56–0.64 s) is within target. The §6.2 levers did not help further. Options: measure from the team's main location; Better Auth's cookie cache to skip the sign-in database lookup per request; a region near most users if they are not in the US (with the database and Claude a round trip away); keep Haiku; trim context |
| Behind schedule by Day 5 | Day 5 | Drop auto-answer (F12) and notes (F11) to v1.1; keep F1 to F10 |

## 14. After v1.0 (backlog)

1. Sync sessions between desktop and browser (server database).
2. More languages for transcription.
3. Export session to Markdown or DOCX.
4. Team-shared session templates and instructions.
5. Browser-tab reading (extension).
6. **Subdomain:** done on `call.paramountintelligence.co` for the web app (ADR-0046, §10.2). The desktop app stays on the `*.vercel.app` address; moving it would need automatic migration of local data first (ADR-0047).
7. **Microsoft Store (private audience), post-v1 (decided 2 Nov 2026):** the MSIX target and its manual CI job are kept (`docs/deploy/microsoft-store.md`); for v1, desktop users turn Smart App Control off if it blocks the unsigned app (user guide).

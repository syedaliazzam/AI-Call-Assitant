# Day 5 — Overlay, screenshots, notes, review and the learning loop (instructions for Claude Code)

**Goal:** Kite becomes usable during real calls and useful after them. By the end of Day 5:

1. A **compact always-on-top view** (desktop live window; browser picture-in-picture) shows the transcript line, the latest answer and an Answer button, so users don't need the full Kite window.
2. **Screen-share protection** hides the desktop live window from a Windows full-screen share (`setContentProtection` only; architecture §4 and §8).
3. **Screenshot → answer:** desktop captures the display; the browser grabs a frame from the shared tab; Claude answers about what's on screen (slides, code, documents).
4. **After the call:** AI notes (summary, questions asked, next steps) with Sonnet, a **session review page** (notes, full transcript, answers with ratings, delete), and the **learning loop**: up to 3 proposed lessons per call that the user approves; approved lessons go into future prompts.
5. **Feature-complete F1 to F11** (F12 auto-answer stays for Day 6).

**Read first:**
- `CLAUDE.md`;
- `docs/architecture/kite-architecture-v3.1.md` (version 3.4.0): §2 (F8–F11), §3.3 (platform adapter: `captureScreenshot`, `openCompactView`, `setShareProtection`), §4, §5 (compact view, review page, settings), §6.3 and §7.6 (caching, learning loop), §7.2, §7.3 (desktop `windows.ts`, `screenshot.ts`, `protection.ts`), §7.4, §8;
- `docs/decisions/ADR-0024`, `ADR-0025`;
- Day 4's `server/prompt.ts`, `claude.ts`, `core/answer/*`, `features/live/*`.

**Branch:** `day-05-overlay-notes`, from an up-to-date `main`. Pull request into `main` at the end.

---

## How to work today (same as Day 4)

Day 5 is split into **small stages, each with a gate**.

**For every stage:**
1. Build only what the stage lists.
2. Run the stage's gate plus `pnpm lint && pnpm typecheck && pnpm test`.
3. Gate passes: commit, push, short stage report (files, gate results with numbers), **continue automatically**.
4. Gate fails: fix within the stage's scope; if not possible, or the fix changes the design, **STOP and report options**.

**Verify yourself:** unit tests, harness tests (CI), Electron smoke tests, real-API scripts (usage and timings only), production deploys, and the production e2e suites with the test accounts (`kite-e2e@example.com`; the admin test account stays **disabled** except during a run that needs it, then is disabled again). The developer gets ONE short checklist at the end.

**Stop rules:**
- Never log or print transcript, document, question, answer, note, lesson or **screenshot** content. Screenshots are never saved to disk by Kite and never logged; they exist only in memory until the request is sent.
- **Screen-share protection uses `setContentProtection` only.** Never hide the app from the taskbar, Dock or process lists, never try to evade monitoring or proctoring software, and never claim protection the OS doesn't provide. Report macOS behaviour honestly.
- If an eval score drops after a prompt change, revert it and report.
- If an official API differs from our docs (Electron `BrowserWindow`, `desktopCapturer`, `setContentProtection`; Chrome Document Picture-in-Picture; Anthropic vision), follow the docs and say what changed.

---

## Stage 0 — Carry-overs from Day 4

| Item | Details |
|---|---|
| **Better Auth cookie cache** | Enable the session cookie cache with a short max age (**60 s**) so each answer skips the database lookup and avoids the free database's cold-start spikes (~1.4 s). Document the trade-off: disabling a user takes effect within 60 s instead of instantly. Update the Day 2 "disable signs them out" check and ADR-0022 accordingly. |
| **Latency record** | Record in ADR-0025 and architecture §6.2: from Pakistan, p50 to the first word is ~1.1 s (server share 0.56–0.64 s, ~0.5 s network); accepted for v1; still well below ParakeetAI's reported 2–4 s. |
| **Day 4 human checks** | Add the developer's results (passed in the Day 5 end checklist if not yet done). |

**Gate:**
- [ ] Unit/route tests: the cookie cache is on with max age 60 s; a disabled user is rejected within 60 s (test with a mocked clock).
- [ ] Re-run the Chrome production suite: passes; the answer's server timing shows no database lookup on cached requests.

## Stage 1 — Screenshot capture (platform adapter)

| Build | Details |
|---|---|
| `apps/desktop/src/screenshot.ts` | `desktopCapturer` → PNG of the display Kite's window is on (or the primary display); exposed as `window.kiteDesktop.captureScreenshot()`; Kite origin only. On macOS, report if Screen Recording permission is missing (typed error). |
| `apps/web/src/platform/desktop.ts` / `browser.ts` | `captureScreenshot()`: desktop calls the bridge; browser grabs the current frame from the **video track kept on Day 2** (shared tab) via `ImageCapture` or a canvas; typed `CaptureError` if no share is active. |
| `apps/web/src/core/screenshot/prepare.ts` | Downscale to ≤ 1,568 px on the long side (Anthropic's guidance), JPEG at a fixed quality, size check (≤ ~1 MB). Pure where possible; unit tested. |

**Gate:**
- [ ] Unit tests: downscaling and size rules; typed errors.
- [ ] Desktop smoke test: the bridge returns a PNG for the Kite origin only.
- [ ] Harness test: browser frame grab from a fake shared tab returns an image.

## Stage 2 — Screenshot answers (`mode: 'screenshot'`)

| Build | Details |
|---|---|
| `server/validate.ts`, `prompt.ts`, `route.ts` | `image` (base64 JPEG) accepted only for `screenshot`; size cap; the image goes in the **uncached** tail with the question ("What's on screen and how should I respond?" by default, or the typed chat text). Same streaming, `max_tokens` 400. |
| `features/live` | Screenshot button and hotkey (§7.3) → capture → prepare → answer; a small thumbnail shown in the answer panel (in memory only). |
| Eval | Add 3 screenshot scenarios (a slide with numbers, a code snippet with a bug, a pricing table) using invented images generated for the tests. |

**Gate:**
- [ ] Route tests (SDK mocked): image accepted only in screenshot mode; caps; no image data in logs.
- [ ] Real-API script: a screenshot answer streams; the cached blocks are still read.
- [ ] Eval: screenshot scenarios score ≥ 8 average; overall score not lower than Day 4's 9.43.

## Stage 3 — Desktop compact live window and screen-share protection

| Build | Details |
|---|---|
| `apps/desktop/src/windows.ts` | `openCompactView(sessionId)`: frameless, always-on-top, resizable, remembers size/position; loads `/live/[id]?view=compact` from the Kite origin only; closes when the call ends. |
| `apps/desktop/src/protection.ts` | `setShareProtection(on)`: `setContentProtection(on)` on the compact window, **re-applied every time it's shown**; returns whether the OS supports it. Off by default; toggle in Settings and in the compact view. |
| `apps/web/src/features/live/CompactView.tsx` | Latest transcript line, latest answer (headline + bullets, scrollable), Answer button, Screenshot button, protection indicator. |

**Gate:**
- [ ] Unit tests (Electron mocked): window options, origin lock, protection re-applied on show.
- [ ] Desktop smoke test: compact window opens on top, loads the compact view, closes on End.
- [ ] **Protection check (automated where possible):** on Windows, capture the screen with `desktopCapturer` while protection is on; the compact window's area must not show its content. Record the result. macOS: record "not verified" (Day 6/7).

## Stage 4 — Browser compact view (Document Picture-in-Picture)

| Build | Details |
|---|---|
| `apps/web/src/platform/browser.ts` | `openCompactView()`: Document Picture-in-Picture window (Chrome/Edge 116+) opened from a button click; renders `CompactView`; falls back to a message if unsupported. `setShareProtection` returns false with guidance (share one tab or window, or use a second monitor). |

**Gate:**
- [ ] Harness test: PiP opens on click and shows the latest answer (or the fallback message where unsupported in the test browser).

## Stage 5 — Post-call notes (`/api/notes`, Sonnet)

| Build | Details |
|---|---|
| `server/notes.ts`, `app/api/notes/route.ts` | Sonnet (`KITE_MODEL_SMART`, thinking setting per tier). Input: session block (cached, same bytes as answers), the whole call (stable lines + answers with ratings), and the user's notes on answers. Output (structured): summary (≤ 6 bullets), questions asked (with whether Kite answered and the rating), next steps (owner if said), and **up to 3 proposed lessons** (each one sentence, with the evidence: which answer and rating). Streaming not required; one request. Caps as §7.2. |
| `core/notes/generate.ts` | Called at End (and from the review page "Regenerate"); saves to `notes` (§7.4); never blocks End. |

**Gate:**
- [ ] Route tests (SDK mocked): shape, caps, no text in logs.
- [ ] Real-API script on an invented call: notes come back in the expected structure; usage printed only.
- [ ] Eval: 3 notes scenarios graded for faithfulness (nothing invented) ≥ 8 average.

## Stage 6 — Session review page

| Build | Details |
|---|---|
| `app/(app)/sessions/[id]/page.tsx`, `features/review/SessionReview.tsx` | AI notes (with Regenerate), the full saved transcript (You/Them, times), all answers with question, rating and note, call details, Delete session. If "Save transcript" was off: a note that only answers and notes were kept. |
| Dashboard | "Review" on ended sessions. |

**Gate:**
- [ ] Harness test: review page shows notes, transcript and answers from fixture data; delete works and returns to the dashboard.

## Stage 7 — The learning loop

| Build | Details |
|---|---|
| Storage | New `lessons` store (database version bump with an upgrade test): id, text, scope (`all` or a session type), source session, createdAt, status (`proposed` / `approved` / `rejected`). |
| Review page | Proposed lessons from the notes, each with **Approve**, **Edit**, **Reject**, and the scope choice. Nothing is learned without approval. |
| `features/settings` | **What Kite has learned:** list, edit, delete, scope; "Clear all lessons". Delete all local data removes them. |
| `server/prompt.ts` | The system block's "Learned preferences" slot is filled with approved lessons for the session's type plus `all` lessons (capped at 20, newest first), in a fixed, byte-stable order. Rules text: "Follow these preferences unless they conflict with the session's documents or the current conversation." |

**Gate:**
- [ ] Unit tests: lessons storage, scope filtering, cap, byte-stable serialisation; the rules block changes only when lessons change.
- [ ] Eval: add 2 scenarios where an approved lesson should change the answer (for example "give prices per seat and per month"); scores improve with the lesson present; overall score not lower.

## Stage 8 — Production checks and wrap-up

| Build | Details |
|---|---|
| Deploy | `vercel deploy --prod` + HTTP checks (as Days 3–4). |
| Production e2e | Extend the suites: screenshot answer (browser fake tab; desktop capture), compact view (desktop window, browser PiP where supported), End → notes appear → review page → approve a lesson → a new session's warm-up shows the rules block changed (one cache write) and the next answer follows the lesson. |
| Docs | Architecture **3.5.0** (§3.3 adapter methods as built, §4 protection results, §5 compact and review screens, §7.2 screenshot and notes, §7.3 windows/screenshot/protection, §7.4 lessons store, §7.6 learning loop as built, §13 risks). ADR-0026 (screenshots and share protection: what's captured, never stored, OS limits). README. |

**End-of-day human checklist (about 15 minutes):**
1. Day 4 leftovers, if not yet done: desktop hotkey while Notepad has focus; a real conversation where the second answer builds on the first.
2. **Windows full-screen share:** start a Teams/Meet/Zoom share of your entire screen (to a colleague or a test meeting), turn protection on, and confirm the other side does **not** see the compact window. Then turn it off and confirm they do.
3. **Screenshot answer:** open a slide or code on screen, press the Screenshot hotkey, check the answer is about what's shown.
4. **After the call:** End → notes appear → review page → approve one lesson → next session follows it.

Then STOP and give the PR link and description.

## Day 5 checklist (copy into the PR)

- [ ] Stage 0: cookie cache (60 s), latency recorded and accepted for v1.
- [ ] Screenshot capture (desktop + browser), downscaled; screenshot answers stream; nothing stored.
- [ ] Desktop compact window (always on top); protection via `setContentProtection` only; Windows result recorded, macOS deferred.
- [ ] Browser compact view (Document Picture-in-Picture) with fallback.
- [ ] Notes after the call (Sonnet) with up to 3 proposed lessons.
- [ ] Review page: notes, transcript, answers, delete.
- [ ] Learning loop: approve/edit/reject, Settings management, lessons in the cached rules block; eval shows the effect.
- [ ] Eval: overall not lower than 9.43; screenshot and notes scenarios recorded.
- [ ] Production e2e suites extended and passing (Chrome + desktop).
- [ ] Architecture 3.5.0, ADR-0026, README.
- [ ] No transcript, answer, note, lesson or screenshot content in any log or on disk.

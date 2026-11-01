# Day 6 — Accuracy (desktop speech engine), Windows installer, polish, subdomain prep

**Branch:** `day-06-packaging` from `main` (after PR #6 Day 5 and PR #7 UI are merged).
**Architecture:** `docs/architecture/kite-architecture-v3.1.md` (currently 3.5.0) → bump to **3.6.0** at the end of the day.
**Rules:** CLAUDE.md applies in full (comments, tests, secrets, logging, `platform/` is the only place desktop and browser differ, `setContentProtection` only).

## How to work today
- Stages are small. Each ends with: lint + typecheck + unit tests + the stage's gate, a Conventional Commit, a short report, then **stop and wait for "continue"** — except where the developer has said to continue automatically.
- **Paid Claude calls:** state the estimated request count and cost and get the developer's OK before running. Run only the eval groups a change touches. The full `eval:all` runs once at release (Day 7).
- **Measured numbers only** in `docs/testing/benchmark-results.md` (date, machine, power state, app version).
- **Power state matters for speed:** record plugged-in vs battery for every speed number (Day 1 lesson: battery throttling gave invalid readings).
- **Audio privacy:** test audio is the existing test set plus clips the developer records of himself (and people who agreed to it). No real customer calls. Never commit audio that contains other people without their consent; never log transcript text.
- **Stop and ask** before: adding a paid service, choosing where updates are hosted, anything that needs a certificate, DNS or Vercel plan change.

## Facts to rely on
- Current engine: sherpa-onnx v1.13.7 WASM, streaming Zipformer 2023-06-21, hotwords on (boost 2 / 1.5), beam 4. ~17% WER on read sentences, ~25–30% on real calls, names worst.
- A browser second-pass was tried on Day 2 and rejected (needed COOP/COEP headers). **On the desktop a native engine does not have that constraint.**
- The desktop shell is a thin Electron app; business logic lives in the web app. A native speech engine is a desktop *capability* exposed through `window.kiteDesktop`, chosen in `platform/`.
- Day 5 measured: Windows 11 laptop, one 1920×1080 monitor.

---

## Stage 0 — Baseline
- Create `day-06-packaging` from up-to-date `main`. Confirm production is on the merged Day 5 + UI build.
- Record a baseline row: current engine WER on the existing STT test set and on the names set (below), plugged-in and on battery.
- **Gate:** baseline numbers recorded; all tests green on the new branch.

## Stage 1 — Speech engine trial (measure only, no product change)
**Goal:** find out whether a native desktop engine gives clearly better accuracy, especially on names and our accents, at acceptable speed.

**Candidates** (latest stable versions; follow official docs; state model sizes and licences):
1. **NVIDIA Parakeet TDT 0.6B** (v2 English or v3 multilingual) via **sherpa-onnx native** (Node addon or its CLI) — offline/non-streaming, run per utterance.
2. **Whisper** via **whisper.cpp** — `large-v3-turbo` (quantized) and `small.en` — per utterance.
3. Control: the current streaming Zipformer.

**Design being tested (hybrid):** keep the current streaming engine for the grey, still-changing words; when an utterance ends (VAD/endpoint), the native engine re-decodes that utterance's audio and replaces it with the final text. Desktop only. The browser keeps the current engine.

**Test set** (`apps/web/tests/fixtures/stt/` — audio stays out of git if it contains anyone but the developer; use a git-ignored folder + a manifest with SHA-256):
- the existing read-sentences set;
- a **names set**: 40 short sentences containing our team, client and product names, plus tech terms, read by the developer (ask him to record it — give him the exact sentence list and a 1-command recorder);
- 5–10 minutes of conversational audio from consenting people (developer's own test calls with consent).

**Measure for each engine, plugged-in and on battery:**
- WER overall, WER on names set, **name accuracy** (% of names exactly right);
- time from end of utterance to final text (p50, p95);
- real-time factor, CPU %, peak memory;
- model download size, cold-start time;
- whether hotwords/contextual biasing is supported (Whisper: initial prompt; sherpa: hotwords) and its effect.

**Script:** `scripts/stt-trial.ts` produces a table and a JSON file; it never prints transcript text into logs (writes hypotheses to a git-ignored results file for the developer only).

**Decision rule** (write it in ADR-0027 before running):
Adopt a candidate for the desktop only if, on the developer's laptop **on battery**:
- names-set name accuracy improves by **≥ 15 percentage points** and overall WER improves by **≥ 25% relative**, and
- end-of-utterance → final text **p50 ≤ 0.8 s, p95 ≤ 1.5 s**, and
- it does not slow live answers (measure answer first-word latency during decoding), and
- total extra download ≤ 700 MB, with SHA-256 checked, cached, resumable.

**Gate:** results table in `benchmark-results.md`, ADR-0027 with the decision (adopt X / adopt nothing). **Stop for the developer's decision.**

## Stage 2 — Integrate the chosen engine (only if Stage 1 says adopt)
- Native engine runs in an Electron **utility process** (not the main process, not the renderer), so decoding never freezes the window.
- Bridge: `window.kiteDesktop.stt.finalize(segment)` → final text; typed errors; optional (older shells keep working).
- `platform/desktop.ts` picks hybrid mode when available; `platform/browser.ts` unchanged.
- Model download on first use with progress, SHA-256, resume, and a clear message on failure; fall back to the current engine automatically.
- Settings: "Accurate transcription (desktop)" on by default when available; shows model size and status.
- Session hotwords passed to the engine (initial prompt for Whisper / hotwords for sherpa).
- **Gate:** unit tests (bridge, fallback, download/verify), desktop smoke test decodes the fixture clip, live harness shows grey → final replacement with no flicker, Stage 1 numbers re-measured inside the real app (not only the script). Answer latency unchanged (p50 within 0.1 s of Day 5).

## Stage 3 — Windows installer and updates
- **electron-builder**, NSIS, per-user install (no admin), app name "Kite", publisher "Paramount Intelligence", icons from `apps/desktop/build/`, version from `package.json`, Start-menu shortcut, clean uninstall (keeps nothing except an opt-in "keep my local data").
- **Before implementing auto-update, stop and propose where updates are hosted.** The repo is private, so clients can't read its GitHub Releases without a token. Give options with pros/cons (e.g. a separate public releases-only repo, Vercel Blob, other), then wait for the decision.
- Then: `electron-updater` with that feed; checks on start and every 6 hours; downloads in the background; asks the user to restart; never updates during a live call.
- **Code signing:** without a certificate, Windows SmartScreen shows a warning on first run. Do not buy anything; write the "More info → Run anyway" step into the user guide and list "code-signing certificate" as a decision for the lead.
- **Gate:** build the installer; install silently on this laptop; launch the installed app and run the desktop smoke test against it; update test from `1.0.0-beta.1` to `1.0.0-beta.2` on the chosen (or a local test) feed; uninstall leaves no files in Program Files / AppData (except opted-in data). Record installer size.

## Stage 4 — Error screens and polish
Every failure says what happened and what to do, in the theme's style (U1–U4), with harness tests for each:
- offline / connection lost (transcript keeps working; answers paused);
- microphone permission denied / no microphone;
- "Them" audio silent for 20 s while connected (check the right tab/app is shared);
- speech model download failed / not enough disk space;
- sign-in expired mid-call (keep the transcript, ask to sign in again without losing the session);
- Claude unavailable (already done; keep).

**Headline length (added 1 Nov):** keep every headline at 15 words or fewer, including when an approved lesson asks for more detail. The Day 5 lesson evaluation (scenario 19) and the follow-up check (scenario 04) both went over 15 words (`docs/testing/answer-eval.md`). Ask the developer, with the estimated cost, before running its evaluation (`--only=lessons` and `--only=answers`).

**Auto-answer (beta, off by default):** when "Them" finishes a question (ends with "?" or starts with a question word, followed by ≥ 1.2 s pause), Kite answers automatically. Max one auto-answer per 15 s, never while an answer is streaming, a visible "Auto" label on auto answers, a setting with a short explanation. Unit tests for the question detector with 30 invented examples (≥ 90% correct); harness test for rate limiting.
- **Gate:** all error-state harness tests, detector tests, existing harnesses, screenshots of each error state at 1440 and 390 px; headline ≤ 15 words in the lessons and answers evaluations (after the developer agrees the cost).

## Stage 5 — Subdomain readiness (no DNS change today)
- All URLs from config: `BETTER_AUTH_URL`, trusted origins list (vercel.app + `kite.paramountintelligence.co`), desktop allowed-origin list, CSP, cookie domain.
- Desktop shell accepts exactly the configured Kite origins; a test refuses any other.
- Write `docs/deploy/subdomain.md`: the exact Vercel and DNS steps, what to change in env vars, how to verify (sign-in, cookies, desktop app, CSP), and how to roll back.
- **Gate:** tests for origin handling; a preview deployment works with the config pointing at a second test origin. **Do not change DNS or Vercel plan** (lead's decisions: Vercel Pro, DNS access).

## Stage 6 — macOS readiness (no Mac available)
- electron-builder `dmg` config, entitlements, `NSMicrophoneUsageDescription`, screen-recording permission flow text, icons (512/1024 placeholders until the designer's vector).
- Build an unsigned `.dmg` on a GitHub Actions macOS runner if possible; otherwise document the command.
- `docs/testing/macos-checklist.md`: a 15-minute script for a Mac tester (install, permissions, mic + system audio, compact window, protection limits on recent macOS, hotkeys).
- **Gate:** CI builds the dmg (or a documented reason it can't); checklist written.

## Stage 7 — Wrap-up
- Deploy the web changes to production; run the production e2e suites (browser + desktop).
- Architecture → **3.6.0**; ADR-0027 (speech engine), ADR-0028 (installer + updates host); `benchmark-results.md` updated.
- Open the Day 6 PR with: what changed, measured numbers, decisions for the lead (update host, code signing, Vercel Pro, DNS), and the end-of-day human checks.
- **Human checks are deferred to Day 7** (developer's decision, 1 Nov): add these to `docs/testing/final-test-plan.md` instead of running them today: install from the installer; a real test call with the new engine (if adopted) reading 10 names; one auto-answer; one error state (unplug network); uninstall/reinstall keeps or clears data as chosen.

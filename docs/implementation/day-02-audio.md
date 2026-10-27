# Day 2 — Audio and transcript (instructions for Claude Code)

**Goal:** Kite hears **both sides of a real call** and shows a live, labelled transcript, on the desktop app and in the browser, with speech-to-text accurate enough to build answers on. By the end of Day 2:

1. The speech-to-text engine from the Day 1 spike is **production code**: model files load from a pinned, verified source with a **download progress indicator**, are cached, and serve **two channels** ("You" and "Them") from one engine.
2. **"You"** = microphone. **"Them"** = the other side of the call:
   - desktop app: system-audio loopback, approved automatically for our origin only;
   - browser: a Chrome/Edge tab shared with "Also share tab audio".
3. A **Connect view** explains how to connect, shows live audio meters for both channels and runs a short test. A **TranscriptStrip** shows You/Them lines, partial text in grey and final text in black.
4. **Accuracy:** a two-pass option is measured, and ADR-0020 becomes **Accepted** with a configuration that scores **under 20% WER** on the 3 test sentences. If nothing reaches the bar, stop and report the options.
5. An **STT integration test** on a recorded WAV passes locally and in CI. CI also runs **actionlint**.

**Read first:**
- `CLAUDE.md`;
- `docs/architecture/kite-architecture-v3.1.md` §3.3 (platform adapter), §4 (desktop vs browser), §5 (Connect and Live screens), §6.1–6.2 (flow and latency targets), §7.1 and §7.3 (modules and desktop files), §8.1 (data), §9 (folders and code rules);
- `docs/decisions/ADR-0020-stt-model.md` (all of it, including the Day 1 results and risks);
- `docs/testing/benchmark-results.md` (Day 1 STT rows).

**Branch:** `day-02-audio`, created from an up-to-date `main`. Open a pull request into `main` at the end.

**After every stage:**
1. Run `pnpm lint && pnpm typecheck && pnpm test`.
2. Commit.
3. Print the stage summary (files + one-line purpose, commands to try, actions needed from the developer).
4. **STOP and wait for "continue".**

**Facts carried over from Day 1 (do not re-discover):**

| Fact | Detail |
|---|---|
| Runtime | sherpa-onnx **v1.13.7** WebAssembly, single-threaded SIMD, no COOP/COEP needed. It is the last release with official ASR WebAssembly builds. Official `.js`/`.wasm` are used unmodified. |
| Working streaming model | `streaming-zipformer-en-2023-06-21`, int8 encoder 187.8 MB, ~204 MB in total, loaded as separate files with `FS_createDataFile`. |
| Rejected model | `2023-06-26` (model A): fast but ~40–60% WER on our test voice. Keep it out of production code. |
| Hotwords | `modified_beam_search` + hotwords work in v1.13.7 WASM, **upper case only**, need `bpe.vocab` (built by `fetch-models` from the pinned `bpe.model`). Beam search costs 2–6%. |
| Endpointing | The model rule (1.0 s silence) plus a safety net (1.2 s with no new words). Keep both. |
| Measured (Chrome, plugged in) | RTF 0.24, lag ~0.5 s, cached load ~2.1 s, WER ~25% overall (5% / 24% / 53%). |
| Risks | On battery the RTF reached 0.6–0.7. Model size limit raised to **250 MB** (one-time download, cached, progress indicator required, revisit Day 7). |
| Hosting | Model files cannot go in the Vercel deploy (Hobby CLI uploads ≤ 100 MB). Developer preference: load from the **pinned Hugging Face URLs** with SHA-256 checks in the worker. |

**Stop rules (apply to every stage):**
- Combined real-time factor for **both channels** above **0.5** while plugged in, partial-text lag above **1.5 s** (p95 target), or WER not under 20% after Stage 5: stop and report options. Do not switch approach on your own.
- Never record or commit the developer's voice. Fixtures come from official, licence-clear sources only.
- Never log transcript text. Log ids, timings, sizes and counts only.

---

## Stage 1 — Speech-to-text engine: from spike to production module

**Goal:** one reusable engine that serves two channels, loads models from a verified remote source with progress, and reports health.

**Create / change:**

| File | Contents |
|---|---|
| `apps/web/src/core/stt/models.ts` | Production model registry: id, files, pinned source URL per file (Hugging Face `resolve/<commit>` URLs for model files; the runtime `.js`/`.wasm` from the pinned release, see "Hosting" below), byte size and SHA-256 per file, total size, licence. Remove model A from the production list (keep it only behind the dev page if still useful, clearly marked). |
| `apps/web/src/core/stt/download.ts` (new) | `downloadModelFiles(model, { onProgress, signal })`: streams each file with `fetch`, reports bytes done/total, verifies **SHA-256** with Web Crypto before use, stores verified files in Cache Storage under a versioned cache name, and reuses cached files on later loads. Throws a typed error on a checksum mismatch, network failure or quota error. Pure helpers (progress maths, cache keys) are unit tested. |
| `apps/web/src/core/stt/stt.worker.ts` | One worker, **one recognizer, one stream per channel** (`you`, `them`). Messages: `load` (model id, hotwords), `accept` (channel, samples, capture time), `reset` (channel), `stop`. Events: `progress`, `ready`, `partial` / `final` (with channel, tStart, tEnd), `stats` (per-channel RTF, chunk time, lag), `error`. Keeps both end-of-utterance rules per channel. |
| `apps/web/src/core/stt/protocol.ts` | Typed messages for the above; every field commented. |
| `apps/web/src/core/stt/sttEngine.ts` (new; replaces the spike's `sttClient.ts` for production use) | `createSttEngine({ model, hotwords, onProgress, onPartial, onFinal, onStats, onError })` → `{ ready, attach(channel, MediaStream), detach(channel), setHotwords(list), stop }`. Owns the worker and one resampler worklet per attached channel. No React. |
| `apps/web/src/core/stt/health.ts` (new) | Turns live stats into a simple status: `ok`, `falling-behind` (RTF > 0.8 for 5 s), `stalled`. Used by the UI to show "Transcription is falling behind — plug in your laptop or close other apps". Unit tested. |
| `apps/web/scripts/fetch-models.ts` | Keep for local development and CI. It must use the same pinned URLs and SHA-256s as `models.ts` (import them; one source of truth). |
| `.github/workflows/ci.yml` | Add an **actionlint** step (official release binary, pinned version and checksum) to the web job, so a broken workflow fails the pull request. |

**Hosting the model files (decide here, record in ADR-0020):**
1. Check that the pinned Hugging Face `resolve/<commit>` URLs can be fetched from the browser (CORS headers present, redirects followed) from `localhost` and from `https://kite-call-assistant.vercel.app`.
2. Check whether the runtime `.js`/`.wasm` (~13 MB) can be served from our Vercel deploy (it fits under the 100 MB limit) so the runtime stays on our origin. Prefer that.
3. If Hugging Face fails the CORS check, stop and report the options (Vercel Blob, Cloudflare R2, company server) with their limits.
4. Local development keeps working offline from `public/models/` (a setting in `models.ts` picks `local` or `remote`; default `remote` in production builds, `local` in `pnpm dev`).

**Measure (Chrome, plugged in), on the dev page, with two channels attached:**
- combined RTF and per-channel RTF, with speech on one channel and silence on the other;
- memory use of the worker (Chrome Task Manager), with one and with two channels.

If the combined RTF is above 0.5, try in this order and report: skip decoding for a channel whose audio is silent (energy gate before `acceptWaveform`, with a short hangover so word starts are not cut); then two workers (report memory). Do not continue past this stage until the number is under 0.5.

**Check:**
- [ ] First load in Chrome with an empty cache shows a progress bar that reaches 100%, then "Ready". A second load uses the cache (no network download).
- [ ] A file with a wrong SHA-256 (simulate in a unit test) is rejected and never used.
- [ ] Two channels run at once; combined RTF ≤ 0.5 plugged in; numbers recorded.
- [ ] actionlint runs in CI.

---

## Stage 2 — Capturing "Them": desktop loopback and browser tab audio

**Goal:** `getOtherSideStream()` works on both platforms. "You" and "Them" stay separate.

**Desktop (`apps/desktop`):**

| File | Contents |
|---|---|
| `src/media.ts` (new) | `allowSystemAudioLoopback(session)`: uses `session.setDisplayMediaRequestHandler` to approve `getDisplayMedia` **only** for requests from `ALLOWED_ORIGIN`, returning a screen source plus `audio: 'loopback'`. Follow the official Electron docs for Electron 44 (Windows loopback; macOS requirements and minimum version). Any other origin: deny. Also the existing microphone permission rule (move it here from `security.ts` if that keeps things clearer). |
| `src/main.ts` | Apply `allowSystemAudioLoopback` to the default session. |
| `tests/unit/media.test.ts` | Approves only our origin; denies others; returns loopback audio. Electron mocked. |
| `tests/smoke.spec.ts` | Extend: the fixture page calls `getDisplayMedia({ audio: true, video: true })` and gets an audio track without any picker. |

**macOS:** if this machine cannot test macOS, implement from the official docs, add the unit tests, and list "macOS loopback: not verified" in the stage summary. If loopback is not supported on the user's macOS version, the platform adapter must return a clear typed error so the UI can fall back to the browser path (share a tab or window with audio).

**Web (`apps/web/src/platform/`):**

| File | Contents |
|---|---|
| `types.ts` | `getOtherSideStream()` returns `{ stream, source: 'system-loopback' \| 'tab-audio' \| 'screen-audio' }`, or throws a typed `CaptureError` (`no-audio-track`, `user-cancelled`, `not-supported`, `permission-denied`). Every field commented. |
| `media.ts` | `getMicStream()` with `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true` (comment why: speakers leaking into the mic). |
| `desktop.ts` | `getOtherSideStream()`: calls `getDisplayMedia({ audio: true, video: true })` (the shell approves it), **stops the video track straight away** (comment: not needed until Day 5 screenshots), returns the audio track. |
| `browser.ts` | `getOtherSideStream()`: calls `getDisplayMedia` with audio requested and tab-sharing preferred (use the official Chrome options for tab audio), keeps the video track for Day 5 screenshots but does not render it, and throws `no-audio-track` if the user forgot "Also share tab audio". |
| `tests/unit/platform/*` | Typed errors for each failure case; video track stopped on desktop; audio-track check in the browser. |

**Check:**
- [ ] Desktop (Windows): play a YouTube video or join a test call; the "Them" stream has an audio track with signal, and no picker appears.
- [ ] Browser: sharing a tab **with** "Also share tab audio" gives an audio track; sharing **without** it gives the `no-audio-track` error.
- [ ] The microphone and the other side are separate `MediaStream`s.

---

## Stage 3 — Transcript core (in memory)

**Goal:** a React-free model of the live transcript that the UI renders and Day 3/4 build on.

| File | Contents |
|---|---|
| `apps/web/src/core/transcript/transcript.ts` | `createTranscript()` → add partial (replaces the channel's current partial), add final (appends an utterance), `lines()` in time order, `window(minutes)` for the last N minutes, `clear()`, and a subscribe function. Utterance: `{ id, speaker: 'you' \| 'them', text, tStart, tEnd, final }`. Day 3 adds IndexedDB saving (comment with the day). |
| `apps/web/src/core/transcript/merge.ts` | Rules for close-together lines: consecutive finals from the same speaker within 1.5 s merge into one line; partials never merge. |
| `apps/web/src/core/audio/capture.ts` | `startCallCapture({ engine })` → asks the platform for mic + other side, attaches both to the engine, exposes per-channel audio levels for meters, returns `{ stop }`. Handles a channel ending (tab closed, device unplugged) by emitting a typed event. |
| `apps/web/src/core/audio/levels.ts` | Pure RMS → 0..1 level with smoothing, for the meters. Unit tested. |
| Tests | `transcript.test.ts`, `merge.test.ts`, `levels.test.ts`, `capture.test.ts` (platform and engine mocked). |

**Check:**
- [ ] Unit tests cover ordering, partial replacement, merging and the time window.

---

## Stage 4 — Connect view and TranscriptStrip

**Goal:** the first real screens of the live flow. Sessions arrive on Day 3, so Day 2 mounts them on a temporary route.

| File | Contents |
|---|---|
| `apps/web/app/(app)/live/[id]/page.tsx` | Thin route. On Day 2 only the id `demo` is accepted (other ids → 404 with a comment "Day 3: load the session from IndexedDB"). Signed-in users only (existing guard). |
| `apps/web/src/features/live/LivePage.tsx` | Holds the flow: Connect view first; after "Connect", the transcript view. Creates the engine and capture through `core/`, never calls media APIs directly. |
| `apps/web/src/features/live/ConnectPanel.tsx` | Mirrors ParakeetAI's connect dialog: how to connect for this platform (desktop: "Kite hears your microphone and your computer's sound — join your call in any app"; browser: step-by-step "pick the meeting tab and tick **Also share tab audio**", Chrome/Edge only), model download progress, two live meters (You / Them), a 5-second test that shows a sample line for each channel, clear messages for every `CaptureError`, a "Use headphones for best results" note (comment: speakers leak into the mic). |
| `apps/web/src/features/live/TranscriptStrip.tsx` | Lines labelled **You** / **Them** (different colours), partial text grey, final black, auto-scroll that pauses when the user scrolls up, the health warning from `core/stt/health.ts`. |
| `apps/web/src/features/live/AudioMeter.tsx` | Small level bar for one channel. |
| `apps/web/src/ui/Sidebar.tsx` | Dev tools index gets a link to `/live/demo` (admins only) until Day 3 adds real sessions. |
| Hotwords | On `/live/demo`, the engine uses a fixed list from `features/live/demoHotwords.ts` (e.g. "PARAMOUNT INTELLIGENCE", "KITE"). Comment: Day 3 builds the list from the session's company, role and documents. |

Keep the visual style consistent with the Day 1 screens (Tailwind, `src/ui` components).

**Check:**
- [ ] Browser: open `/live/demo`, Connect, share a tab playing speech with tab audio: "Them" lines appear; speaking into the mic: "You" lines appear.
- [ ] Desktop: the same, with any app playing audio; no picker.
- [ ] Every capture error shows a clear message and a retry button.

---

## Stage 5 — Accuracy: two-pass evaluation and the ADR-0020 decision

**Goal:** get WER under 20% on the 3 Day 1 test sentences without breaking the latency targets, then accept ADR-0020.

**Idea:** keep fast streaming partials for the live grey text, and when an utterance ends, re-decode that utterance's audio with a more accurate **non-streaming** model. The final line shown and stored is the second-pass text.

**Do:**
1. From the official sherpa-onnx v1.13.7 release and documentation, list the **non-streaming** English models that run in the official WebAssembly builds (for example Whisper tiny/base English, Moonshine, or others the release ships), with sizes and licences. Include the official Silero VAD if it comes with that build.
2. Pick **at most two** candidates that fit the budget: streaming model + second-pass model + VAD **≤ 250 MB** in total. If needed, propose using a smaller streaming model for partials only; say what that does to the grey text.
3. Build the second pass as an option in the worker (`secondPass: 'off' | '<model id>'`), keeping the per-utterance audio in memory only until it is re-decoded (comment: audio never stored or sent).
4. Add a "second pass" switch and the second-pass latency (end of speech → final line) to the `/dev/stt-test` page.
5. **Developer measurement:** give the developer exact steps to read the 3 sentences for each configuration (streaming only; streaming + candidate 1; streaming + candidate 2), plugged in, in Chrome. Record WER, RTF, partial lag, final-line latency and total download size.

**Decide (with the developer's numbers):**
- If a configuration is under 20% WER with partial lag ≤ 0.8 s p50, final-line latency ≤ 1.5 s after end of speech and combined RTF ≤ 0.5: set ADR-0020 to **Accepted** with that configuration and make it the engine default.
- Otherwise: **stop and report the options**, including a native engine in the desktop app (not built today).

Update `docs/testing/benchmark-results.md` (measured rows only) and ADR-0020.

**Check:**
- [ ] ADR-0020 Accepted with measured numbers, or a clear options report.

---

## Stage 6 — STT integration test

**Goal:** a repeatable test that the whole pipeline (worklet → worker → recognizer → transcript) turns a known recording into the expected text.

| File | Contents |
|---|---|
| `apps/web/tests/fixtures/audio/` | One or two short WAV files from the **official sherpa-onnx model repos' `test_wavs/`** (Apache-2.0), with their reference transcripts and a `SOURCES.md` naming the source, commit and licence. Never the developer's voice. |
| `apps/web/tests/integration/stt.spec.ts` | Playwright with Chromium's fake audio flags (`--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture=<wav>`): open the dev test page (or a dedicated test page), run the engine with the chosen configuration, and assert WER ≤ a stated threshold against the reference transcript, plus that a final line was produced. |
| `apps/web/package.json` | Script `test:stt` (needs the model files; prints a clear message and skips if they are missing locally). |
| `.github/workflows/ci.yml` | New job `stt-integration` on `ubuntu-latest` for pull requests and pushes to `main`: runs `fetch-models` with the model files cached by `actions/cache` (key = the pinned SHA-256 list), then `test:stt`. Comment: Linux minutes count 1×; the cache avoids downloading ~250 MB on every run. |

**Check:**
- [ ] `pnpm --filter web test:stt` passes locally.
- [ ] The CI job passes on the pull request.

---

## Stage 7 — Real-call checks, docs and wrap-up

**Developer checks (Claude Code gives exact steps and waits for results):**
- [ ] **Desktop, Windows:** a real call in Zoom, Teams or Meet (desktop app) with a colleague: both sides transcribed and labelled correctly for 2 minutes. Note anything missed or mislabelled.
- [ ] **Browser:** Google Meet in a Chrome tab with tab audio shared: both sides transcribed and labelled.
- [ ] **macOS desktop:** if a Mac is available, the same as Windows; otherwise mark "deferred to Day 6/7" in the PR.
- [ ] **Battery:** one 2-minute run on battery; record the combined RTF and whether the health warning appears.
- [ ] Measured partial lag and final-line latency during the real call recorded in `benchmark-results.md`.

**Deploy:**
1. `vercel deploy --prod` (the developer runs it).
2. Check `/live/demo` on `https://kite-call-assistant.vercel.app`: the model downloads from the chosen remote source with the progress bar, then both channels work in Chrome. Then in the desktop app with `pnpm --filter desktop start`.

**Docs:**
- `docs/architecture/kite-architecture-v3.1.md`: bump to **3.2.0** — §6.1 flow (two-pass if accepted), §7.1 modules (new files), §7.3 (`media.ts`), §10 (model hosting), §13 risks (battery, model size, macOS loopback status). Regenerate nothing by hand; note in the PR that the DOCX is regenerated separately.
- `docs/decisions/ADR-0020-stt-model.md`: final decision.
- `docs/decisions/ADR-0023-stt-model-hosting.md` (new, from `TEMPLATE.md`): where production loads model files from, why, limits, and the fallback.
- `README.md`: how to use `/live/demo`, how model files load in dev vs production, how to run `test:stt`.

**Finish:**
1. Run `pnpm lint && pnpm typecheck && pnpm test`.
2. Commit, then push `day-02-audio`.
3. Give the developer the steps to open the pull request into `main`, plus a title and a description with the measured results and known risks.
4. Print the Day 2 checklist and STOP.

---

## Day 2 checklist (copy into the PR)

- [ ] Engine loads models from the pinned remote source with SHA-256 checks and a progress bar; cached on later loads.
- [ ] Two channels at once; combined RTF ≤ 0.5 plugged in (measured).
- [ ] Desktop loopback works on Windows without a picker; macOS verified or deferred with a reason.
- [ ] Browser tab audio works; missing "share tab audio" gives a clear message.
- [ ] Connect view and TranscriptStrip work on desktop and in the browser.
- [ ] ADR-0020 Accepted (WER < 20%), or an options report.
- [ ] ADR-0023 (model hosting) written.
- [ ] STT integration test passes locally and in CI; actionlint in CI.
- [ ] Real call checks done (desktop Windows, browser Meet); battery run recorded.
- [ ] No transcript text in any log; no developer voice in the repo.

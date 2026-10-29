# ADR-0020: Speech-to-text model (WebAssembly, v3.0)

- **Status:** **Accepted** (2026-10-28) for streaming-only: Zipformer 2023-06-21 with hotwords, two channels with the energy gate, the echo filter, model files from Hugging Face. Accuracy is still above the 20% bar (≈27% overall), and in the Day 2 real call names and technical terms were often wrong (see "Real-call result"). This is Kite's main known limitation. The second pass tried in Day 2 Stage 5 did not meet the bar and was removed (see "Second pass (Day 2, Stage 5): tried and rejected"). Next levers: session hotwords (Day 3); telling Claude that the transcript is imperfect (Day 4); a native desktop engine spike after Day 4.
- **Date:** 2026-10-24 (created); 2026-10-27 (Day 1 spike results; Day 2 hosting and two-channel engine); 2026-10-28 (Day 2 Stage 5: second pass measured and rejected; Accepted for streaming-only. Stage 7: real-call result)
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6, §12 Day 1
- **Supersedes / superseded by:** none

## Context

Kite transcribes both call channels locally with sherpa-onnx compiled to WebAssembly (in a Web Worker). The v3.1 plan also listed Silero VAD; Kite uses its own energy gate instead (see "Two channels and the energy gate"), and Silero VAD was tried only as part of the rejected second pass. The same code runs in Chrome/Edge and in the Electron desktop shell, on macOS (Apple Silicon) and Windows x64 (v3.0, ADR-0021).

## Candidates (in order of preference)

1. sherpa-onnx streaming Zipformer English, int8 (small download, proven WebAssembly streaming)
2. Moonshine v2 streaming, Small (MIT licence), if it runs well in WebAssembly
3. NVIDIA Nemotron Speech Streaming EN 0.6B, INT8 (best accuracy, but ~650 MB is likely too large to download in a browser)

## Decision rule (Day 1 spike)

Pick the first candidate that meets all of these on **both** OSes:

- it runs in sherpa-onnx WebAssembly in Chrome/Edge and in the Electron shell;
- the model download is ≤ 150 MB (cached after the first load). **Raised to ≤ 250 MB on 2026-10-27, with conditions** (see Decision);
- partial text arrives ≤ 1 s behind speech;
- CPU use is ≤ 50% of one performance core per channel;
- the licence is acceptable for internal company use.

The accuracy bar used on Day 1: **under 20% word error rate (WER)** on the 3 fixed test sentences on `/dev/stt-test` (51 words, read by the developer).

## What was tested on Day 1

Both models are sherpa-onnx streaming Zipformer English (candidate 1). Both run on the official sherpa-onnx **v1.13.7** WebAssembly runtime (the SIMD build, single-threaded, unmodified). Numbers are in `docs/testing/benchmark-results.md`.

| | Model A: `streaming-zipformer-en-2023-06-26` | Model B: `streaming-zipformer-en-2023-06-21` |
|---|---|---|
| Training data | LibriSpeech | LibriSpeech + GigaSpeech |
| Download (with the 13.2 MB WebAssembly binary) | 87.4 MB | 204.1 MB (int8 encoder alone: 187.8 MB) |
| Real-time factor (Chrome, plugged in) | 0.19 | 0.24 |
| Lag, speech → first partial | ~845 ms | 501 ms (Chrome, median); 1,231 ms (desktop, one utterance) |
| Cached load | 3.4 s | ~2.1 s |
| Accuracy | Poor: sentence 3 ≈80% WER (names and words wrong) | ≈25% overall with hotwords (13 errors / 51 words) |
| Result | **Rejected for accuracy** | **Working engine for Day 2** (accuracy still above the bar) |

## Decision

1. **Engine.** Use sherpa-onnx streaming Zipformer English **2023-06-21** with **hotwords** as the working speech-to-text engine for Day 2. It runs in a Web Worker with `modified_beam_search` (4 active paths). Hotwords are needed for names. Sources and versions are pinned with SHA-256 in `apps/web/scripts/fetch-models.ts`.
2. **Accuracy is above the bar, and this is accepted for now (Day 2 Stage 5).** Day 1: overall WER ≈25% (sentence 1: 5%, sentence 2: 24%, sentence 3: 53%). Day 2 Stage 5 baseline: 27.5% (0%, 29%, 60%). The bar is 20%. Sentence 3 (names) is the weak point.
3. **Two passes were tried on Day 2 and rejected.** A second, non-streaming model re-decoded each finished utterance. No configuration came clearly under 20% (see "Second pass (Day 2, Stage 5): tried and rejected"), so Kite stays streaming-only. The developer accepted this ADR for streaming-only on 2026-10-28. The next levers, in order:
   - **session hotwords (Day 3):** names and terms from the session's details and documents. Sentence 3's errors and the real-call errors are mostly names and terms, which is what hotwords target;
   - **tell Claude the transcript is imperfect (Day 4):** the answer prompt says the transcript comes from live speech recognition and may contain misheard names and terms, so Claude should read through likely mishearings using the session's documents instead of repeating them;
   - **a native sherpa-onnx engine in the desktop app (spike after Day 4; Day 6 option)**, if accuracy is still a problem after Day 4. It is multi-threaded and faster than WebAssembly, so it could run a larger, more accurate model. It would live behind `src/platform/` and need its own ADR.
4. **Model A (2023-06-26) is rejected for accuracy.** Hotwords did not help it. It was removed from the test page's picker in Day 2 Stage 5.
5. **Size limit raised to 250 MB, for now.** The download is 204.1 MB. Conditions:
   - it is a one-time download, then cached in the browser's Cache Storage. Cached loads measured about 2.1 s;
   - a **download progress indicator is required** in the real UI (Day 2);
   - **revisit on Day 7.**

   Loading the model's files separately instead of using the official bundle saves almost nothing (3 KB), because the int8 encoder alone is 187.8 MB. The int8 decoder and joiner would save only another 2.3 MB.
6. **End of utterance: keep both rules.** Each final line on the test page records which rule ended it:
   - the recognizer's own endpoint rule: about 1.0 s of decoded silence after text;
   - a safety net in the worker: no new words for 1.2 s of audio.

   In Chrome the model rule ended the utterances. In the desktop app the safety net did (one utterance). Silero VAD is not used. It was left out of the spike because the official streaming example does not use one. On Day 2 the energy gate covered its job, and Silero VAD was tried only inside the rejected second pass.

### Hotwords

The v1.13.7 WebAssembly build supports hotwords. They are passed in the recognizer config (`hotwordsBuf`), encoded with `modelingUnit: 'bpe'` and a `bpe.vocab` file.

- **Upper case only.** The model's vocabulary has only upper-case letters and the apostrophe, and sherpa-onnx silently ignores a phrase it cannot encode. `apps/web/src/core/stt/hotwords.ts` upper-cases and cleans each phrase.
- **Where `bpe.vocab` comes from.** The model repositories ship only `bpe.model`. `fetch-models.ts` converts it into `bpe.vocab` the way sherpa-onnx's own `scripts/export_bpe_vocab.py` does, and checks the result against a pinned SHA-256.
- **Effect.** In an automated check with synthetic (Windows text-to-speech) audio, hotwords turned "BLUEFIN ROOT … NORTH WIND LOGISTICS" into the exact names. With the developer's voice, sentence 3 was still 53% WER.
- **When they apply.** The JS API takes hotwords only when the recognizer is created, so changing them means re-creating it. Day 3: the list is built from the session's details and documents.

### Runtime facts and risks

- **v1.13.7 is the last sherpa-onnx release with official ASR WebAssembly builds.** v1.13.8, 2.0.0 and 2.0.1 have none. Upgrading means either building the WebAssembly runtime ourselves from the sherpa-onnx source (Emscripten, `build-wasm-simd-asr.sh`) or staying on v1.13.7. Any upgrade must re-run the `/dev/stt-test` measurements.
- **Dependency on Emscripten internals.** The runtime's own 191 MB `.data` package is skipped: `Module.getPreloadedPackage` returns an empty buffer. The model files are then written into its in-memory file system with `Module.FS_createPath` and `Module.FS_createDataFile`. These are Emscripten file-system APIs, not sherpa-onnx APIs, so a different runtime build could change or remove them. That would show up at once as a load error on `/dev/stt-test`.
- **No COOP/COEP headers are needed.** The official build is single-threaded (no pthreads), so it needs no `SharedArrayBuffer` and no cross-origin isolation. Sign-in and the rest of the app are unaffected. (The Day 2 Stage 5 second pass needed them for a threaded runtime; they were removed with it.)
- **Known risk: battery power.** Real-time factor rose to about 0.6–0.7 on the same laptop running on battery (Windows Balanced plan, CPU held at 1.7 GHz), above the 0.5 limit. Plugged in, it was 0.24. Mitigations to evaluate later:
  - tell users to stay plugged in during calls;
  - a native sherpa-onnx engine in the desktop app (multi-threaded, faster than WebAssembly). It would live behind `src/platform/` and need its own ADR.
- **Not yet measured.** macOS (Apple Silicon); Edge; two channels at once (the CPU limit is per channel, and Day 2 adds the "Them" channel). Desktop accuracy was measured on sentence 1 only.
- **Licence.** Both models and sherpa-onnx are Apache-2.0, which is acceptable for internal company use.

### Serving the files (decided on Day 2, Stage 1)

Day 1 kept the model files out of git and out of Vercel uploads, because a Hobby CLI deployment can upload at most **100 MB** of source files (1 GB on Pro; Vercel limits page, checked 2026-10-27). Day 2 decided how production loads them. All pins are in `apps/web/src/core/stt/models.ts`, the single source of truth for the browser and for `fetch-models`.

**Model files (191.2 MB): from the pinned Hugging Face commit URLs.** This was the developer's preference.
- **Integrity:** the worker checks each file's size and SHA-256 with Web Crypto before using it (`core/stt/download.ts`). A mismatch is rejected with a typed error and never cached.
- **Caching:** verified files go into Cache Storage (`kite-stt-v2`), keyed by their SHA-256, so later loads skip the network.
- **CORS, checked 2026-10-27:**
  - Hugging Face's `resolve/<commit>` answers with a 302/307 redirect that carries `Access-Control-Allow-Origin` for the requesting origin.
  - The large files redirect to `us.aws.cdn.hf.co`, which sends `access-control-allow-origin: *` and supports byte ranges.
  - In Chromium, from a local origin, the full load worked: 204.5 MB in 28.8 s (first load), 3.0 s from the cache.
  - From `https://kite-call-assistant.vercel.app` (developer, DevTools, 2026-10-27): **passed**. `tokens.txt` returned status 200 after the redirect with the right SHA-256, and a range request on the encoder returned 206 (`bytes 0-0/187823992`).

  **Hugging Face hosting is confirmed for production.** ADR-0023 (Stage 7) records it with its limits and fallbacks.
- **Why not Vercel Blob:** Hobby's 10 GB/month Blob transfer covers only about 49 first-time downloads. Above that, Hobby blocks Blob access for 30 days.
- **Risk:** the app depends on Hugging Face at first load. Mitigations: files are cached after the first load; the pins are immutable commits; and the checksum check means a changed or substituted file is never used.
- **Fallbacks if Hugging Face becomes unusable:** Vercel Blob, Cloudflare R2, or a company server. Each is only a different `url` per file in `models.ts`; the checksums stay the same. ADR-0023 (Stage 7) records this in full.

**Runtime (13.3 MB: loader `.js`, `.wasm`, API `.js`): from our own origin,** `/stt-runtime/v1.13.7/`.
- **Why our origin:** the official release ships these files only inside a 175 MB `.tar.bz2`, which a browser cannot use.
- **How it gets there:** every build runs `pnpm run stt:runtime` before `next build`, so any machine can deploy from a fresh clone. That step:
  1. downloads the pinned release and checks its SHA-256;
  2. extracts only the three files and checks each one;
  3. runs `scripts/check-stt-runtime.ts`, which fails the build if a file is missing or wrong.
- **Vercel can run it:** the build image (Amazon Linux 2023) lists `tar`, `bsdtar` and `bzip2` as pre-installed (Vercel build-image docs, checked 2026-10-27). Locally, the step took 1 min 16 s from scratch and skips the download when the files are already present and verified.
- **GNU tar (fixed in Day 2 Stage 6):** the archive stores its files as `./<folder>/<file>`. GNU tar (Linux CI, Vercel) does not match `<folder>/<file>` against that, so the step first failed in CI. It now lists the archive and extracts the names exactly as listed. The production build on Vercel passed after the fix (Stage 7). Full hosting decision: ADR-0023.
- **The worker runs the runtime from its verified bytes** (through Blob URLs), not from a second fetch.

**Development:** `pnpm dev` loads model files from `public/models/stt/` (source `local`, works offline after `pnpm --filter web fetch-models`). Production builds use `remote`. `NEXT_PUBLIC_STT_SOURCE` overrides either.

### Two channels and the energy gate (Day 2, Stage 1)

One worker runs one recognizer, with one stream per channel ("you", "them"). Automated runs in Chromium (Electron 44, plugged in), with the official recordings on "Them" and synthetic text-to-speech on "You" (not a person's voice), showed two problems:
- each channel cost a real-time factor of about **0.25 whether it carried speech or silence**, so two channels reached **0.50–0.51**, at or above the 0.5 limit;
- a digitally silent channel produced phantom "AND" lines.

Following the Day 2 order of fallbacks, an **energy gate** (`core/stt/gate.ts`) now skips decoding while a channel is idle. It is lenient by design, because a loudness threshold cut sentences on Day 1:
- it never closes while an utterance shows text;
- it stays open 1.5 s after the last sound;
- it opens above max(0.004 RMS, 2.5 × the background level), where the background is the quietest chunk of the last 5 s;
- it replays 300 ms of pre-roll when it opens.

With the gate, in the same automated runs:
- speech on both channels: combined real-time factor **0.42**;
- speech on "Them" with a silent "You": **0.24**, and the silent channel costs nothing;
- no phantom words.

The worker's WebAssembly memory is about **537 MB**, the same with one channel or two.

**Measured by the developer** (Chrome, plugged in, real microphone; details in benchmark-results.md):

| Run | Combined real-time factor | Per channel |
|---|---|---|
| A: "Them" only | 0.232 | — |
| B: both channels, developer silent | 0.430 | Them 0.220, You 0.210 |
| C: both channels, developer reading | 0.344 | Them 0.219, You 0.126 |

All three are under the 0.5 limit, so Stage 1's two-channel check passes. "Them" lag was 564–787 ms.

**Known behaviour: nearby speech is transcribed on "You."** In run B, someone talking at a distance in the room produced 11 short "You" lines ("YEAH", "UM", …). These are real words picked up by the microphone, not phantom words, and they also kept the "You" gate open. The gate is not made stricter for this, because quiet speakers must not be cut. Instead, the Connect view (Stage 4) tells users to use headphones and a quiet room. Silero VAD, evaluated in Stage 5, may reduce it.

**"You" lag of about 1.0 s in run C.** Measured offline on 59 utterances, the gate opens in the same 100 ms chunk as the speech onset (median 0 ms added, worst 100 ms) and passes 98.6–99.8% of the speech audio. It is not the cause. The likely cause was the measurement itself: the lag clock started at the *first* onset after a pause, so background speech that produced no text could start it early. The lag now starts at the **latest** onset before text appears, and each utterance also records the gate's added delay (`gateDelaysMs`, 0 ms on 6/6 utterances in an automated run). The "You" lag is re-measured in the next developer run against the 0.8 s p50 target.

**Known behaviour: speaker leakage onto "You" (Day 2, Stage 2).** With call audio on the laptop's speakers, the microphone picked up short fragments of the other side ("ABOUT ONE ISLAND", "YOU MAY") despite echo cancellation. "Them" itself was unaffected, because it is captured separately (system loopback or tab audio). Headphones avoid it; the Connect view says so.

**Echo filter (Day 2, Stage 4).** On speakers, whole "Them" sentences reappeared as "You" (for example "NINETY SIX TIMES IT RECOMMENDED…" / "…YOU'D RECOMMENDED…"). `core/transcript/echo.ts` now hides a "You" line when:
- it has at least 4 words;
- at least 60% of its words appear, in order, in what "Them" said from 10 s before it to 2 s after it.

The developer's examples score 0.83 and 0.91, while a real answer that reuses the question's words scored 0.33. Short replies ("yes", "exactly") are never hidden, and "Them" lines are never touched. Echo lines are left out of `lines()` and `window()`, which Day 4 uses for the question, and the live view says "Hiding echo from your speakers".

For display only, a new "You" line that arrives while "Them" is speaking is held for 1.5 s, so an echo does not flash up before its original reveals it. In the developer's retest, 5 echo lines were hidden and the developer's own sentence was kept.

**Power-state slowdowns (Day 2, Stage 2).** In a slow power state the same laptop reached a real-time factor of 0.57–0.65 per channel (model start 5.5–6.0 s instead of ~1.9 s). Plugged in, in a normal power state, the same Chrome test gave 0.443 combined. Health stayed "ok" because its threshold is 0.8. Proposed for the Connect/Live views (not built): an earlier, gentler hint, such as "Plug in your laptop for best results" when the combined real-time factor stays above 0.5 for 10 s, with "falling behind" kept at 0.8.

### Word error rate scoring (changed on Day 2)

From Day 2, `wer.ts` counts a word heard split or joined ("TO DAY" for "today", "NORTH WIND" for "Northwind") as correct: the letters are right and only the spacing differs. Under this rule, Day 2 run C sentence 1 is 5% (was 16%) and sentence 2 stays 18%. Day 1 rows in benchmark-results.md keep their original scoring.

### Second pass (Day 2, Stage 5): tried and rejected

**What was built.** The streaming model still made the grey text and a first-pass final line. When an utterance ended, its audio (in memory only, at most 30 s) went straight from the streaming worker to a second worker. There Silero VAD trimmed the silence and a non-streaming model decoded the speech again. The line's text was then replaced in place (same id, marked refined), and the echo filter checked the refined text again.

The second worker used the official sherpa-onnx **v1.13.2** "vad-asr" WebAssembly runtime (pinned by SHA-256), because v1.13.7 has no official non-streaming English build. That runtime is a WebAssembly *threads* build:
- 537 MB of shared memory per worker;
- 4 threads of its own;
- it runs only on a cross-origin-isolated page.

So the stage added `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` on every route, provisionally. With those headers, the developer's checks passed: sign-in, `/dev/claude-test` streaming, `/live/demo`, and `crossOriginIsolated` = true.

**Measured (2026-10-28, Chrome, plugged in, same microphone, `crossOriginIsolated` true; rows in benchmark-results.md).**

| Configuration | Download | Overall WER (S1 / S2 / S3) | Latency, end of speech → | RTF | WebAssembly memory |
|---|---|---|---|---|---|
| **Baseline:** 2023-06-21 streaming only | 204.5 MB | **27.5%** (0% / 29% / 60%) | final line: p50 1,673 / p95 1,871 ms | 0.303 | 536.9 MB |
| **Config 1:** model A 2023-06-26 + Zipformer GigaSpeech (non-streaming int8, hotwords) | 175.4 MB | first pass 52.9% → refined **25.5%** (5% / 18% / 60%) | refined: p50 2,438 / p95 3,875 ms | 0.374 (both workers) | 1,073.7 MB |
| **Config 2:** 2023-06-21 + Moonshine v2 tiny | 262.4 MB | first pass 68.6% → refined **88.2%** | refined: p50 2,334 ms | not recorded | 1,073.7 MB |

Notes on the measurements:
- Baseline "Them" lag was 773 ms.
- Config 2: sentence 1 was not captured (only "UM" was heard), so that sentence is invalid for config 2. The first-pass figure (68.6%) is also above the baseline, so this run is not a clean comparison. Even so, on the same audio the second pass made the text worse. For example, it heard "This year, the end cost is $2 per c, but one hundred and fifty two cents."

**Adoption rule (the developer's, set before measuring).** A configuration is adopted only if:
- overall WER is clearly under 20% (not borderline);
- the combined RTF of both workers is 0.5 or less with two channels, plugged in;
- memory is acceptable (about 1.2 GB was the serious-concern level).

**Why each was rejected.**
- **Config 1:** 25.5% is not under 20%. It only matches the baseline (27.5%; the difference is within one or two words over 51). It doubles memory to 1.07 GB of WebAssembly memory before Chrome's own overhead, and the refined text arrives about 0.7 s later than the baseline's final line (p50 2,438 vs 1,673 ms; p95 3,875 ms). Sentence 3, the names, stayed at 60%.
- **Config 2:** the second pass made accuracy worse (88.2%). It also cost the same memory and went over the 250 MB download limit.
- **Moonshine v2 base:** dropped before measuring. In Node it took about 0.9 s per 4 s of speech, and it shares tiny's limit: input over about 9 s throws.

**What was removed.** In the same stage, the following were removed from production code, `models.ts` and the build steps (`fetch-models.ts`, `check-stt-runtime.ts`):
- the COOP/COEP headers (`next.config.ts` is back to the Day 1 "no isolation needed" note);
- the second-pass worker and its job queue;
- the v1.13.2 runtime and Silero VAD;
- the GigaSpeech and Moonshine models;
- model A;
- the in-memory utterance audio buffer;
- refine-in-place in the transcript.

The full implementation is kept in git history in commit **`6d3fb42`** ("wip(web): stage 5 second-pass experiment, measurements pending") on branch `day-02-audio`. Use it as the starting point if a second pass is tried again, for example with a native engine.

**Kept from the experiment** (not tied to the second pass):
- WER scoring spells out digits ("$52", "9:30", "1,500", "15%") before comparing (`wer.ts`);
- end-of-speech detection in each channel (the last loud 10 ms frame, never after the last text change; `gate.ts` and `channel.ts`). Every final line now carries `speechEnd`, and the engine reports end of speech → final line latency;
- `percentile()` in `metrics.ts`;
- `/dev/stt-test` shows the latency at p50/p95 and the overall WER across the sentences read.

### Real-call result (Day 2, Stage 7): the main known limitation

A real call with a colleague in the desktop app (Windows, production build). Only the outcome is recorded, not the call's text:
- **Speakers and pauses:** "You" and "Them" were labelled correctly, and lines broke at natural pauses.
- **Names and technical terms were often wrong.** The company name "Paramount Intelligence" came out as one invented word, and "chatbots and AI agents" as unrelated words. This matches sentence 3 of the test (names, 60% WER). The streaming model is weakest exactly where an answer assistant needs it most.
- **Echo on speakers:** short echoes (one or two words, such as "GONE", "OKAY SO") slipped through. This is the known rule: the echo filter only judges lines of 4 words or more, so short replies are never hidden.

The desktop app against production worked: no picker, both channels, and 7 echo lines hidden. The browser real call (Meet in a Chrome tab) was skipped because it uses the same engine; tab-audio capture had already been checked with a shared tab in production. macOS is deferred to Day 6/7 (no Mac available).

**What this means:** answers on Day 4 must not depend on names being transcribed exactly. The levers in Decision item 3 apply in order: session hotwords (Day 3), the Day 4 prompt note, then the desktop native engine spike after Day 4.

### Session hotwords result (Day 3, Stage 4)

From Day 3, each live session gives the engine its own hotwords: the session's key terms and company at boost 2, its role/topic and document names at 1.5 (`core/stt/sessionHotwords.ts`). They were measured on `/dev/stt-test` with the 3 test sentences: 4 runs, alternating with and without hotwords, same laptop, same microphone, plugged in (rows in benchmark-results.md, 2026-10-29).

| | Run 1 | Run 2 | Average | Sentence 3 (names), average |
|---|---|---|---|---|
| Session hotwords (A) | 19.6% | 13.7% | 16.7% | 26.5% |
| No hotwords (B) | 13.7% | 19.6% | 16.7% | 40% |

- **No overall effect.** Both averages are 16.7%. The first pair alone made hotwords look worse (19.6% vs 13.7%), which triggered the Day 3 stop rule; the repeat pair reversed it. A single pair cannot show a difference of a few words.
- **Hotwords help names intermittently on this voice.** "Bluefin Route" and "Northwind Logistics" were exactly right in one hotword run (A2) and wrong in the other (A1: "your fin drove", "Northman"). They were never right without hotwords.
- **No harm measured.** The average did not get worse, and no hotword phrase appeared where it was not said in the text reported from the runs (false insertions are the main risk of hotwords).
- **Run-to-run variance is large.** The 4-run average is about 17% on the test sentences, ranging from 13.7% to 19.6%. A change smaller than about 3 words in 51 cannot be told apart from noise with one or two runs.

**Decision (developer, 2026-10-29):** session hotwords stay **on** by default, at boost 2 for key terms and company and 1.5 for role/topic and document names. Live sessions keep beam width 4.

**For later measurement:** `/dev/stt-test` has a "Beam width" choice of 4 or 8 (sherpa-onnx `maxActivePaths`). A hotword can only be boosted once its first word piece is among the candidates the beam keeps, so a wider beam may help names more often. It costs CPU, and two channels on battery already reach RTF 0.86. It must be measured on battery with two channels before live sessions change.

## Validation

Measured numbers are in `docs/testing/benchmark-results.md` (Day 1 Stage 6 and Day 2 rows). The test page is `/dev/stt-test` (admins only). It shows:
- load time;
- real-time factor and lag;
- end of speech → final line latency (p50/p95);
- which rule ended each utterance;
- the WER of each of the 3 test sentences, and overall.

"Copy results" gives the text recorded there.

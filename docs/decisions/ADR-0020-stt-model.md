# ADR-0020: Speech-to-text model (WebAssembly, v3.0)

- **Status:** Proposed. Working engine chosen for Day 2; accuracy is above the bar (see Decision)
- **Date:** 2026-10-24 (created); 2026-10-27 (Day 1 spike results; Day 2 hosting and two-channel engine)
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6, §12 Day 1
- **Supersedes / superseded by:** none

## Context

Kite transcribes both call channels locally with sherpa-onnx compiled to WebAssembly (in a Web Worker) and Silero VAD. The same code runs in Chrome/Edge and in the Electron desktop shell, on macOS (Apple Silicon) and Windows x64 (v3.0, ADR-0021).

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
2. **Status stays Proposed, because accuracy is above the bar.** Overall WER was ≈25% (sentence 1: 5%, sentence 2: 24%, sentence 3: 53%). The bar is 20%.
3. **Day 2 improvement to evaluate: two passes.** Keep the fast streaming model for partial text. When a pause ends an utterance, re-check that final line with a more accurate model (an offline/non-streaming recognizer) and replace the text. Target: **under 20% WER on the same 3 sentences**. If it meets the target in Chrome and the desktop app without breaking the lag and CPU limits, this ADR becomes Accepted.
4. **Model A (2023-06-26) is rejected for accuracy.** It stays in the `/dev/stt-test` picker only for comparison. Hotwords did not help it.
5. **Size limit raised to 250 MB, for now.** The download is 204.1 MB. Conditions:
   - it is a one-time download, then cached in the browser's Cache Storage. Cached loads measured about 2.1 s;
   - a **download progress indicator is required** in the real UI (Day 2);
   - **revisit on Day 7.**

   Loading the model's files separately instead of using the official bundle saves almost nothing (3 KB), because the int8 encoder alone is 187.8 MB. The int8 decoder and joiner would save only another 2.3 MB.
6. **End of utterance: keep both rules.** Each final line on the test page records which rule ended it:
   - the recognizer's own endpoint rule: about 1.0 s of decoded silence after text;
   - a safety net in the worker: no new words for 1.2 s of audio.

   In Chrome the model rule ended the utterances. In the desktop app the safety net did (one utterance). Silero VAD is added on Day 2; it was left out of the spike because the official streaming example does not use one.

### Hotwords

The v1.13.7 WebAssembly build supports hotwords. They are passed in the recognizer config (`hotwordsBuf`), encoded with `modelingUnit: 'bpe'` and a `bpe.vocab` file.

- **Upper case only.** The model's vocabulary has only upper-case letters and the apostrophe, and sherpa-onnx silently ignores a phrase it cannot encode. `apps/web/src/core/stt/hotwords.ts` upper-cases and cleans each phrase.
- **Where `bpe.vocab` comes from.** The model repositories ship only `bpe.model`. `fetch-models.ts` converts it into `bpe.vocab` the way sherpa-onnx's own `scripts/export_bpe_vocab.py` does, and checks the result against a pinned SHA-256.
- **Effect.** In an automated check with synthetic (Windows text-to-speech) audio, hotwords turned "BLUEFIN ROOT … NORTH WIND LOGISTICS" into the exact names. With the developer's voice, sentence 3 was still 53% WER.
- **When they apply.** The JS API takes hotwords only when the recognizer is created, so changing them means re-creating it. Day 3: the list is built from the session's details and documents.

### Runtime facts and risks

- **v1.13.7 is the last sherpa-onnx release with official ASR WebAssembly builds.** v1.13.8, 2.0.0 and 2.0.1 have none. Upgrading means either building the WebAssembly runtime ourselves from the sherpa-onnx source (Emscripten, `build-wasm-simd-asr.sh`) or staying on v1.13.7. Any upgrade must re-run the `/dev/stt-test` measurements.
- **Dependency on Emscripten internals.** The runtime's own 191 MB `.data` package is skipped: `Module.getPreloadedPackage` returns an empty buffer. The model files are then written into its in-memory file system with `Module.FS_createPath` and `Module.FS_createDataFile`. These are Emscripten file-system APIs, not sherpa-onnx APIs, so a different runtime build could change or remove them. That would show up at once as a load error on `/dev/stt-test`.
- **No COOP/COEP headers are needed.** The official build is single-threaded (no pthreads), so it needs no `SharedArrayBuffer` and no cross-origin isolation. Sign-in and the rest of the app are unaffected.
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

### Word error rate scoring (changed on Day 2)

From Day 2, `wer.ts` counts a word heard split or joined ("TO DAY" for "today", "NORTH WIND" for "Northwind") as correct: the letters are right and only the spacing differs. Under this rule, Day 2 run C sentence 1 is 5% (was 16%) and sentence 2 stays 18%. Day 1 rows in benchmark-results.md keep their original scoring.

## Validation

Measured numbers are in `docs/testing/benchmark-results.md` (Day 1 Stage 6 rows). The test page is `/dev/stt-test` (admins only). It shows load time, real-time factor, lag, which rule ended each utterance, and the WER of the 3 test sentences; "Copy results" gives the text recorded there.

# ADR-0020: Speech-to-text model (WebAssembly, v3.0)

- **Status:** Proposed. Working engine chosen for Day 2; accuracy is above the bar (see Decision)
- **Date:** 2026-10-24 (created); 2026-10-27 (Day 1 spike results)
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

### Serving the model files in production (not changed on Day 1)

The model files (204.1 MB in total; the largest file is 187.8 MB) are kept out of git and out of Vercel uploads (`.vercelignore`: `apps/web/public/models`). The production site therefore has no model files yet, and `/dev/stt-test` works only on a developer machine after `pnpm --filter web fetch-models`.

- **Not as static files of the Vercel deployment.** Vercel limits the source files a CLI deployment can upload to **100 MB on Hobby** and 1 GB on Pro (Vercel limits page, checked 2026-10-27). Kite deploys with the CLI on Hobby, so the files cannot go in `public/`.
- **Recommended: a public Vercel Blob store**, with the files under a versioned path such as `stt/zipformer-en-2023-06-21/…`, and the worker's base URL taken from an environment variable. Checked 2026-10-27:
  - the maximum file size is 5 TB, and files over 100 MB should be uploaded with multipart;
  - files up to 512 MB are cached by the CDN;
  - the Hobby plan includes 1 GB of storage and 10 GB of data transfer a month. That is about 49 full first-time downloads; cached loads cost nothing. Above the included usage, Hobby blocks Blob access for 30 days rather than billing, so a growing team needs Pro.

  Before relying on it, check two things on Day 2:
  - the store sends CORS headers that allow the Kite origin to `fetch()` from the worker;
  - the worker should check each file's SHA-256 after download, because the files then come from storage we upload to rather than from the build.
- **Alternatives:**
  - load the files straight from the pinned Hugging Face commit URLs. There is no hosting to run, but the app would depend on a third-party service at runtime;
  - another object store or CDN, such as S3 or R2 with CloudFront or Cloudflare.

  Whichever is chosen is a deploy change for a later stage, with its own note in the architecture document.

## Validation

Measured numbers are in `docs/testing/benchmark-results.md` (Day 1 Stage 6 rows). The test page is `/dev/stt-test` (admins only). It shows load time, real-time factor, lag, which rule ended each utterance, and the WER of the 3 test sentences; "Copy results" gives the text recorded there.

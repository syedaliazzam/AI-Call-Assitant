# ADR-0023: Where production loads the speech-to-text files from

- **Status:** Accepted
- **Date:** 2026-10-28 (decided on Day 2 Stage 1, confirmed in production on Day 2 Stage 7)
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` (version 3.2.0) §6.1 step 2, §10.1, §13
- **Supersedes / superseded by:** none. It records in full the hosting part of ADR-0020 ("Serving the files").

## Context

Kite transcribes on the user's device with the sherpa-onnx v1.13.7 WebAssembly runtime and the streaming Zipformer 2023-06-21 model (ADR-0020). The browser (and the desktop app, which loads the same web app) needs two kinds of file:

| What | Size | Where it officially comes from |
|---|---|---|
| Model files: int8 encoder, decoder, joiner, tokens, bpe.model | 191.2 MB | Hugging Face model repository `csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21` |
| Runtime: loader `.js`, `.wasm`, API `.js` | 13.3 MB | Inside a 175 MB `.tar.bz2` GitHub release asset (k2-fsa/sherpa-onnx v1.13.7) |

Constraints:
- A Vercel Hobby CLI deployment can upload at most 100 MB of source files (1 GB on Pro). The model cannot go into the deployment.
- Vercel Blob on Hobby includes 10 GB of transfer a month, which is only about 49 first-time model downloads. Above that, Hobby blocks Blob access for 30 days.
- A browser cannot unpack a `.tar.bz2`, so the runtime cannot be loaded straight from the release.
- Every file must be exactly the pinned one. Kite runs this code on users' devices with their call audio.

## Decision

1. **Model files come from Hugging Face, pinned to a commit.**
   - Every URL is `https://huggingface.co/csukuangfj/<repo>/resolve/<40-hex commit>/<file>`, never a branch.
   - Each file has a size and a SHA-256 in `apps/web/src/core/stt/models.ts`, the single source of truth for the browser, `fetch-models` and CI.
2. **The browser verifies every file before using it.**
   - The worker (`core/stt/download.ts`) checks the size and the SHA-256 (Web Crypto).
   - A mismatch is rejected with a typed error and is never cached.
3. **Verified files are cached on the device.**
   - They go into Cache Storage (`kite-stt-v2`), keyed by SHA-256. Later loads make no network requests.
   - The Connect view shows a progress bar for the first download.
4. **The runtime is served from our own origin** (`/stt-runtime/v1.13.7/`). Every build runs `pnpm run stt:runtime` before `next build`, locally and on Vercel. That step:
   1. downloads the pinned release archive and checks its SHA-256;
   2. lists the archive and extracts only the three files, using the member names exactly as `tar -t` prints them, so GNU tar on Linux, bsdtar on Windows and macOS tar all work;
   3. checks each file's SHA-256 and fails the build if anything is missing or wrong.

   The worker runs the runtime from its verified bytes (Blob URLs), not from a second fetch.
5. **Development uses local copies.**
   - `pnpm --filter web fetch-models` puts the same pinned files in `apps/web/public/models/stt/` (git-ignored).
   - `pnpm dev` loads from there (source `local`); production builds use `remote`. `NEXT_PUBLIC_STT_SOURCE` overrides either.
6. **No cross-origin isolation is needed.** The runtime is single-threaded, so it needs no COOP/COEP headers (the Day 2 Stage 5 experiment added them, and they were removed; ADR-0020).

## Consequences

**Positive:**
- No hosting cost and no transfer limit to manage for 191 MB per new user.
- Pinned commits plus the checksum check mean a changed, substituted or truncated file is never run.
- After the first load, Kite needs no network for speech-to-text. Cached loads measured 2.1–3.8 s.
- Any machine can deploy from a fresh clone; no binary files are in git.

**Negative and limits:**
- **First load depends on Hugging Face** (and its CDN, `us.aws.cdn.hf.co`). If it is down or blocked, for example by a company firewall, a new user cannot start transcribing. Users who already have the files cached are not affected.
- **The first download is large:** 204.5 MB including the runtime.
  - Measured on Day 2 Stage 1: 28.8 s in Chromium from Pakistan (local origin, Hugging Face source).
  - The production first-load time was not recorded in Stage 7.
  - The download must finish before the first call. Day 3 should start it when a session opens, not when "Connect" is pressed.
- **Cache Storage can be cleared** by the user or the browser (storage pressure, private windows). Kite then downloads again.
- **Every build downloads the 175 MB archive** (about a minute). The archive also contains a 191 MB `.data` file, which is never extracted.
- **Dependence on Emscripten internals:** files are written into the runtime's in-memory file system with Emscripten APIs, not a public sherpa-onnx API (ADR-0020, "Runtime facts and risks").

## Alternatives considered

- **Vercel static files (in the deployment):** over the 100 MB Hobby upload limit; on Pro it would make every deployment upload about 200 MB.
- **Vercel Blob:** the Hobby transfer limit (about 49 new users a month), and access is blocked when it is exceeded. It remains a fallback on Pro.
- **Cloudflare R2 or a company server:** possible fallbacks, but they add an account or a server to run, with no benefit while Hugging Face works.
- **Committing the runtime to git:** 13.3 MB of binary in every clone, and harder to show that it is the unmodified official build. The build step plus checksums gives the same files with a clear source.
- **Building the runtime ourselves (Emscripten):** only needed for a newer sherpa-onnx; v1.13.7 is the last release with official ASR WebAssembly builds (ADR-0020).

## Fallback (if Hugging Face becomes unusable)

1. Upload the same files to Vercel Blob (Pro), Cloudflare R2 or a company server, with CORS allowing the Kite origin.
2. Change only the `url` of each file in `models.ts`. The sizes and SHA-256s stay the same, so the browser accepts exactly the same bytes, and users' existing caches (keyed by SHA-256) stay valid.
3. Redeploy and run the CI integration test and `/live/demo` on production.

## Validation

All measured rows are in `docs/testing/benchmark-results.md`.
- **CORS from the production origin** (Day 2 Stage 1, DevTools): passed. `tokens.txt` returned 200 after the redirect with the right SHA-256, and a range request on the encoder returned 206.
- **Production `/live/demo`** (Day 2 Stage 7):
  - Chrome: model loaded from Hugging Face with the progress bar; the reload came from the cache.
  - Desktop app (`pnpm --filter desktop start`): worked with no picker and both channels.
- **Vercel build step on Linux** (Day 2 Stage 7): the production deploy reached Ready with `stt:runtime`. This was after the GNU tar fix (`f3424b1`); before the fix, GNU tar could not find the archive's `./`-prefixed members.
- **CI** (`stt-integration`, ubuntu-latest):
  - It runs `fetch-models` with the same pins and checksum checks. The files are cached with `actions/cache`, keyed by the hash of every pinned SHA-256.
  - It then runs the integration test, which passed.

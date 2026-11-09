# ADR-0059: The streaming speech model ships in the desktop installer

- **Status:** Accepted (released with desktop 1.3.1)
- **Date:** 2026-11-09
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.3 (desktop shell), §10 (installation); ADR-0020 (the model); ADR-0055 (the Connect card)
- **Supersedes / superseded by:** replaces ADR-0055's "a dialog offers the speech model when it is missing" on the desktop. The browser is unchanged.

## Context

A fresh desktop install had to download the streaming speech model (about 204 MB: the sherpa-onnx engine from the app's own `/stt-runtime/` and the Zipformer model from pinned Hugging Face addresses) before its first call, behind a "Speech model needed" dialog. The developer asked for the model to ship in the installer, served at the same addresses the web code already fetches (so the web and browser paths do not change), checked with SHA-256 on first use, with a silent background download as the fallback and no dialog. The 661 MB accurate model (ADR-0034) stays a download on demand.

## Decision

1. **Build:** `apps/desktop/scripts/stage-stt-model.mjs` reads the pinned list from `apps/web/src/core/stt/models.ts` (the single source of truth, bundled with esbuild), takes each file from a local copy whose SHA-256 matches or downloads it from its pinned address, checks every file, and writes `native/stt-model/` with `manifest.json` (name, size, SHA-256, and the address: absolute for model files, an origin-relative `/stt-runtime/…` path for the engine). electron-builder ships it as `extraResources` → `resources/stt-model`. The `dist:*` scripts stage it.
2. **Serving** (`apps/desktop/src/speechModel.ts`): a `session.webRequest.onBeforeRequest` rule for **only the manifest's exact addresses** redirects them to a private privileged scheme, `kite-model://bundle/<name>`, whose handler streams the bundled file (`net.fetch` of the file) with `Access-Control-Allow-Origin: *` (after a cross-origin redirect the browser sends `Origin: null`). Every other request (pages, sign-in cookies, answers) is untouched. Measured in Electron 44 before building: a page `fetch()` and a worker `fetch()` both follow the redirect.
3. **Checks:** each file's SHA-256 is checked against the manifest before it is first redirected or served, in the background when the app opens; a file that passed is remembered (by checksum, size and modification time, in `stt-model-verified.json` in the app's data folder). A missing or damaged file is never redirected, so its request reaches the network as before. The web code still checks every file's SHA-256 too (`download.ts`).
4. **Web:** the desktop launcher starts `core/stt/prefetch.ts` when the app opens: it checks Cache Storage and loads any missing file with the existing verified download (a quick local copy from the bundle, or a silent download when the bundle is missing). Connect waits for it, with a small progress bar only while it is still loading. The "Speech model needed" dialog is removed. The browser's Connect card is unchanged.

## Consequences

- A fresh install connects with no model download (checked with Hugging Face unreachable: `apps/web/tests/e2e-prod/bundled-model.spec.ts`).
- **Installer size:** 288.4 MB (1.3.0: 126.3 MB); the 204 MB model compresses to about 162 MB.
- **Updates:** the 1.3.0 → 1.3.1 update downloads about 162.7 MB once (the model is new). Later differential updates reuse the model's blocks (measured below).
- The model is on disk twice after the first call: in the install folder and in the profile's Cache Storage, as before 1.3.1 (about 204 MB each).
- A new model version needs a new desktop release (and the web's pinned list changes with it), otherwise the shell's manifest no longer matches the addresses and the app downloads as before: safe, but slower.

## Alternatives considered

- **Intercepting all `https` (`protocol.handle('https')`):** every request of the app (sign-in cookies, streamed answers) would pass through the main process; too broad for a model file.
- **A local web server:** a public origin fetching from `127.0.0.1` meets Chromium's local-network rules and permission prompts.
- **Seeding Cache Storage from the shell:** needs code injected into the page; the redirect keeps the page's code paths as they are.

## Validation

`apps/desktop/tests/unit/speechModel.test.ts` (manifest, exact-address redirects, checksum gate, remembered checks, the handler), `apps/web/tests/unit/core/stt/prefetch.test.ts`, the launcher harness (no dialog, progress, failure and retry), and `bundled-model.spec.ts` against production with the packaged program. Differential update: block maps compared (`Paramount-AI-Setup-*.exe.blockmap`).

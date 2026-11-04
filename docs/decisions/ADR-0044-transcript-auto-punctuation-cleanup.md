# ADR-0044: Transcript: Auto for the accurate engine, offline punctuation, clean-up and hygiene

- **Status:** Accepted
- **Date:** 2026-11-04
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6.1, §10
- **Supersedes / superseded by:** changes ADR-0034's default

## Context

The live engine writes capitals with no punctuation, so sentences and questions could not be found. Accurate transcription was opt-in. Noise, echo and calls left running all made transcripts harder to read.

## Decision

**Accurate transcription has a third setting, Auto (the default):** on when plugged in, off on battery. A computer that cannot tell counts as plugged in. Auto never starts the 661 MB download itself; it uses the model only once downloaded, and a one-time offer points to Settings. A choice made before v1.1.0 carries over. On and Off still work as before.

**The live engine's lines get marks and capitals from a small offline model.** `sherpa-onnx-online-punct-en-2024-08-06` (Apache-2.0) runs on ONNX Runtime's WebAssembly build in a worker of its own, in the browser and the desktop app alike. Both are served from our own origin, so nothing about a call leaves the device for this. No word is ever changed, only marks and capitals. If anything fails, the line stays as the engine wrote it.

Measured on 4 Nov 2026, Intel i5-8350U, ONNX Runtime 1.30.0, one thread:

| What | Size | Compressed (gzip) | Speed |
|---|---|---|---|
| Runtime (`ort-wasm-simd-threaded.wasm`) | 14.2 MB | 3.7 MB | |
| Model (`model.int8.onnx`) | 7.5 MB | 1.9 MB | Loads in 0.6 s in Chromium |
| One line | | | p50 23 ms, p95 47 ms in Chromium |

That is within the limits set before measuring (runtime about 15 MB or less; p95 100 ms or less), so it was adopted. ONNX Runtime 1.31.1 was under two weeks old, so 1.30.0 is pinned. The runtime is fetched at build time with pinned checksums rather than added as an npm dependency, whose package unpacks to 150 MB. The build fails if a file is missing or wrong.

**Turns split at questions.** One bubble holds one thing to answer: a question stands alone, and the statements around it stay together up to 35 words. A question that a pause cut in two stays in one bubble. A bubble that has finished gets its closing mark at display time, when it is known that nothing follows.

**Key terms in both engines.** The live engine keeps its boost. The accurate engine has none that works: measured on 4 Nov 2026 with modified beam search and terms written as its tokens, a boost of 2 fixed 1 of 5 terms, 4 made another worse, and 8 broke the text. So its text is corrected afterwards, by how words sound (`core/transcript/keyTermFix.ts`), and strictly, because changing a word someone really said is the worse mistake: a short pattern must match exactly, and only a long one may differ a little. Terms with digits are left to the existing spoken-number spellings.

**Clean-up.**

- Fillers and lead-ins leave the chips.
- Noise collapses into "Unclear speech (n)". This is display only: the saved lines keep every word.
- The echo filter looks 10 s before and 3 s after, and a three-word "You" line counts as echo only if "Them" said exactly those words within 3 s.
- After three hidden echoes, one hint says to use headphones.

**Hygiene.** After 10 minutes with nothing from the other person and no answers, Kite asks "Still in a call?". After 30, listening pauses, with Resume. The streams stay open, so Resume asks for no new permission.

## Consequences

- Positive: readable transcripts, and better input for Claude, in both the browser and the app.
- Negative: 21.7 MB more to fetch once, in the background at the start of a first call.
- Negative: a key-term correction can still miss, or very rarely change the wrong word. Display and saved text both carry the correction.

## Alternatives considered

- **The punctuation model through `sherpa-onnx-node` in the desktop app only.** Rejected once the web runtime passed its limits: the browser would have stayed without punctuation.
- **Hotwords on Parakeet at a safe boost.** Rejected: it fixed too little to justify 15% slower decoding and reloading the model for each session.

## Validation

`tests/integration/punctuation.spec.ts` (the real worker, runtime and model in Chromium, with its 100 ms gate), `tests/unit/core/punctuation/*`, `tests/unit/core/transcript/{keyTermFix,echo,group,display,unclear}.test.ts`, `tests/unit/core/live/hygiene.test.ts`, and the 40-minute call in `tests/integration/sim-calls.spec.ts`. Line latency with the accurate engine on and off is in `docs/testing/benchmark-results.md`.

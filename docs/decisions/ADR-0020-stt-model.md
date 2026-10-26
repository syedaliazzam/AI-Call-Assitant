# ADR-0020: Speech-to-text model (WebAssembly, v3.0)

- **Status:** Proposed (to be decided on Day 1, Mon 26 Oct 2026)
- **Date:** 2026-10-24
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
- the model download is ≤ 150 MB (cached after the first load);
- partial text arrives ≤ 1 s behind speech;
- CPU use is ≤ 50% of one performance core per channel;
- the licence is acceptable for internal company use.

## Decision

_To be filled on Day 1 with measured results._

## Validation

Measured numbers recorded in `docs/testing/benchmark-results.md`.

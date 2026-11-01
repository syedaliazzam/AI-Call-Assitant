# ADR-0027: Desktop speech engine (hybrid final pass)

- **Status:** Proposed. The decision rule below was written on 2026-11-01, **before** the trial was run. The decision is added after Day 6 Stage 1.
- **Date:** 2026-11-01
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (speech-to-text), §7 (desktop shell)
- **Supersedes / superseded by:** none (builds on ADR-0020, the browser speech model)

## Context

Kite transcribes in the browser with sherpa-onnx v1.13.7 WASM and the streaming Zipformer (2023-06-21), with hotwords on. Measured error rates:
- about 17% of words wrong on read sentences;
- about 25–30% on real calls;
- names are the worst.

A second, more accurate pass in the browser was rejected on Day 2 because it needed COOP/COEP headers. The desktop app has no such limit: a native engine can run in an Electron utility process.

## Trial (Day 6 Stage 1, measure only)

**The design being tested:**
- The streaming engine keeps showing grey, still-changing words.
- When an utterance ends, a native engine decodes that utterance's audio again and replaces it with final text.
- Desktop only; the browser is unchanged.

**Candidates** (latest stable versions; sizes and licences recorded with the results):
1. NVIDIA Parakeet TDT 0.6B (v2 English, or v3) through sherpa-onnx native, per utterance.
2. Whisper through whisper.cpp: `large-v3-turbo` (quantized) and `small.en`, per utterance.
3. Control: the current streaming Zipformer.

**Test sets:**
- the read sentences;
- the **names set**: 40 sentences read by the developer (`apps/web/tests/fixtures/stt/names-sentences.txt`);
- 5–10 minutes of conversation from people who agreed to it, if available.

Audio stays out of git. A manifest with SHA-256 hashes is committed.

**Measured for each engine, plugged in and on battery:**
- word error rate, overall and on the names set;
- name accuracy: the share of listed names written exactly right;
- time from the end of an utterance to final text (p50, p95);
- real-time factor, CPU, peak memory;
- download size and cold start;
- hotword or prompt support, and its effect.

## Decision rule (fixed before the trial)

Adopt a candidate for the desktop **only if all four hold**. Each is measured on the developer's laptop **on battery**, against the control on the same audio:

1. **Accuracy:**
   - name accuracy on the names set improves by **≥ 15 percentage points**; **and**
   - overall word error rate improves by **≥ 25% relative** (for example 17% → 12.75% or lower).
2. **Speed:** end of utterance → final text **p50 ≤ 0.8 s and p95 ≤ 1.5 s**.
3. **No slower answers:** the first word of a live answer, measured while the engine decodes, is within **0.1 s (p50)** of the same measurement without the engine.
4. **Download:**
   - total extra download **≤ 700 MB**;
   - verified by SHA-256, cached, and resumable.

**Choosing between candidates:**
- If more than one passes, choose the one with the higher name accuracy.
- Within 2 points of name accuracy, choose the smaller download.

**If none passes, adopt nothing.** The desktop keeps the current engine, and Day 6 Stage 2 is skipped.

The rule is not changed after the results are seen. A near miss is reported as a miss, with its numbers.

## Decision

Pending: added after the trial, with the results table.

## Consequences

Pending.

## Alternatives considered

- A second pass in the browser: rejected on Day 2 (COOP/COEP headers).
- A cloud speech API: rejected, because audio never leaves the device (architecture §4).

## Validation

- Results table in `docs/testing/benchmark-results.md`: Day 6 Stage 1, plugged in and on battery.
- If a candidate is adopted, Stage 2 measures it again inside the real app.

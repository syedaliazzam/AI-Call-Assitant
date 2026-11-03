# ADR-0027: Desktop speech engine (hybrid final pass)

- **Status:** Accepted (developer, 3 Nov 2026): **adopt nothing** (see Decision). The decision rule below was written on 2026-11-01, **before** the trial was run.
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

## How it is measured (fixed on 2026-11-02, before any engine ran)

The rule above does not change. These details say how its words are measured. The code is `apps/web/scripts/stt-trial.ts` and `scripts/lib/stt-score.ts` (unit-tested).

**Audio:**
- The names set: the developer's recording of `names-sentences.txt`. Only sentences with a clip are scored.
  - A first check (numbers only, before any counted run) showed the clip numbers did not match the sentences read. Each clip's best sentence was clear (word error 0.00–0.54, next best 0.60 or worse), so the clips were renumbered to the sentences they are.
  - Of a sentence read twice, the later take is kept: a fixed rule, not chosen by any engine's score.
  - The recorder had auto-gain and noise suppression off, while the live microphone has them on, so the clips peaked near 0.07 against about 0.5 for the read set. **Every engine gets the clips levelled to a peak of 0.5:** a plain volume change, decided before any candidate had a counted result. Noise suppression is not recreated, so the names set stays somewhat harder than a live call. The control on the unlevelled clips, plugged in, for comparison: name accuracy 15.3%, names-set word error 55.8%.
- The read set: `0.wav` and `1.wav`, the two public recordings already used since Day 1 (66 words).
- No conversational audio exists yet, so it is not in this trial. Stage 2's human checks cover real calls.

**Name accuracy (the rule's measure):** the share of **all terms listed after `|`**, in the sentences with a clip, written exactly right in that sentence's transcript. "Exactly right" ignores case, punctuation and spacing ("Next.js" = "NEXT JS", "LangChain" = "lang chain"), allows a possessive, and needs whole words.

**Names and technical terms, reported separately:** the list `TECH_TERMS` in `stt-score.ts` decides which terms are technical; all others are names. The split is information for the developer. The rule uses the combined measure.

**Overall word error rate:** errors ÷ reference words across the names set and the read set together (`core/stt/wer.ts`, which spells out numbers, so "40" = "forty").

**Session terms:** the current engine runs with hotwords, so the rule compares engines **with the listed terms given as session terms**:
- the control gets them as hotwords, through the app's own `buildHotwords()`;
- Whisper gets them as its initial prompt;
- Parakeet gets them as hotwords if its decoder accepts them; otherwise it runs without, against the control with.

Every engine also runs **without terms**, which is what happens when a user types none. If the two comparisons disagree, the report says so.

**The control** is the real thing: the app's own `stt.worker.ts` and sherpa-onnx WebAssembly in Chromium, fed clip by clip at real-time speed. It also runs with the built-in Interview vocabulary alone, to measure Stage 4c.

**Final-text latency:** from the moment an utterance has ended and all its audio has been handed over, to the final text. The pause that detects the end of an utterance (about 1.2 s) comes first for every engine and is not included; the report states it. The first clip of each run is a warm-up and is left out of the percentiles.

**Candidates run alone,** with 4 threads, one clip at a time, with the model already loaded. Decoding while the live engine also runs is measured by criterion 3 and again in Stage 2.

**Criterion 3** (answer latency) needs paid Claude requests, so it runs only for a candidate that already passes criteria 1, 2 and 4, after its cost is agreed.

**Criterion 4** counts the candidate's model plus its native runtime files. Resume and SHA-256 are Stage 2's job, so here the size decides it.

**Power:** the script reads the power state itself and writes it into each result. The rule uses the runs on battery.

## Decision

**Adopt nothing. The desktop keeps the current streaming Zipformer engine, and Stage 2 is skipped.** (Developer accepted, 3 Nov 2026.)

The trial ran on the developer's laptop (Intel Core i5-8350U, Windows 11), plugged in and, for the decisive pair, on battery. Full tables are in `docs/testing/benchmark-results.md` (Day 6 Stage 1). Measured against the fixed rule (criteria 1, 2 and 4; criterion 3 needs paid Claude requests and was never reached):

| Engine | Name accuracy vs control | WER vs control | Final p50 / p95 on battery | Download |
|---|---|---|---|---|
| Control (no terms) | 15.3% | 43.3% | 4 / 173 ms | 0 |
| **Parakeet TDT 0.6B** (no terms) | 52.9% (**+37.6 pp**, rule ≥ 15) | 17.3% (**−60%**, rule ≥ 25%) | **1195 / 1730 ms** | 506 MB |
| Whisper small.en (terms) | 77.6% | 10.7% | 11844 / 15312 ms (plugged in) | 496 MB |
| Whisper large-v3-turbo (terms) | 65.9% | 11.4% | 53313 / 68973 ms (plugged in) | 582 MB |

- **Parakeet** passes criterion 1 (accuracy) by a wide margin and criterion 4 (download, 506 MB ≤ 700 MB), but **fails criterion 2 (speed)**: on battery its final-text p50 is 1195 ms (bar 0.8 s) and p95 is 1730 ms (bar 1.5 s), over on both. Even plugged in, at its fastest, its p50 was 830 ms — already over. (The published int8 archive has no tokenizer to encode session terms, so it ran without hotwords; it still beat the control-with-terms on accuracy.)
- **Whisper** (both sizes) is the most accurate but is 9–53 s per utterance on this CPU (RTF 1.9–11.1), failing criterion 2 by 10–65×. Unusable as a per-utterance final pass here.

No candidate passes all of criteria 1, 2 and 4, so by the rule ("If none passes, adopt nothing"), nothing is integrated. This is a near miss for Parakeet on speed, reported as a miss with its numbers, exactly as the rule requires.

## Consequences

- The desktop and the browser keep the current streaming engine. The known accuracy limits (about 17% word error on read sentences, worse on names) stand; the session hotwords (now number-aware, ADR-0032 companion work) remain the main mitigation, together with the sentence-case display and the user's key terms.
- **Stage 2 is not built.** There is no Electron utility-process engine, no second decode pass, and no "Accurate transcription (beta)" setting. `docs/testing/final-test-plan.md` §6 ("New speech engine, only if adopted") does not apply and is marked so.
- No paid Claude requests were spent: criterion 3 (answer latency during decoding) is only measured for a candidate that already passes 1, 2 and 4, and none did.
- The trial code (`scripts/stt-trial.ts`, `scripts/lib/stt-score.ts`) and the downloads stay available (measure-only, outside the repo), so the trial can be re-run if a faster native model or a stronger laptop changes the speed picture. A future revisit would need a new ADR, not a change to this rule.

## Revisit triggers

Worth re-running the trial if any of these change the speed picture: a Parakeet build with a streaming or chunked decoder; a quantisation or runtime that roughly halves its per-utterance decode time; or a target machine clearly faster than the test laptop. Accuracy is already well past the bar, so only speed needs to move.

## Alternatives considered

- A second pass in the browser: rejected on Day 2 (COOP/COEP headers).
- A cloud speech API: rejected, because audio never leaves the device (architecture §4).

## Validation

- Results table in `docs/testing/benchmark-results.md`: Day 6 Stage 1, plugged in and on battery.
- If a candidate is adopted, Stage 2 measures it again inside the real app.

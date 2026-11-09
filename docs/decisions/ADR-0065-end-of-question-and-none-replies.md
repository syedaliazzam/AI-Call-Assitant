# ADR-0065: The end-of-turn model, and "none" replies for non-questions

- **Status:** Accepted (developer's plan of 9 Nov 2026, Phase 4)
- **Date:** 2026-11-10
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6.1 step 3, §7.5
- **Supersedes / superseded by:** refines ADR-0062's waits (the word rule becomes the fallback); extends ADR-0043's hidden types

## Context

ADR-0062 decides how long auto-answer waits by the last words of a line: 1.2 s when it sounds finished, 3.0 s when it ends on "and", "the", "about"… Words cannot tell "How big is the team." from "How big is the team… and" when the pause comes before the "and", and the live engine writes no punctuation. And some lines that the rules let through ask nothing at all (talk about the call, a remark): Claude then wrote a small-talk card for them.

## Decision

**1. The end-of-turn model.** Pipecat's **Smart Turn v3.2** (`smart-turn-v3.2-cpu.onnx`, int8, 8.7 MB, BSD-2-Clause, Hugging Face commit `f766f81`, SHA-256 `2bb02631…967e4f`) hears from the last 8 s of the other person's audio whether they finished their turn.

- Served from our own origin like the punctuation model (`/turn/`, fetched and checked by the build, git-ignored), and run by the same ONNX Runtime 1.30.0 WebAssembly build, on one thread, in its own worker (`core/turn/turn.worker.ts`). Nothing about a call leaves the device.
- Its input is Whisper's log-mel (80 × 800), computed in TypeScript as Hugging Face's `WhisperFeatureExtractor(chunk_length=8)` does (`core/turn/features.ts`): the last 8 s, padded with silence at the start; zero mean and unit variance; a centred 400-point STFT with a 160-sample hop by a mixed-radix FFT; Slaney mel filters; log10, floored at the maximum minus 8, then (x + 4) / 4.
- **Asked early.** The speech worker posts the other person's recent audio once they have been quiet for 300 ms while their words show (`pause` message, audio time), as Pipecat asks Smart Turn after a short pause. The judgment is usually ready before the line is final (about 1 s after they stop). The final line uses that judgment when its end of speech is within 300 ms of the pause's, otherwise asks again.
- **Auto-answer uses it only to shorten a wait** (`autoAnswer.ts`): when the words look cut off (the 3.0 s wait of ADR-0062) and the voice is clearly finished (≥ 0.8, `TURN_FINISHED_AT`), it answers after 1.2 s; while a judgment for such a line is still running it waits for it, at most 0.5 s past the 1.2 s (always inside the 3 s). It never lengthens a wait, and a line that looks finished never waits for it. No judgment (model unavailable, failed, timed out) → the word rule alone.
- **Why only shortening (measured, 10 Nov 2026).** On the synthetic calls (ADR-0063) the model was right on the cut-off "…and" (0.01) and on 6 of 7 question ends (0.83–0.98), but scored one finished question 0.02 and one complete question clause 0.01. Following it both ways added 0.35 s to the median answer delay and up to 1.8 s on the misjudged questions, with no gain in questions answered whole (7/7 either way, because a premature answer is already asked again on its card). The synthetic voices' flat intonation is exactly what the model listens to, so these numbers are not those of real speech; a lengthening role waits for evidence from real calls (the developer's self-test).

**2. "none" replies.** A new hidden type `none`: clear words that ask the user nothing — talk about the call itself ("can you repeat that?", "can you hear me?", "let me share my screen") or a remark that needs no reply ("let me pull up my notes"). Like `garbled`, the reply is only the two hidden lines. The card goes; a press of Answer gets "That wasn't a question — press Answer when they ask one, or type it."; auto-answer stays silent. Greetings, thanks and wrap-up the user would reply to stay `smalltalk`.

## Consequences

- Positive: the wait follows the voice (intonation, timing), not only the words.
- Negative: 8.7 MB more to fetch once, in the background at the first call. A judgment takes 0.3–0.5 s on the test laptop (one WebAssembly thread); asked at the pause, it is normally done before it is needed.
- Negative: the model was trained on English and other languages, not on code-switched Urdu; there the word rule and the 3 s wait are the safety net.
- Prompt change: the full evaluation suite ran once ($0.55 for 402 requests; developer's limit $1). Overall 8.82, notes 9.89, question-detection 9.73 (the two `none` scenarios 10.00). No real question was typed `none`. Every group met its last-release gate except `cv-embellishment`, which kept the last release's score (6.75; the grader listed more invented items, 13 against 6). That gate was already failing when the developer released v1.1.0 (`docs/testing/answer-eval.md`).

## Alternatives considered

- **LiveKit's turn detector:** its licence allows it only with LiveKit Agents.
- **A Claude call per pause:** a request and about a second of latency per pause.
- **Judging only at the final line:** measured at 0.3–0.5 s per judgment, it would have delayed auto-answer by that much.

## Validation

- Unit: `tests/unit/core/turn/{features,turnDetector}.test.ts` (the FFT equals the plain transform; the 8 s window; the mel bank; a fake worker), `core/answer/autoAnswer.test.ts` (judgment over the word rule; waiting for it), `core/stt/channel.test.ts` (the pause message), `core/transcript/transcript.test.ts`.
- The model with these features, in Chromium (9 Nov 2026, 30 synthetic sentences): complete sentences median **0.96** (83% at or above 0.5); the same sentences cut at 55% median **0.08** (67% below 0.5; some cuts fall on a natural phrase end).
- The synthetic calls (ADR-0063) before and after, and the full evaluation suite: `docs/testing/benchmark-results.md`, `docs/testing/answer-eval.md`.

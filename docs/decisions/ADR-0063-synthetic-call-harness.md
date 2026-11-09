# ADR-0063: A synthetic two-channel call harness for call quality

- **Status:** Accepted (developer, 9 Nov 2026: "no colleague and no human recording … measure with synthetic audio")
- **Date:** 2026-11-09
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §11 (Testing)
- **Supersedes / superseded by:** none (complements ADR-0027's names-set trial)

## Context

ADR-0062 changed how lines are joined, which lines are hidden and when auto-answer fires. Its unit tests and simulated calls check each rule on typed lines, but not what happens with real speech recognition: words split by the engine's own end-of-line rule, echoes heard through a room, noise, two people talking at once. There is no recording of a real call to measure on, and the developer chose not to make one: the plan is to fix first, measure on synthetic audio, and finish with the developer's own check on a recorded mock interview.

## Decision

1. **The script** (`apps/web/scripts/lib/call-script.ts`) is a three-minute interview with its ground truth: who says what and when, which lines are parts of which question, and what each line is (question, answer, talk about the call, remark, listening sound, another language). It has a question with a two-second thinking pause, the user's "um" and "okay" while a question is asked, a three-part question, "Sorry, can you repeat that?", "Can you hear me okay?", a question while a notification chime plays, a long pause after a remark, two lines of romanised Urdu read by the English voices (a stand-in for Urdu or Hindi), the user starting before a question ends, and 30 s of silence. All text is invented.
2. **The audio** (`pnpm --filter web calls:make`, `scripts/make-calls.ts`): each line is spoken by a Windows voice (the other person "David", the user "Zira"), trimmed, levelled to about −22 dBFS, and placed on two tracks. Four variants:
   - **headphones**: clean channels (a faint microphone floor);
   - **speakers**: the call's sound also reaches the microphone 21 dB down, 80 ms late, through a synthetic room (300 ms reflections, 5 kHz low-pass), as with laptop speakers and no echo cancellation for it (the desktop case);
   - **reverse-echo**: the user's voice comes back on the call's sound 20 dB down, 500 ms late, 3.4 kHz low-pass;
   - **noisy**: headphones with pink room noise 15 dB below the voice and keyboard clicks.
   The files go to `apps/web/eval-results/calls/` (git-ignored).
3. **The measurement** (`pnpm --filter web stt:calls --label=<name> [--src=<apps/web>]`, `scripts/stt-calls.ts`): both tracks go through the app's real speech worker in Chromium at real-time speed, side by side; every partial and final line is recorded with when it reached the page. The recording is replayed through the app's own transcript and auto-answer code on a simulated clock (`call-replay.ts`), the way the live page and the answer hook use them; an answer is "sent" when the app would send it (no request). `--src` measures another checkout, so the version before a change is measured with its own worker and rules.
4. **The metrics** (`call-metrics.ts`, the same code for every version): words on the right channel; lines from the other side; word error rate as shown, per channel; one-word noise lines per 10 minutes; multi-line questions split across lines and across turns; questions answered, answered whole (the card's lines cover at least 85% of the question's time), duplicate cards, cards for non-questions; question end → answer sent (p50, p95); other-language lines marked, English lines wrongly marked.

## Fixes found by the harness (shipped with it)

The first measurement of ADR-0062 (after-p1) left 1–2 of 7 questions unanswered on every call and showed one late rerun and one hidden user line. Each was traced to a rule and fixed:

- **The user's grey words no longer hold auto-answer back** (`autoAnswer.ts`): people start "So, um…" right after a question, exactly when they need the answer. A finished reply still ends the moment. (q4 and q7 were never answered.)
- **The other person's "mm-hm" while the user answers is never more of the question**, and the user talking (grey or finished) ends a continuation (`continuationOf`). (A rerun came 7.5 s late.)
- **A "Them" line is never the original of a "You" echo when it started more than 0.5 s after the "You" line** (`ECHO_ORIGINAL_LEAD_MS`): a speaker echo follows its original. With the user's voice coming back on "Them", the user's own line had been hidden as an echo of its own echo.
- **The user's own echo on "Them"**: a 0.6 match (0.5 while it overlaps the user's speech), and it must end at least 0.2 s after the user's words end (a speaker-leaked copy ends with its original). One-word "Them" noise while the user talks is hidden.

Result (benchmark-results.md): questions answered whole 7/7 on the headphones, noisy and reverse-echo calls (baseline 1/7), 5/7 on speakers (baseline 2/7); no duplicate cards; answers sent 1.6–1.8 s after a question ends (p95 under 2 s). On speakers, the remaining misses come from the other side's words leaked into the user's own lines: ADR-0064 (Phase 3) removes them from the audio.

## Consequences

- Repeatable, free and private: no person's voice, no Claude request, numbers only in the output.
- The synthetic voices are much easier to recognise than real speech (word error rate in single digits against 43% on the developer's voice), so the word error rates here are not those of a real call. The harness measures the rules (attribution, turns, questions, answers), which depend on timing and on what reaches each channel; accuracy itself stays measured on the names set (ADR-0027).
- The echo is simulated (a fixed delay, gain and room); a real laptop's speaker, microphone and the browser's own processing differ. The developer's mock-interview check is the real-world test.
- Real time: each variant takes as long as the call (about 3.3 minutes).

## Alternatives considered

- **Recording a real two-person call:** the developer chose not to (no colleague available).
- **Feeding faster than real time:** the worker's timing rules run on audio time, but its decoding speed and the arrival times the page sees would no longer be a call's.
- **Neural text-to-speech voices** (Piper, MMS): more natural, but a new download and licence for a test tool; the Windows voices are already on the machine.

## Validation

`tests/unit/scripts/{call-audio,call-script,call-metrics,call-replay}.test.ts`. Results: `docs/testing/benchmark-results.md` ("Call quality, synthetic calls").

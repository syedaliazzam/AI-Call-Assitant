# ADR-0064: The coupling gate keeps the speakers' echo out of "You"

- **Status:** Accepted (developer's plan of 9 Nov 2026, Phase 3)
- **Date:** 2026-11-09
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6.1 step 2
- **Supersedes / superseded by:** none (adds to ADR-0020's energy gate and ADR-0062's text echo rules)

## Context

On laptop speakers the microphone also hears the other person. In the desktop app the meeting app (Zoom, Teams) plays that sound outside the browser, so the browser's echo cancellation has nothing to compare with and leaves it in. The text echo filter (ADR-0020, widened in ADR-0062) hides a leaked line only when its words match what "Them" said, and the leaked copy is heard through a room and misheard differently, so some of it stays on "You".

The speech worker already receives both channels' audio on one audio clock (one AudioContext feeds both worklets).

## Decision

A **coupling gate** (`core/stt/coupling.ts`) in the speech worker, for the "You" channel only:

1. **Learn the coupling.** Every half second, over the last 3 s, it compares the loudness of each 10 ms frame of the microphone with the loudness of the "Them" sound 0–300 ms earlier, while "Them" talks. When, at the best delay, the two move together closely enough (correlation ≥ 0.6, from at least a second of "Them" speech), it keeps that delay and the echo's level (the 40th percentile of the power ratio, so moments when the user also talks do not raise it). A learnt coupling is used for 15 s unless confirmed again.
2. **Silence what it explains.** A 100 ms microphone chunk is replaced by silence before decoding when "Them" is talking in at least half of it and at least 90% of its frames are no louder than the predicted echo plus 6 dB. The silenced chunk also leaves the accurate engine's audio.
3. **The user still gets through.** Talking over the other person makes the microphone clearly louder than the echo, so those chunks pass. With headphones the loudness does not move together, nothing is learnt, and nothing is ever silenced.
4. **Order of arrival.** A microphone chunk waits (at most one step) until the "Them" sound up to its end has arrived; with no "Them" channel it is decoded at once.

## Consequences

- Positive: no new dependency, no download, almost no processor time (a few thousand additions per chunk), the same in the browser and the desktop app.
- Negative: it removes whole chunks, not the echo inside them: words the user says very quietly over a loud echo can be lost (the 6 dB margin and the 90% share keep this rare). The echo's tail after "Them" stops is not removed; the text echo filter remains the second net.
- If the right-channel share on the speakers call stays under 95% after this, a real echo canceller (WebRTC AEC3 compiled to WebAssembly) is next (the plan's condition).

## Alternatives considered

- **WebRTC AEC3 in WebAssembly** (`@ennuicastr/webrtcaec3.js`): removes the echo inside the sound, not whole chunks, but is a new, little-used dependency with unmeasured processor cost. Kept as the fallback.
- **Windows' own echo cancellation or capturing only the meeting app**: need a native module and a desktop release.

## Measured (9 Nov 2026, the synthetic calls of ADR-0063)

| Speakers call | Before (after-p2) | With the gate (after-p3) |
|---|---|---|
| Words on the right channel | 91.1% ("You" 84.2%) | **100%** ("You" 100%) |
| Lines from the other side on "You" | 3 | **0** |
| Word error rate on "You" as shown | 49.4% | **5.1%** |
| Questions answered whole | 5/7 | **7/7** |

The headphones, noisy and reverse-echo calls are unchanged by the gate (nothing learnt, nothing silenced; "You" WER the same). Right-channel words on speakers are above 95%, so the plan's fallback, AEC3 in WebAssembly, is **not** added.

Two rule fixes found on the way: a short line of listening sounds joined with one stray word ("um … O K", "okay" heard as letters) is still a blip (`blip.ts`), and the other person's own "mm-hm" is not part of their next question (`questionWindow` in `autoAnswer.ts`). With them every synthetic call answers 7/7 questions whole, with no duplicate cards.

## Validation

`tests/unit/core/stt/coupling.test.ts`; the "speakers" synthetic call (ADR-0063) before and after, in `docs/testing/benchmark-results.md`.

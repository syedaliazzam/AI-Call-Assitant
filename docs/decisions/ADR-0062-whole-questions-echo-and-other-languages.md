# ADR-0062: Whole questions, wider echo rules, and other languages (call quality, Phase 1)

- **Status:** Accepted (developer, 9 Nov 2026: "fix the issues first, measure with synthetic audio")
- **Date:** 2026-11-09
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6.1 (steps 2–3), §7.5 (auto-answer)
- **Supersedes / superseded by:** changes ADR-0020's echo rule, ADR-0043's question rules and Day 6's auto-answer rate limit

## Context

Real calls showed five problems: the other person's words on "You" and the user's on "Them"; one-word noise lines ("A", "And."); a question split by a pause or by a tiny "You" sound; answers from half a question, two answers for one question, and answers to talk about the call ("can you repeat that?"); and garbled text when someone speaks Urdu or Hindi. The investigation traced each to code:

- the echo filter judged only "You" lines of three words or more, by exact words, and never "Them";
- a "Them" line joined the one before only if no other line lay between them, and only within 1.5 s;
- auto-answer looked at the last line alone, 1.2 s after it ended, with a 15 s limit between answers; Answer then sent only the rest of a half-answered question as a new one;
- "repeat that" and most "can you hear me" forms were not in any skip list, and a plain remark was answered when pressed;
- the English-only model writes made-up English words for other languages;
- the desktop's loopback track ("Them") had the microphone's echo cancellation, noise suppression and auto gain on (measured with `track.getSettings()`, Electron 44.9.3).

## Decision

The developer's decisions of 9 Nov 2026: stay on the device (no cloud speech-to-text); recommend headphones, never require them; +1.8 s before auto-answering a line that sounds unfinished is acceptable.

1. **Turns join across the listener's blips.** A blip is two words or fewer, a run of listening words ("okay", "mm-hm", "I see") or noise (`core/transcript/blip.ts`). A line joins the same speaker's line before it across such blips (`transcript.ts`), and the turns view shows the blip after the turn (`turns.ts`). After a line that sounds cut off (`core/transcript/complete.ts`: it ends on "and", "the", "about", "how", a comma…), the join waits up to 4 s instead of 1.5 s.
2. **Auto-answer answers the question window** (`core/answer/autoAnswer.ts`): every unanswered "Them" line since the user really spoke, without greetings and talk about the call. It fires 1.2 s after a line that sounds finished and 3.0 s after one that sounds cut off; never while someone speaks; never for a question over 10 s old. **If the other person goes on within 4 s of an auto-answer starting, the answer is cancelled and asked again with the whole question on the same card** (same answer id). The 15 s limit is gone: one answer per question instead.
3. **Answer after a fragment** joins new plain words that continue the question just answered (within 8 s, no reply from the user) and asks again on that card.
4. **Talk about the call is a kind of its own** (`questionKind.ts` `meta`): asking to repeat, checking the sound or connection, screen sharing. It is never answered by itself; Answer skips it like a greeting. A remark with no question ("stop smirking") looks back to the last real question; it is answered as it is only when there is none. A request worded as a statement ("I'd like to hear about your Kubernetes work") counts as a question.
5. **Echo rules** (`echo.ts`): words that sound alike match; one or two words are hidden when they lie inside "Them" speech and "Them" said them within 1.5 s; a line wholly inside "Them" speech needs 50% instead of 60%; and **a "Them" line that repeats what the user said 0.2–3 s before is the user's own echo** and is hidden (not counted as speaker echo).
6. **Noise lines:** a lone "a", "and", "the", "uh"… is dropped at any loudness (`noiseLine.ts`); a one-word "You" line inside "Them" speech is hidden unless it is a short answer.
7. **Headphones hint** at the start of a call when the default output is named as speakers (`platform/media.ts` `outputKindOf`), as well as after three hidden echoes. Never required.
8. **Accurate text first:** while the desktop's accurate engine rewrites a line of the question, auto-answer waits up to 1.5 s more for its words (`Utterance.refining`).
9. **The desktop loopback track asks for no processing** (`DESKTOP_DISPLAY_OPTIONS`): checked in Electron 44.9.3, `getSettings()` then reports all three off; the microphone keeps them.
10. **Other languages read "[non-English speech]"** (`core/stt/language.ts`): the speech worker now passes the model's per-token log probabilities (`LineConfidence`); a line of five words or more is marked when the model was unsure (mean below −0.75, over 30% of pieces below −1) and fewer than 25% of its words are everyday English words. It is stored, shown and sent to Claude as the mark, never joined with English, never refined, never a question.
11. `docs/testing/calls/` is git-ignored.

## Consequences

- Positive: whole questions, one card per question, no answers to "can you hear me?"; fewer echo and noise lines; transcripts no longer cut a question at "okay".
- Negative: an answer to a line that sounds cut off starts 1.8 s later. A rerun spends a second request on the same question (Haiku, about $0.0003). A two-word reply between the other person's lines no longer separates them in the transcript; it is shown after their turn.
- Negative: the non-English rule can mark real English. Calibrated on 9 Nov 2026 with the real worker: 0 of 30 synthetic English lines, **1 of 41** lines of the developer's own name-heavy accented English (the hardest English we have), and 21 of 30 lines of romanised Urdu spoken by the English voices. Code-switching inside one line is mostly not caught. Phase 2 measures it on synthetic calls.
- No prompt change, so no paid evaluation; no desktop release (the loopback setting is in the web app).

## Alternatives considered

- **A Claude call to classify each line:** rejected again (ADR-0043): latency on every answer and a request each; Phase 4 adds a "none" reply type to the answer itself instead.
- **Cloud speech-to-text for code-switching:** rejected by the developer (audio stays on the device).
- **Hiding non-English lines:** rejected; the mark tells the user and Claude that something was said.

## Validation

- Unit: `tests/unit/core/answer/autoAnswer.test.ts`, `core/transcript/{blip,complete,echo,merge,questionKind,stability,transcript,turns}.test.ts`, `core/stt/{channel,language,noiseLine}.test.ts`, `platform/{media,desktop}.test.ts`.
- Simulated call (e) in `tests/integration/sim-calls.spec.ts`: a thinking pause, an "um" mid-question, a multi-part question asked again on one card, talk about the call, another language, a remark; `live.spec.ts` auto-answer.
- Phase 2 (`stt:calls`) measures every rule on synthetic two-channel calls, before (main at 32e5e74) and after.

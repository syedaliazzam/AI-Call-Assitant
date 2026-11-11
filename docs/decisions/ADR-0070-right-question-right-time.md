# ADR-0070: The right question at the right time, the other side out of the microphone, recordings that do not clip (1.5.2)

- **Status:** Accepted (developer's brief of 11 Nov 2026: "First: a short root-cause table … then implement. Don't stop to ask unless a check fails twice.")
- **Date:** 2026-11-11
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` 4.11.0, §5, §6.1, §6.2, §7.1, §11
- **Supersedes / superseded by:** refines ADR-0062 (question window, reruns), ADR-0064 (its fallback, AEC3, is now in), ADR-0065 (the end-of-turn model is asked at every pause), ADR-0066 (the user's lines are rewritten during the call when the engine is free), ADR-0068 (recording levels, Private), ADR-0069 (presses, the call timing log)

## Context

A real test call on desktop 1.5.1 (11 Nov 2026, 14:31; Claude voice as the prospect; ~456k characters of documents; screen recording on; the other side on the laptop's speakers) still answered late, answered the previous question, put up cards for "can you repeat that last part?", and showed the other person's words under "You". Its stereo file (You left, Them right), its TXT, its call timing log (read from a copy of the profile's `kite.callTimings`: ids and times only) and the server's log of its 26 requests were the evidence; a new replay (`pnpm --filter web call:real`) plays the stereo file through the real speech worker, Accurate and the end-of-turn model in real time, then through the app's transcript, auto-answer and press code with the presses the person really made.

Root causes:

1. **Presses answered the previous question.** Every grey line had the id `partial-them`; its final line got a new id. A press on grey words marked `partial-them` answered, so every later grey question looked answered and the final line of the one answered looked new: the next press took that one. 9 of 18 presses on the call answered speech that had ended 20–70 s earlier.
2. **Auto-answer missed questions.** Any finished "You" line ended the question window, also one that began while the question was being asked: the speakers' echo of the question (misheard, so the text echo rules kept it) or the user reading the last answer aloud. Three questions of round 2 got no auto-answer.
3. **Auto-answer was slow.** It waited for the final line (about 1.3 s after the voice stopped) and up to 0.5 s for Accurate: sent 1.9 s after the question, first word 3.9 s (p50).
4. **Meta lines got cards.** The punctuation or Accurate pass adds "?" to "Sorry, can you repeat that last part?"; once "can you repeat that" was removed, "Sorry, last part?" counted as a question.
5. **The other side under "You".** On speakers the microphone hears the other side about as loud as the user (−1.4 dB, 10 ms late); the browser's echo cancellation cannot cancel another app's sound; the coupling gate drops whole chunks only, and "You" audio set aside under load skipped it.
6. **Recordings clipped.** Both sides were summed at full level: the main mix reached +5.2 dBFS on this call, the stereo file's left channel +1.9 dBFS.

## Decision

1. **One id per spoken line** (`transcript.ts`): a grey line gets a `u<n>` id with its first words and keeps it as a final line; a grey line that joins the line before it leads there (`resolveId`). The answered set is read through it.
2. **A reply is speech that began after the other person stopped** (`core/transcript/reply.ts`, 0.5 s slack). Speech that began over their words ends neither the question window (auto-answer) nor what a press answers.
3. **Presses** (`core/answer/pressQuestion.ts`, pure, used by `useLiveAnswers.ts` and the replay): a continuation on its card; while the other person has only begun ("Next question…"), the press waits for the question (at most 8 s, "Listening for the question…"); else the unanswered question since the user's last reply, grey words included; else the newest real question, talk about the call looking back to it. A press on speech that already has a card shows that card, however long after (was 10 s); the card's re-answer button asks again.
4. **Auto-answer at the pause** (`autoAnswer.ts`): the speech worker posts a pause for every grey line of three words or more; the end-of-turn model's judgment goes on the grey line; at 0.7 (0.8 when the words look cut off) the question is answered at once, before its line is final, without waiting for Accurate. A pause ends only when the voice comes back (`resume`), not when the model writes its last word a moment late. The rule reads lines through the punctuation model's marks (`readableLine`, made at each pause and each final line), and a punctuated sentence that opens like a question is one. Checks run on a 250 ms tick and on every transcript change. A question that came due while another answer streamed is answered when that one finishes. A new question that starts more than 2.5 s after the answered speech is never a rerun of that card. A press on grey words is asked again on its card when the person goes on, even with auto-answer off.
5. **Talk about the call**: "repeat that last part / the second point / the last bit", "go over it again", "I missed that", "say again", group greetings, "talk soon", "see you…"; the "?" left after removing such a phrase no longer makes a question; a repeat of something named ("the price for forty seats") still does.
6. **Echo cancelling** (`core/stt/echoCanceller.ts`): WebRTC AEC3 in WebAssembly (`@ennuicastr/webrtcaec3.js` 0.3.0, BSD-3-Clause, pinned, copied to `/aec/` by `fetch-models` and SHA-256-checked) in the speech worker, with "Them" as its reference, before the coupling gate; "You" audio is cleaned in time order before it is decoded or set aside. Any failure turns it off (the call timing log says `echoCancel`).
7. **The user's lines during the call**: Accurate rewrites a "You" line when it has nothing else to do (`refineQueue.offerIdle`); otherwise after the call as before.
8. **Recordings**: each side at −6 dB, a limiter (−6 dB threshold, ratio 20) on the mix and on each side of the stereo file.
9. **Private warning**: a screen recording with Private off shows "Private is off: Paramount AI will appear in your recording" with **Turn Private back on**, in the overlay and the call window, and "Visible in recording" on the Rec pill.
10. **Call timing log**: a per-card table in the download (trigger, grey / early / rerun, question end → sent → first word → done, in seconds and ms); a rerun is an entry of its own; the echo canceller's state.

Desktop 1.5.2 has no functional change: everything above is in the web app, which the desktop app loads.

## Consequences

- Positive: presses answer the question being asked; every question gets one card; auto-answer is sent about a second after a question; meta lines get no card; the other side's voice is removed from "You" before decoding; recordings no longer clip.
- Negative: more end-of-turn judgments (one per pause of a grey line of 3+ words, about 0.3–0.5 s of one thread each) and a punctuation pass per pause (about 25 ms). An answer sent at the pause is occasionally asked again on its card when the person goes on (one more request). AEC3 costs about 3% of one core and 430 KB to fetch once. Accurate runs more during calls when the computer has room.
- The "You" words themselves (accent, reading speed) are improved only by Accurate; the live engine's words are as before.

## Alternatives considered

- **Documents read on the server instead of uploaded with each answer** (the account already holds them, ADR-0049): measured from this laptop, 167 KB gzipped adds 0.2 s to a request; not worth a data-flow change.
- **Hotwords from the answer cards** (the user reads them aloud): changing hotwords re-creates the recognizer; too heavy during a call.
- **Cancelling a streaming answer when the next question comes:** the user may be reading it; it finishes, then the new question is answered.
- **Measuring getUserMedia's processing options on the recording:** the file was captured with them on; they cannot be applied again to a recording. This laptop has one microphone (no headset to choose).

## Validation

- Unit: `core/answer/{pressQuestion,autoAnswer,repeatGuard}.test.ts`, `core/transcript/{reply,transcript,questionKind,refineQueue}.test.ts`, `core/stt/{echoCanceller,channel}.test.ts`, `core/recording/recorder.test.ts`, `core/live/callTimings.test.ts`, `features/live/PrivateOffWarning.test.tsx`, `scripts/real-call-replay.test.ts`; cases built from the real call's timeline.
- The real-call replay, before and after (`docs/testing/benchmark-results.md`, "1.5.2: the real call replayed").
- The limiter on the real call's audio in Chromium's Web Audio (peaks before and after).

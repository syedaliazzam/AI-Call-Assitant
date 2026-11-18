# ADR-0101: Cloud transcription for every account, and fast voice questions

- **Status:** Accepted
- **Date:** 2026-11-18
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §6, §6.1, §7.2, §10.1 (version 4.40.0)
- **Supersedes / superseded by:** removes ADR-0076's per-account list (`KITE_STT_DEEPGRAM_USERS`); changes ADR-0082's and ADR-0095's voice questions and Voice mode; reverts ADR-0099's 1.0 s dictation pause.

## Context

Voice questions (Ctrl+Shift+Space, Ctrl+Alt+Enter, Voice mode) were reported working on the developer's account and not on others.

- **The engine was not the difference.** `KITE_STT_DEEPGRAM_USERS` was set to the developer's account on 13 Nov 2026 and re-created on 14 Nov 2026, 13:43 UTC, outside any Claude session, and never edited since. A brand-new non-admin account received a Deepgram token from production on 18 Nov, so the value works as `*`: every account already had cloud transcription. The list is removed anyway: Deepgram is the engine for everyone, with no list to get wrong.
- **What did fail, for everyone:**
  - a question was sent only 1.0 s after the engine's final line (about 1.7 s after the speaker stopped);
  - a thinking pause cut it in half: the rest went to the transcript or was lost;
  - words spoken just before the press leaked into the question;
  - Voice mode dropped the question at any sound from the other side;
  - a voice question after the "Still in a call?" pause heard nothing;
  - in the browser the shortcut only works with the tab in front.

## Decision

### 1. Deepgram for every account

`cloudSttConfigured()` replaces `deepgramEnabledFor()`: calls use Deepgram (Flux for Them, Nova-3 for You) whenever `DEEPGRAM_API_KEY` is set. `/api/stt/token` gives any signed-in account a token. The on-device engine is only the automatic per-channel fallback. `KITE_STT_DEEPGRAM_USERS` is read by nothing; it is deleted from Vercel after the deploy. No other rollout list affects transcription (`KITE_ANSWER_MODELS_USERS` only adds answer models).

### 2. The voice stream (measured)

On the same 10 synthetic questions, streamed in real time from this laptop, the end-of-speech signals after the speaker stopped (p50 / p95) were:

| Signal | p50 / p95 |
|---|---|
| Nova-3 `speech_final` | 798 / 1,102 ms |
| Nova-3 `UtteranceEnd` | 1,687 / 3,135 ms |
| Flux `EagerEndOfTurn` | **379 / 849 ms** |
| Flux `EndOfTurn` | 697 / 1,514 ms |

All signals also fired inside 1.2–2.3 s thinking pauses. Nova-3's in-progress text only covered the last word about 600 ms after the stop (p50), so sending Nova-3's text on a Flux signal would often cut the last word; Flux's own text was as accurate on these questions (97/99 words against Nova-3's 91/99). The "You" transcript stays on Nova-3: investigation C3 measured Flux at 54% word errors on the user's real speech against Nova-3's 32%.

So in English sessions the microphone's audio also goes to a second socket on Flux, the **voice stream** (`cloudStt.ts`, `onVoiceEvent`, `voiceReady()`):
- It opens with the microphone channel and gets every microphone chunk, plus up to 3 s of what was said while it opened.
- It reopens itself 10 s after a drop.
- It never takes part in the failover.

A voice question uses its words and turn events. Without it (another language, not open, the on-device fallback), Nova-3's `speech_final` or an on-device final line is the signal.

The cost is one more Deepgram stream per call on the microphone, at Flux's per-minute price.

### 3. Speculative send (`core/voice/dictation.ts`)

- At the first end-of-speech signal the answer starts, **held hidden** (a speculative request, as ADR-0078's for Them, but shown or cancelled by the dictation, not a timer).
- It is **shown after 300 ms** (`VOICE_HOLD_MS`) with no new words. Flux `EndOfTurn`, the fallback or `sendNow()` show it at once.
- New words or Flux `TurnResumed` within the hold **cancel it silently**, and the whole question is asked at the next signal.
- Words within **1.8 s** (`VOICE_CONTINUE_MS`) after it was shown **extend it on the same card**: it is asked again with the whole question. A thinking pause never leaves half a question.
- An early signal on words that look cut off (`looksUnfinished()`) is not trusted.
- With no signal, **1.5 s of silence** (`CALL_FALLBACK_MS`) sends it.
- **Prewarm:** the press, and in Voice mode a question's first words, warm the answer's prompt cache (at most once in 20 s).
- **Timing trace:** each voice answer has the trigger `voice` or `voice-screenshot` and the speaker's end of speech, so stop → sent and stop → first word show in the card table. The trace also gets `voice` events: held, shown, cancelled, prewarm.

### 4. Voice mode and the other side

A short sound from the other side (fewer than 3 words and under 1 s: "mm-hmm", a noise) does not pause Voice mode. Real speech first sends what the user had already said (`sendNow()`), then pauses until 2 s after their last words. Voice mode now listens continuously (no restart between questions).

### 5. A clean press

At the press, the "You" line still being heard becomes a normal final line in the transcript, and its words (or the voice stream's current turn) are left out of the question (`skipWords`).

### 6. Listening paused

A voice question, or Voice mode turned on, first resumes a paused listen or answers "Still in a call?" (`beforeVoiceQuestion()`).

### 7. Groq

The admin switch was already off on 18 Nov, so the server never asks Groq. Sessions and defaults still set to Groq move to Claude Haiku when the dashboard opens, and in a running call (`core/session/retireModels.ts`).

### 8. The browser

`Platform.voiceShortcutHint()` returns "Voice shortcut works everywhere in the desktop app; in the browser, keep this tab in front." in the browser (null on the desktop app). It is shown in Settings → Hotkeys and after "Listening…" on the status bar.

### 9. The prompt

A voice question is sent with `spoken: true`. Instead of "Question typed by the user", the request text says "Question spoken by the user (speech recognition; may contain misheard words)", and the screenshot variant says the same. This is in the request text, not the admin's prompt.

### 10. Ask AI

The Ask AI page's dictation (no signals there) waits 1.5 s after a final line again. ADR-0099's 1.0 s cut questions in two.

## Consequences

- One more Deepgram stream per call (the microphone on Flux), in English sessions.
- A cancelled speculative answer costs a request that is stopped early; a question extended after it was shown costs a second request.
- `KITE_STT_DEEPGRAM_USERS` should be deleted from Vercel; a stale value has no effect.

## Alternatives considered

- **Move the "You" transcript to Flux:** faster, but much less accurate on the user's speech (investigation C3). Rejected.
- **Send Nova-3's text on Flux's signal:** the last word is often not there yet. Rejected.
- **Lower Nova-3's endpointing for the microphone:** still about 500 ms slower than Flux at the 300 ms setting, and it would split "You" lines more. Rejected.
- **Open the voice stream only at a press:** about 0.5–1 s to open from Pakistan, and Voice mode needs it continuously. Rejected.

## Validation

- Unit tests:
  - the dictation: speculate, hold, show, cancel, extend, fallback, cut-off words, skipped words, `sendNow`, continuous;
  - Voice mode: short sounds, real speech, resume;
  - the voice-stream mapping;
  - `cloudStt`'s voice stream: open, feed, keep apart, reopen, close;
  - the token route with no list;
  - the spoken prompt label;
  - the hygiene action;
  - the Groq move;
  - the status-line hint.
- Measured on production before and after with `tests/e2e-prod/voice-latency.spec.ts`: `docs/testing/benchmark-results.md`, ADR-0101.
- `answers` evaluation with `--spoken`: 9.30 (gate 8.86).

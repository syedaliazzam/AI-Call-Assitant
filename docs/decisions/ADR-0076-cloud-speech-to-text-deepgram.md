# ADR-0076: Cloud speech-to-text with Deepgram, newest-question rules, and a timing trace

- **Status:** Accepted (developer's decisions, 13 Nov 2026, on the production-readiness investigation; rolled out per account with `KITE_STT_DEEPGRAM_USERS`, the developer's account first).
- **Date:** 2026-11-13
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` 4.17.0: §1 (Speech-to-text), §6.1, §7.2, §8.1, §10.1, §11
- **Supersedes / superseded by:** reverses "Audio never leaves the device" (CLAUDE.md, architecture §1 and §8.1, ADR-0020's privacy premise) for the accounts in the rollout. Amends ADR-0062, ADR-0065 and ADR-0070 (question rules and the end-of-turn model) for those accounts. ADR-0069's watchdog changes for every account.
- **Investigation:** `docs/investigations/2026-11-13-production-readiness.md` (sections C, E, G, I; plan items P0-1 to P0-5, P0-9, T0.1)

## Context

The investigation of the 12–13 Nov 2026 calls showed that the on-device speech engine cannot keep up on the team's laptops on battery, with or without a meeting recording:

- the worker was behind for most of the call, so the user's audio was set aside;
- with recording on, the other side's audio was skipped 20 times, and a third of their speech never became a line;
- the stuck-engine watchdog restarted the engine during normal talk, throwing away the audio it was holding.

On top of that, presses answered whatever the transcript held:

- grey words, with no flush (incomplete questions);
- or a look-back to "the newest question of the call" when the new one was late, joined to an answered line, or unpunctuated (old questions).

Measured from this machine:

- Deepgram Flux gives the other side's first words in about 0.3 s and the end of a turn in about 0.5 s on the real Claude voice.
- Nova-3 halved the local engine's errors on the user's own voice.
- The EU endpoint is faster from Pakistan than the US one.

## Decision

### Engine (accounts in `KITE_STT_DEEPGRAM_USERS`)

1. **Both channels stream to Deepgram**, from the device straight to Deepgram over two WebSockets (never through Vercel):
   - Flux (`flux-general-en`) for "Them", Nova-3 for "You";
   - the EU host;
   - host and model per channel are server settings (`DEEPGRAM_HOST`, `DEEPGRAM_MODEL_THEM`, `DEEPGRAM_MODEL_YOU`);
   - non-English sessions use Nova-3 `language=multi` on both channels.
2. **Parameters (investigation C3):**
   - Flux: `eot_threshold=0.7`, `eager_eot_threshold=0.5`, `eot_timeout_ms=5000`.
   - Nova-3: `interim_results`, `smart_format`, `punctuate`, `endpointing=300`, `utterance_end_ms=1000`, `vad_events`.
   - Both: `mip_opt_out=true` and `redact_usage=true`, plus up to 50 session keyterms (`buildKeyterms()`; the same list on both channels).
   - If a handshake fails with the optional parameters (keyterms, `redact_usage`), it is tried once without them, so an unknown parameter cannot stop cloud transcription.
3. **Tokens (P0-1):**
   - `POST /api/stt/token` serves signed-in accounts in the rollout only, at most 30 a minute per account.
   - It mints a 60-second token with `/v1/auth/grant` on the same host.
   - `DEEPGRAM_API_KEY` never leaves the server.
   - Sockets open at Connect, never at a key press, and each reconnect asks for a fresh token.
4. **Audio (P0-2):**
   - Two streams of 16 kHz linear16 mono in 80 ms chunks.
   - A light audio worker (no decoding) runs AEC3 with "Them" as the reference, then the coupling gate, on "You" **before** anything is sent.
   - It stamps every chunk with one capture clock.
   - The page keeps the last 10 s of each channel.
5. **Fallback (P0-3), per channel, to the on-device engine:**
   - The engine is loaded and idle from the moment the page opens; its own echo canceller, Accurate and the end-of-turn model are off.
   - It takes over on a socket error or close, no message for 3 s while that channel's level shows speech, offline, a token failure, or more than 5 s of audio queued to send.
   - The audio Deepgram had not finished is replayed into it from the 10 s store, on the same clock; anything older is marked "[audio gap]".
   - The notice reads "Cloud transcription unavailable — using on-device transcription".
   - Deepgram is retried after 1, 2, 5, 10 and then every 30 s, and takes the channel back after 30 s healthy, at a pause.
   - While Deepgram is active on a channel, Accurate, Smart Turn, the punctuation worker and the backlog controller do not run for it.

### Watchdog (P0-4, every account)

The stuck-engine watchdog counts sound only on a channel the on-device engine really decodes, and never restarts the engine while its backlog is not ok.

### Question rules (P0-5, E3 rules 1–9, accounts in the rollout)

1. **One clock:** grey and final lines carry capture times.
2. **Caught up before choosing:** a press waits until "Them" is processed up to the press (Flux `audio_window_end`, Nova-3 `Finalize`), at most 300 ms; a card sent after a timeout says the question may be incomplete.
3. **Newest by time:** the press sends exactly the other person's speech that started after the newest answered speech (and after the user's last real reply), per segment even inside joined lines.
4. **No look-back** when newer speech exists; an earlier card is shown only when nothing new was said.
5. **Replies** are unchanged.
6. **Completeness:** any new word within 2 s re-asks on the same card (presses and auto-answers).
7. **Feedback:** every press ends in a new card, "Showing the earlier answer", "Already answering" or "Nothing new to answer".
8. **Gaps:** a press after lost audio says so.
9. **Auto-answer** fires at Flux EndOfTurn and re-asks after a resumed turn. There is no speculative hold yet (Batch C).

### Hotkey feedback (investigation G 1–4)

- A second press while waiting answers at once.
- "Finishing the question…" shows only after 150 ms.
- The overlay warns for the whole call when another app holds the Answer shortcut, with a button to Settings → Hotkeys.

### Privacy (P0-9)

- The privacy policy, the sign-in panel, the help texts, the architecture document and CLAUDE.md say that call audio is streamed to Deepgram and never stored.
- The privacy policy also says the rollout is account by account.

### Timing trace (T0.1)

- Settings → Transcription → **Timing trace**: this device only, off by default.
- It adds to the call timing log:
  - the capture clock every 10 s;
  - speech onsets;
  - each line's engine;
  - socket opens, closes and codes;
  - failovers, replays and gaps;
  - the send queue;
  - turn events;
  - every press: the wait, whether it timed out or was forced, the decision, words asked against the final words;
  - auto decisions;
  - each request's phases, the server's timings and the cache token counts.
- Codes and numbers only, never words. It downloads with the existing log.

## Consequences

**Positive**

- Nothing on the laptop can fall behind and drop speech; recording no longer competes with transcription.
- First words arrive in about 0.3 s and turn ends in about 0.5 s; the user's own lines are more accurate.
- A press answers the newest speech, complete, and always says what it did.
- The on-device engine keeps calls going through network trouble.

**Negative**

- Call audio leaves the device (to Deepgram), which needs the new privacy text and internal approval.
- Deepgram costs about $190–260 a month for 4 users at 2 h a day on both channels.
- Two engines to maintain.
- The local engine's model (≈ 200 MB) still downloads, as the fallback.
- Not done here:
  - the shell's press timestamp (it needs a desktop release);
  - the overlay paint time;
  - recording frame statistics and per-process CPU in the trace.

## Alternatives considered

- **One multichannel Nova-3 stream:** the same latency, but Nova-3 only (no Flux turn events), one parameter set, and both channels fail together.
- **Nova-3 on both channels:** Nova-3's endpointing fired 12–17 times inside multi-sentence turns; Flux's turn events are what auto-answer needs. Kept as the switchable alternative (`DEEPGRAM_MODEL_THEM=nova-3`).
- **Keep the on-device engine and tune it:** it collapsed on battery under recording load; no tuning removes that.
- **Proxy audio through Vercel:** adds a hop and cost, and the function limits do not suit long streams.

## Validation

The developer's manual tests from the investigation, with the timing trace on:

- **T1.1:** Deepgram live (headphones).
- **T1.2:** Wi-Fi off for 20 s (fallback and recovery).
- **T1.4:** speakers (echo).
- **T2.1:** press as each question ends (complete questions, wait ≤ 300 ms).
- **T2.2:** two questions back to back, then a second press (newest, then "Showing the earlier answer").

Unit tests cover:

- the token route;
- the adapter (URLs, Flux and Nova-3 assembly on the capture clock, catch-up, close);
- the failover rules and the orchestrator (replay, probe, return);
- one-clock line times;
- every E3 rule;
- the watchdog rules and the trace.

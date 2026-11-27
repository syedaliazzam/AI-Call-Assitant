# Investigation: speaker labels for "Them" and transcription delay (27 Nov 2026)

Investigation only: nothing here is built or released. All audio was invented (Windows OneCore text-to-speech voices; a fourth voice made by lowering one with SSML). No real call was used. Measured on the Windows 11 dev laptop on 27 Nov 2026, Deepgram EU endpoint (from production's `/api/stt/token`), the app's own URL settings and 80 ms linear16 chunks, at real-time pace. 31.7 minutes of audio, about $0.19 of Deepgram.

Prompted by a real Mac call where two remote people were one "Them" with blocks of up to 3 minutes.

## B1. Speaker separation

### Findings

1. **Flux (our "Them" model) has no speaker labels.** `diarize=true` and `diarize_model=latest` on `/v2/listen` are refused at the handshake (HTTP 400, unknown query parameter). Deepgram's Flux/Nova-3 comparison lists diarization as not available on Flux. Flux words carry `word`, `confidence`, `start` and `end` only.
2. **Nova-3 streaming has speaker labels.** `diarize=true` (deprecated, routed to the v1 diarizer) and `diarize_model=latest` are both accepted; every word carries `speaker` (0, 1, 2…), interims too; no `speaker_confidence` in streaming. No measurable added latency (first interim 719 / 1,129 ms p50 / p90 without, 709 / 1,115 ms with; finals 2,889 / 4,837 vs 2,886 / 4,848 ms).
3. **Why the blocks were 3 minutes long.** With several voices on one stream, Flux almost never ends a turn (7 ends of turn in 7 minutes; 64 of 66 true speaker changes fell inside one Flux turn). The app makes one line per end of turn, and `merge.ts` and `turns.ts` join lines further. A fix needs both labels and splitting by word time (Flux words do carry times: 1,262 of 1,262).
4. **Accuracy (Nova-3, word level, best one-to-one mapping; real people will be worse):**

| Case | Length | Voices true / found | Accuracy | Stable from | New speaker's own label after | Interim label changed at final |
|---|---|---|---|---|---|---|
| 2 voices | 94 s | 2 / 2 | 99.3% | 0 s | 0 s | 24% |
| 3 voices | 77 s | 3 / 3 | 93.3% | 30 s | 4.5 s | 41% |
| 3 voices, 2 min | 117 s | 3 / 3 | 99.4% | 0 s | 0 s | 38% |
| 3 voices with 4 overlaps | 46 s | 3 / 3 | 74.6% | 40 s | 23.6 s | 25% |
| 4 voices | 87 s | 4 / 3 | 65.5% | 70 s | 53 s | 42% |

Overlapped words were mostly lost (about 20 of 154 came out inside overlaps). Final labels arrive about 2.9 s (p50) after the word.

5. **Alignment works.** Nova-3 labels matched to Flux words by time: 100% of words aligned, accuracy equal to Nova's own (99.3 / 91.6 / 66.0 / 73.7 / 99.4%).
6. **No desktop release needed.** The sockets are opened by the web page (`core/stt/deepgram.ts` from `cloudStt.ts`); the desktop shell has no connect rule or bridge involved.

### Cost (Deepgram pay-as-you-go, read 27 Nov; recheck before an ADR)

Flux $0.0065/min, Nova-3 streaming $0.0048/min, diarization add-on $0.0020/min.

| Option | Extra per call-minute | Notes |
|---|---|---|
| A. Keep Flux, add a Nova-3 "labeller" socket with diarization (recommended) | +$0.0068 (about $0.41/h) | Keeps Flux's turn events and first-word speed |
| B. Switch "Them" to Nova-3 + diarization | +$0.0003 | First words about 0.7 s later; loses Flux turn events; silently turns off the ADR-0101 voice stream (`cloudStt.ts` opens it only with a Flux "Them" model) |

AssemblyAI streaming has `speaker_labels` and `max_speakers` (docs only, about $0.0070/min); not worth switching.

### Fix plan

0. ADR and architecture bump: the hybrid labeller, cost, accuracy caveats, kill switch, setting.
1. Server flag `KITE_STT_DIARIZE` (default off) in `server/deepgram.ts`; `SttTokenResponse.diarize`; tests. A kill switch without a deploy.
2. `core/stt/deepgram.ts`: `ListenSettings.diarize` (Nova only; never on `/v2/listen`), `words[].speaker`, a `LabelAssembler`; Flux word times on partial and final events. `cloudStt.ts`: the labeller socket (own token and backoff; its failure never affects transcription; label ids carry a socket epoch, since numbering restarts per socket).
3. `core/transcript/voices.ts` (pure): labels to Flux words by midpoint; one line per label run (ignore runs under 3 words between equal labels); a new block at a speaker change or a gap of 2 s or more; re-split when final labels arrive. `Utterance.voice` / `voiceProvisional`; `merge.ts` never merges different voices; `turns.ts` joins the same voice only.
4. Names: "Speaker 1 / 2 / …" by first appearance (one-voice calls stay "Them"); rename during or after a call, kept for that call (`StoredCall.voiceNames`); "my teammate" and "same person as…"; in the live transcript, overlay and review.
5. Labels in the saved transcript, PDF and Drive files, and the notes request.
6. Answers know who asked (`CallLine.who`, absent on one-voice calls so the cache is unchanged); teammates' questions are not treated as the client's (`newestQuestion.ts`, `autoAnswer.ts`, `context.ts`). A prompt change: full `eval:all` first, cost agreed.
7. A Settings → Transcription switch (default off at first), with the cost in its wording.
8. Checks, a paid real-API check (about $0.2, agreed first), and a real multi-person call with the timing trace on. Web deploy only.

### Risks

Real voices merge more than TTS (4+ people); a new speaker can carry an old label for 5–24 s; interim labels change at the final for a quarter to two fifths of words (show them as provisional); overlaps lose words; numbering resets on reconnect; the cost runs on 1:1 calls while the setting is on; Flux turn events stay weak in group calls (existing behaviour).

## B2. Transcription delay (Windows, EU endpoint, the app's settings; p50 / p90)

| Signal | Them (Flux) | You (Nova-3) |
|---|---|---|
| Word first shown after it was spoken | 209 / 368 ms | 719 / 1,129 ms |
| Last word visible after speech ends | 140 / 569 ms | 711 / 1,682 ms |
| Final / end of turn | EndOfTurn 1,666 ms (rare with several voices); Eager 932 ms | word final 2,889 / 4,837 ms; `speech_final` 713 ms; UtteranceEnd 1,727 ms |
| Messages | an update every 240 ms | an interim about every 1 s |

Key-press catch-up (the rule the app used until ADR-0132): Flux waited 238 / 300 ms and hit the 300 ms cap on 23% of presses; Nova-3 with `Finalize` 249 / 292 ms. ADR-0132 removes this wait for presses.

What we control that adds delay: 80 ms audio chunks (`CLOUD_CHUNK_SAMPLES`); the mic chunk held up to about 160 ms for the echo reference (`audioCleaner.ts`); Nova-3 endpointing 300 ms / utterance end 1,000 ms; Flux end-of-turn thresholds (0.7 / 0.5 / 5 s timeout); the catch-up (removed for presses). Network to the EU host is about 155 ms TCP.

No Mac Deepgram latency has been measured. The scripts used here (kept outside the repository) can be copied to a Mac and run from `apps/web` with the disposable test account's lines in `.env.local`; about 10 minutes of audio, about $0.05.

# ADR-0078: Speculative answers, a shorter request path, document parts per question, and a recording that gives way

- **Status:** Accepted (developer's request, 13 Nov 2026: Batch C of the production-readiness investigation).
- **Date:** 2026-11-13
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` 4.19.0: §5 (recording, notices), §6.1, §6.3, §7.2
- **Supersedes / superseded by:** amends ADR-0076 (auto-answer at Flux EndOfTurn now holds its card 400 ms; keyterms change mid-call), ADR-0067 (the live answers' cached prefix is the CV and the documents summary, like the smart-model routes), ADR-0068 (no VP8 screen recording; the frame rate yields under load), ADR-0069 (the overlay's 200 ms throttle no longer delays an answer's first words; the silence notice for "Them"), ADR-0036 (the daily-limit count runs alongside Claude's request).
- **Investigation:** `docs/investigations/2026-11-13-production-readiness.md` (sections D, G, H, A5; plan items P1-1 to P1-6, P2-1)

## Context

After Batches A and B, the other side's words arrive in about 0.3 s and Flux ends a turn about 0.5 s after the question. What remained between the end of a question and the answer's first words was the request path and the document size:

- `countRequest` (a database round trip) ran before Claude was called;
- the overlay received state at most every 200 ms, the first words included;
- every request carried every document in full (up to 500k characters; 2.1 s p50 against 1.1 s with the CV only);
- the connection to Vercel's edge could go idle between answers (a new TLS handshake, about 180 ms).

The Claude voice ended a turn early in 14 of 26 questions (it pauses between the sentences of one question). Answering at EndOfTurn with no hold showed a card that was then asked again.

Other findings from the same investigation:

- the "can't hear the other side" notice fired 15 times in one interview, every time while the user was answering;
- Windows' loopback hears only the default output device, and nothing re-opened it when that changed;
- a screen recording could fall back to software VP8 in the call's page (+0.2 of a core);
- nothing made the recording give way when the computer was short of CPU.

## Decision

### P1-1 Speculative answer (accounts with cloud transcription)

1. Auto-answer still sends at Flux EndOfTurn. The answer streams into a card that is **held hidden for 400 ms** (`core/answer/speculative.ts`).
2. Within the hold, new words of the other person (a new turn, or the asked line growing) or Flux `TurnResumed` **cancel it silently**:
   - the request stops;
   - the card never shows;
   - everything it marked as answered is restored, so the next end of turn asks the whole question.
3. After the hold the card shows. If the turn really continues, the ADR-0076 rule-6 re-ask asks again on the same card.
4. A press during the hold shows the held card at once.
5. The timing trace records `speculative` sent, held, shown and cancelled; the per-card table marks such cards.

### P1-2 Request path

1. `/api/answer` starts Claude's request and the daily-limit count at the same time (`server/prime.ts`). Over the limit, the Claude request is aborted at once and the reply is the same 429; no text reaches the browser.
2. The overlay gets an answer's first words at once; later pieces still at most every 200 ms.
3. During a call the page sends `HEAD /api/answer/ping` every 25 s. It is authenticated (204, the cookie cache), not Claude, and not counted.
4. The trace keeps the cache read, cache write and input token counts of every answer (since ADR-0076), and now the number of document parts sent.

### P1-3 Keyterms mid-call

- The live screen watches the session and its documents.
- When the keyterms change, the Flux socket gets them with Deepgram's `Configure` message (no reconnect). Its reply (`ConfigureSuccess` / `ConfigureFailure`) goes to the trace.
- A Nova-3 socket is not reconnected for it: its next connection uses the new list.

### P1-4 Hotkey feedback

- Investigation G 1–4 shipped with ADR-0076.
- Added here: the overlay's answer card says "The question may be incomplete…" when a press gave up waiting, as the call window already did.
- G5 (the shell's press timestamp) needs a desktop release and is not done.

### P1-5 Silence notice and output device

1. "Them" counts as silent only after 60 s without sound, while the user is not speaking (no sound for 2 s), and with the user heard within that minute (so a call where nobody talks yet stays quiet). The microphone rule is unchanged.
2. When the default output device changes, the system-audio capture ("Them" on the desktop) is re-opened on it. A shared tab is left alone.

### P1-6 Recording

1. Standard stays **720p, 15 fps, hardware H.264**.
2. Without a hardware H.264 encoder there is no screen recording during a call: a screen start records sound only, with a notice, and later recordings on that computer start as sound only.
3. The screen's frame rate drops to 5 fps:
   - under CPU pressure (Compute Pressure `serious` or `critical`);
   - while speech is transcribed on the computer and needs the room: a cloud call's channel on the on-device fallback, or the on-device engine behind (backlog ≠ ok).

   It comes back after 30 s of calm. The sound is never touched.
4. The trace gets the format, each yield, and the frames delivered and dropped every 10 s (`MediaStreamTrack` stats).

### P2-1 Relevant document parts

1. Live answers and their warm-ups send the CV in full and the documents summary (ADR-0067) as the cached session block, not every document.
2. Each question gets the 3–5 parts of the other documents that match it best (BM25 over parts of about 1,200 characters, at most 1,600 each, at most 5) in the uncached tail.
   - The parts are made once per document text in the page, when the call loads its documents (a 500k-character document takes milliseconds).
   - They are not stored: storing them would need a schema version and hooks on six document write paths, for no speed gain.
3. Every request stays under **100,000 input tokens** whatever the documents' size (`server/budget.ts`):
   - the session block has a fixed ceiling of 120,000 characters (the same bytes for every request of a session; only an older page that sends every document reaches it);
   - the prompt is counted at 3 characters a token plus a screenshot's allowance;
   - only past 95,000 do the parts, the similar answer, the oldest latest lines and the oldest conversation chunks go, in that order.

## Consequences

**Positive**

- The answer starts about 0.1–0.3 s sooner on the request path, and the first words reach the overlay without a 200 ms wait.
- An early end of turn no longer flashes a card that is asked again.
- Request size no longer grows with the documents.
- The silence notice is meaningful in interviews; a headset switch no longer leaves "Them" deaf.
- Recording cannot take CPU from speech.

**Negative**

- Claude requests: a cancelled speculative answer has already been sent, and it is billed for its input (mostly a cache read).
  - Compared with Batch A, which already answered at EndOfTurn and re-asked, the count is the same.
  - Compared with answering only after a 1.2 s pause, the investigation estimates +30–50% auto-answer requests on voices that pause inside questions; T2.3 measures it.
- A request over the daily limit now starts a Claude call that is aborted within the database round trip.
- Answers see the documents through the summary and the matching parts, not in full. A question whose answer is in a part that BM25 does not rank in the top 5 now leans on the summary.
- The live-answer prompt changed. The evaluation (`eval:all` or `--only=answers`) is a paid run and has not been run; it needs the developer's agreement.

## Alternatives considered

- **Send at EagerEndOfTurn:** about 70 ms sooner on the real voice, for more cancelled requests. Not now.
- **Store document parts in IndexedDB at save time:** see P2-1. No speed gain.
- **540p 10 fps Standard:** the developer chose to keep 720p 15 fps.
- **Always yield the recording on the on-device engine:** every account without cloud transcription would record at 5 fps. Only when it falls behind.

## Validation

Developer tests:

- **T2.3:** auto-answer latency, cancelled vs shown speculative answers.
- **T3.1:** recording on battery: frames per 10 s, yields.

Unit tests cover:

- the hold, cancel, show and release, and when the other person went on;
- chunking and BM25 ranking;
- the 100k cap with the largest possible request;
- the frame-rate yield and the pressure watcher;
- the parallel daily-limit count (429 and abort; Claude started before the count answers);
- the overlay's first words;
- the ping;
- Flux Configure;
- the silence rule;
- the device watch's output key;
- no VP8;
- the recorder's frame cap and counters.

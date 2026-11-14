# ADR-0079: Flux lines start at the first word, a bounded re-ask, a press always answers, more keyterms

- **Status:** Accepted (developer's request, 14 Nov 2026: Batch D, the fixes of the 14 Nov test call).
- **Date:** 2026-11-14
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` 4.20.0: §6.1 (cloud transcription), §7.5, §5 (session window)
- **Supersedes / superseded by:** amends ADR-0076 (rule 6 re-ask: anchored, at most once, auto-answer-off behaviour; rule 7 and 8: a press always ends in an answer; keyterms ≤ 100 with names) and ADR-0062 / ADR-0070 (one card per question still holds while an answer streams or the same sentence is finished; otherwise a new linked card). The Drive file set change of the same batch is ADR-0080.
- **Investigation:** `docs/investigations/2026-11-14-test-call-issues.md` (R1, issues 1–6; fixes P0-A, P0-B, P0-C, P1-D, P1-F, P1-G, P2; decisions D1, D2, D4, D5)

## Context

In the 14 Nov test call (cloud transcription, auto-answer off) one wrong number caused four of the seven reported problems:

- **R1.** A Flux "Them" line started at Flux's audio window start, which is where the previous turn ended, not where the person began speaking. Every "Them" line therefore started 0.1–0.2 s after the previous one ended, often before the user's reply to it.
- That line sorted above the user's reply (answers then sat above earlier lines, issue 3), joined the previous "Them" line across the reply (issue 4), and made every reply look "started over Them", so no reply ever ended a question.
- The rule-6 re-ask then never stopped: each re-ask moved its own window forward (18 re-asks with auto-answer off, issue 1), and each one overwrote the card's finished answer (21 answers streamed, 5 saved, issue 2).
- Keyterms: 40 were sent, none was a person's name, and CV names written in different capitalised runs ("Freshdesk", "Toptal") never reached two mentions (issue 5).

## Decision

### P0-A Flux line start (`core/stt/deepgram.ts`)

- A turn's start is fixed by the first message that shows speech:
  - the first word's own `start`, when Flux sends word times (Deepgram documents them as optional) and they fall within the turn's window;
  - otherwise the StartOfTurn message's position (or the first message with words) minus `FLUX_FIRST_WORDS_LEAD_S` = 0.4 s, never before the window.
- `tEnd` is unchanged. Partials carry `audioFrom` (the window start), so a failover still replays from the earliest possible audio.
- No recorded Flux stream was available on this machine (no Deepgram key locally), so whether word times arrive is not yet known. The trace event `flux-start` records `source` (`words` / `start-of-turn` / `first-words`) and, when words carry times, `wordLeadMs`, so the next traced call confirms or corrects the lead.

### P0-B Bounded re-ask (`core/answer/newestQuestion.ts`)

- The re-ask window is anchored on the card's **original** answer (`anchorStart`, `anchorEnd`); a re-ask never moves it.
- At most `MAX_REASKS` = 1 re-ask per card.
- As in the legacy rules, a new stretch that is a question of its own and starts more than 2.5 s after the speech before it is the next question. With the 2 s anchored window this second guard only acts if the window is widened.
- **D1 (a):** with auto-answer off, only a press on grey words (still being spoken) is asked again, once. With auto-answer on, presses and auto-answers are asked again, once.

### P0-C New card for a new question (`features/live/useLiveAnswers.ts`, `core/answer/history.ts`)

- **D2:** a re-ask replaces its card only while the first answer is still streaming, or when the added words just finish the sentence the first request ended in (`finishesSameSentence`).
- Otherwise it gets a **new** card and saved record with `rerunOf` pointing at the first. `mergeAnswers` never folds linked answers together, live or on the session page.

### P1-G A press always answers

- A press answers everything after the speech answered on cards of their own (`ownEnd`). A re-ask that replaced a card does not count, so words it took in get their own card when pressed for.
- When the newest card answered words said since the user's last press (auto-answer did), the press shows it with no "earlier answer" notice.
- If Claude found nothing to answer in an auto-answer's words, they stay unanswered for a press.
- **Lost audio:** the newest words are answered (around the gap when nothing came after it, up to 10 s before it), and the card says "Part of their audio was lost." The notice alone remains only when they said nothing near the gap.

### P1-D Merge guard (`core/transcript/merge.ts`, `transcript.ts`)

Two lines of one speaker never join when a final line of the other speaker ends between them. Blips, hidden echo or noise lines, and gap marks don't count.

### P1-F Keyterms (`core/stt/sessionHotwords.ts`)

- Order: the session's Key terms first, then the signed-in user's first name (from the account name, passed by the route), the contact's name, company, role, the Interview vocabulary, document names, then single capitalised words that repeat across runs (`extractSingleWordTerms`: at least 2 mentions, one inside a sentence; acronyms, common words and heading words left out; at most 30).
- At most 100 terms (Deepgram's documented limit) and 1,500 characters in all.
- The session window's Call details lists them as "Words Paramount AI listens for", with **Edit key terms**.
- The on-device hotwords are unchanged.

### P2 Session window

Answers in the transcript are open by default (D4); a click folds one away. Old calls keep their order (D5): the first-word times were never stored.

### Timing trace

When "Timing trace" is on, the trace now records:

- `socket-open` with `optional` and `terms` (0 when the optional parameters were dropped);
- `configure` with `terms` (unchanged);
- `flux-start`;
- `reask` with `reason` (`grew` / `went-on`), `card` (`same` / `new`), `sameSentence`, `of` (the card), `press`, `words`;
- `press-decision` with the new outcomes `shown-answer`, and `audioLost` / `afterReask` on `sent`.

Ids, codes and counts only.

## Consequences

- New calls read in spoken order. Replies end questions again. A press on finished words never causes unrequested answers with auto-answer off.
- At most one extra request per card. A question that goes on into a new one gets its own saved answer, which the AI notes see.
- Lost audio no longer blocks a press. Each answer card can carry a small "audio lost" line, on the call window and the overlay.
- Keyterm lists can be twice as long. Keyterm prompting was already on, priced per channel-hour in investigation C3. The user's first name goes to Deepgram as a keyterm (`redact_usage` keeps keyterms out of its usage records).
- Web only. The desktop app picks it up on reload; no desktop release.

## Alternatives considered

- **Keep re-asking in place, store earlier answers in a card history:** more UI for the same outcome. D2 chose a new card.
- **Never re-ask with auto-answer off (D1 b):** loses the completion of a grey press, the case the re-ask exists for.
- **Estimate old calls' Them starts from text length (D5):** a guess. Left as is.

## Validation

- **Unit tests:**
  - `deepgram.test.ts` (start sources, numeric strings);
  - `flux-replay-2026-11-14.test.ts` (the call's line times: Them / You / Them, no joins across replies, every reply counts; and P1-D with the recorded starts);
  - `newestQuestion.test.ts` (anchor, once, the 2.5 s rule, D1 with auto on and off, same sentence, gap answers, press after a re-ask);
  - `merge.test.ts`, `keyterms.test.ts`, `cloudStt.test.ts` (trace).
- **Simulated calls (f, g)** in `sim-calls.spec.ts`:
  - auto off: no re-ask of a finished press, a press answers the new question on its own card, and a grey press is asked again once in place;
  - auto on: a re-ask that adds a question gets a new card, both saved, the second linked.
- **Manual (next test call, Timing trace on):** the investigation's manual tests for issues 1–7.

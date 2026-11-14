# Test call of 14 Nov 2026: seven reported issues

- **Date:** 14 Nov 2026
- **Scope:** investigation and fix plan only. No product code, migrations, deploys or commits.
- **Versions:** web = production at the time of the call (main at `8247733`, Batches A–C live); desktop app on this machine; cloud transcription (Deepgram) on for the account.
- **The call:** started 14:47, 329 s long. The Claude voice agent read the interview script **twice**: it restarted at 02:27. Screen recording ran from 02:50 to 05:29. Times below are call time (mm:ss or seconds from the call's start).

## How to read this

- **CONFIRMED** means the code makes it certain and this call's records show it.
- **NOT A BUG** means it works as designed; a change may still be worth making.
- **NOT REPRODUCED** means the records don't show it; the doc says what would.
- Code references are `path:line` at `8247733` (paths under `apps/web/src/` unless stated).
- No ids, emails, secrets or document text appear here. Transcript quotes are a few words each, only where a comparison needs them.

## Evidence used

| Source | What it gave | Privacy |
|---|---|---|
| A **copy** of the desktop profile's IndexedDB (account cache) and localStorage, read in a scratch Electron window whose network was replaced by a blank local page (no production code ran) | the call record, its 41 saved lines, its 5 saved answers, the AI notes' question list, the Drive job (5 files), the recording record, the auto-answer settings | read locally; only counts, times and states appear here |
| The same copy's `kite.callTimings` (call timing log) | every answer request: trigger (`hotkey`, `rerun`, `auto`…), asked/sent/first-word/done times, line ids, word counts, request bytes, tokens; every line's start/end/partial/final times | ids and times only |
| The real `transcriptText()`, `buildKeyterms()`, `isBlip()`, `lineKind()` run locally (tsx) on that copy | the TXT exactly as Drive got it; the keyterm list this session sends (count and membership only); how the rules classify a few phrases | output kept in the scratchpad, not in the repo |
| Code reading | mechanisms, `file:line` | — |

**Not available:** a `docs/testing/calls/2026-11-14/` timing trace (the folder does not exist). "Timing trace" (`kite.trace`) was **off** for this call, so the socket, keyterm, configure and press-decision events were not recorded. The Drive TXT/PDF themselves are in the company Drive, which this machine's Drive connector cannot read; I rebuilt them from the same local data with the same code instead. Vercel CLI was not signed in, so production env values (model overrides) were not checked.

---

## Summary

| # | Issue | Verdict | Root cause in one line |
|---|---|---|---|
| 1 | Answers generated with auto-answer OFF | **CONFIRMED** (but not auto-answer) | All 18 unrequested answers are rule-6 **re-asks** of a press (`trigger: rerun`), which run with auto-answer off by design. They chained for minutes because of the timestamp bug in R1. |
| 2 | Answers missing from transcript / empty entries | **CONFIRMED** (missing) + **NOT A BUG** (empty on session page) | A re-ask reuses its card's id, so each finished answer **overwrote** the previous one: 21 answers streamed onto 5 cards, 5 records saved. On the session page answers are collapsed chips by design. |
| 3 | Answers listed before earlier lines | **CONFIRMED** | Them lines carry the wrong start time (R1), so they sort before the user's earlier lines; each answer is placed right after the Them turn it answered. |
| 4 | Them lines merged across the user's replies | **CONFIRMED** | Not a Flux turn staying open: Flux sent EndOfTurn each time. Our code gives the next Them line the previous turn's end as its start (R1). The merge rule then sees a 0.1 s gap and joins them, skipping the You line in between. |
| 5 | "You" accuracy | **Partly ours, partly the mic/pronunciation** | Both engines missed Freshdesk, Toptal, "Claude drafts", "confidence". Ours alone missed "support" (→ "sport"), the first RAG/Qdrant sentence, Kafka. The name, Freshdesk, Toptal, "support", "copilot" are **not in the keyterms** (40 sent, of a 50 cap). |
| 6 | "Transcript/context full" warning | **NOT REPRODUCED** | No such message exists in the code. Every request in this call succeeded and was small (≤ 14.7 KB, ≤ 977 input tokens of a 100k budget). Likely candidates are listed; the trace was off. |
| 7 | Drive: PDFs only, main video only | Change request | Plan below: web only, no new keys, existing files untouched, no duplicates. |

**R1, the one root cause behind 1, 2, 3 and 4:** a Flux "Them" line's start time is the **start of Flux's audio window**, which is the moment the previous turn ended, not when the first word was spoken (`core/stt/deepgram.ts:232-234`, used at `:257`, `:271-275`). In this call **every** Them line starts 0.1–0.2 s after the previous Them line ended. The opening line (whose first words reached the app at 14.7 s) starts at 0.1 s.

From that one wrong number:

```
Them line start pulled back to the previous turn's end (R1)
 ├─ the new Them stretch is inserted BEFORE the You reply that preceded it (transcript.ts:709)
 │    └─ merge rule sees a 0.1 s gap → joins it onto the previous Them line (merge.ts:78-79)   → issue 4
 ├─ every You line now lies inside a Them line's [start, end] → "started over Them" (reply.ts:33-41)
 │    └─ lastReplyIndex() finds NO reply in the whole call (question.ts:186-203)
 │         └─ rule-6 re-ask never stops; each re-ask moves the window forward (newestQuestion.ts:306-356)  → issue 1
 │              └─ each re-ask reuses the card id → the saved answer is overwritten (useLiveAnswers.ts:884)  → issue 2
 └─ lines sorted by start; answers placed after the Them turn → answers above earlier replies (conversation.ts:59-66, 170-195)  → issue 3
```

---

## 1. Auto-answer OFF, but answers still came

### Verdict

**CONFIRMED** that answers came without a press. **Auto-answer did not cause it:**
- `kite.autoAnswer` is not set (off).
- The session's own `autoAnswer` is `false`.
- No answer in the timing log has `trigger: auto` or `speculative`.

### Evidence (call timing log; ids and times only)

23 answer requests: **5 `hotkey`** (presses) and **18 `rerun`**. Two reruns were cancelled by the next one, so 21 answers finished.

| Card | Press | Re-asks (call time) | Lines in the question | Words sent |
|---|---|---|---|---|
| A | 00:17 | — | 1 | 10 |
| B | 00:27 ("Tell me about yourself") | **10**: 00:40, 00:58, 01:22, 01:34, 01:48, 01:57, 02:11, 02:27, 02:34, 02:35 | 1 → **9** | 11 → **126** |
| C | 03:10 | 1: 03:22 | 1 → 2 | 19 → 36 |
| D | 03:43 | — | 1 | 15 |
| E | 04:10 ("voice agents") | **7**: 04:22, 04:33, 04:34, 04:51, 05:01, 05:09, **05:24** | 1 → 5 | 17 → 88 |

The 05:24 answer to "That's the full script done… should I run it again?" is card E's 7th re-ask. Card B's re-asks carried the whole first run of the script, including the agent's restart ("Hi, Zain… can you hear me okay?"). Each new answer replaced the last on the same card. That is why it looked like auto-answer.

What was ruled out:

| Path | Ran? | Evidence |
|---|---|---|
| Auto-answer (`autoNewestDue` 'answer') | no | needs `enabled` (`core/answer/newestQuestion.ts:358`); `autoOn` = false (`features/live/LiveAnswers.tsx:303`); no `auto` trigger in the log |
| Batch C speculative answer | no | only for a new auto-answer (`features/live/useLiveAnswers.ts:1575`, `:866`); no `speculative` in the log |
| Overlay vs call-page toggle | no | no auto request at all |
| Default after Start again | no | session `autoAnswer: false`, device setting unset |
| **Rule-6 re-ask** | **yes, 18×** | `trigger: rerun`, `rerunOf` = the press's card (`useLiveAnswers.ts:1565-1573`) |

### Root cause

1. Rule 6 (ADR-0076) re-asks a card when the speech it answered "goes on". It runs **with auto-answer off by design**: `useAutoAnswer.ts:85-111` always calls `autoNewestDue`, and rule 6 comes before the `enabled` check (`newestQuestion.ts:335-356`, then `:358`).
2. It is supposed to stop when the user replies (`reaskSpeech`, `newestQuestion.ts:306-314`). Because of R1, every one of the user's 21 saved lines in this call counts as "started over Them" (`core/transcript/reply.ts:33-41`). So `lastReplyIndex()` returns −1 for the whole call (`core/transcript/question.ts:186-203`).
3. Each re-ask updates the "last answered" record with its **own** span (`useLiveAnswers.ts:937-955`). The 2 s window (`REASK_WINDOW_MS`, `newestQuestion.ts:50`) is therefore measured from the newest re-ask, not from the press. With R1, each Them stretch "starts" 0.1 s after the last one ends, always inside 2 s. The chain never breaks.
4. Rule 6 has no "this is a new question" check. The legacy rules had one (`NEW_QUESTION_GAP_MS`, `core/answer/autoAnswer.ts:286`), and `newestQuestion.ts` does not.

Card B paused between 02:35 and the next press only because the agent's next stretch was "Next question." alone, which `isBlip()` treats as listening (checked by running it). That is luck, not a rule.

**Why a non-interview remark was answered:** a re-ask sends any new Them words (rule 4: "a press answers anything new"), with no question filter. Claude typed the remark `behavioural` rather than `none`. That is defensible: "should I run it again, or are you finished?" does ask the user something. The real bug is that it was sent with no press.

### Fix

- **P0-A (R1): Flux line start = first spoken word.**
  - **Change.** In `FluxAssembler` (`core/stt/deepgram.ts:197-282`), set a turn's start to the first message whose transcript is non-empty, or to the StartOfTurn event's position, minus a small lead. Today it is the turn's `audio_window_start`.
  - **Verify first.** Check on a recorded Flux stream whether TurnInfo `words` carry their own times; if they do, use the first word's start. The trace was off for this call, so the lead has to be measured on the fix branch with Timing trace on.
  - **Leave alone.** `tEnd` (last change) is right; leave it. Nova-3 already uses word start times (`deepgram.ts:340`).
  - **Risk and effort.** Medium risk: every Flux line's start moves, and echo and merge windows use starts. Effort M. Web only.
- **P0-B: bound the re-ask** (`core/answer/newestQuestion.ts`, `features/live/useLiveAnswers.ts`):
  1. Anchor rule 6 on the **original** answer's end. A re-ask must not move the anchor: keep `anchorEnd` in the "last answered" record and do not overwrite it at `useLiveAnswers.ts:937-955` when `replaces` is set.
  2. Allow at most one or two re-asks per card.
  3. Bring the legacy "a question of its own after a 2.5 s gap is the next question" rule into `reaskSpeech()`.
  4. With auto-answer **off**, re-ask only when the press answered grey words, the 1.5.2 rule (decision D1).
  - **Risk and effort.** Low risk; effort S–M. Web only.
- P0-A alone restores "a reply ends the question", which stops the chain in this call. P0-B makes it safe even when timestamps are off again.

### Manual test

1. Auto-answer off, Deepgram on. Run the voice-agent script. Press only for questions 1 and 3.
2. **Pass:** the timing log (Settings › call timing log, with "Timing trace" on) shows `hotkey` × 2 and at most one `rerun` per card, and only within ~2 s of the press's question end.
3. **Pass:** no answer appears for questions 2, 4 and onwards, or for the closing remark, without a press.

---

## 2. Answers missing from the transcript; entries with no text

### Verdict

- **CONFIRMED (missing answers).** 21 answers finished; **5 were saved**. All 5 are linked to the call correctly: `callId` and `callStartedAt` match the call. Nothing was lost by linking.
- **NOT A BUG (empty on the session page).** Answer entries there are collapsed chips; the Question/Answer open on click (`features/review/ConversationSection.tsx:236`, `useState(false)`).
- **The TXT does contain them.** I rebuilt the Drive TXT locally with the same code and data. All 5 entries have a Question and an Answer line.
  - Please re-check the Drive TXT. If yours really shows a label with no text, send the file name and I'll look at the upload path.
  - What may read as "no Question/Answer" is that the text doesn't match the question above it. The saved content is the **last re-ask's**: card B shows "Can you hear me okay?" at 02:35, after the whole first run of questions.

### Evidence

| Card | Answers streamed on it | Saved record holds | Lost answers (by question) |
|---|---|---|---|
| A | 1 | the 00:17 answer | — |
| B | 10 (1 press + 9 finished re-asks) | the 02:35 re-ask ("can you hear me") | tell me about yourself, RAG, copilot, voice agents, both "repeat that", Azure/Kafka, baseball (run 1) |
| C | 2 | the 03:22 re-ask (RAG) | the 03:10 answer to "Tell me about yourself" (run 2) |
| D | 1 | the 03:43 answer (copilot) | — |
| E | 7 finished (1 press + 6 re-asks) | the 05:24 re-ask (closing remark) | voice agents, Azure, Kafka, baseball (run 2) |

Knock-on effect: the AI notes list 8 questions, 3 "answered" and **5 "not answered"**. Notes are graded from the saved answers, so questions that were answered on screen are marked "not answered".

### Root cause

- `useLiveAnswers.ts:884`: `id: replaces ?? crypto.randomUUID()`. A re-ask keeps its card's id.
- `toStored()` (`:215-236`) then `saveAnswer()` → `answers.put()` (`core/storage/answers.ts:26-27`) replaces the row.
- This was deliberate in v1.4: one question, one card, for a *completion* of the same sentence. Once re-asks chain across new questions (issue 1), each one destroys a real answer.
- Re-asks get their own timing entry (`answerId~<time>`, `:967`), which is how the log above could count them.

### Fix

- **P0-C: never overwrite a finished answer to a different question.**
  - A re-ask that adds a new question gets a **new** card and record, with `rerunOf` pointing at the first.
  - Replacement in place stays for: the first answer still streaming, or the added words being only the end of the same sentence (no new question by `lineKind`).
  - Files: `features/live/useLiveAnswers.ts` (`ask`, the save at `:1196`), `core/answer/history.ts` (check that `mergeAnswers` does not fold them back into one entry), tests.
  - Low risk, effort S. Web only.
- With P0-A/B the overwrite case becomes rare. P0-C makes sure that when it happens, nothing is lost.
- **P2 (optional): answer chips on the session page.** Open by default, or add a "Show all answers" toggle (`ConversationSection.tsx:236`). Decision D4. Effort S.
- Old calls cannot be repaired: the overwritten answers were never stored.

### Manual test

1. Press once per question for 4 questions, letting the agent move on quickly.
2. **Pass:** after End, the session page and the Drive PDF have 4 "Paramount AI answered" entries. Each opens to the question it answered.
3. **Pass:** the AI notes mark them answered.

---

## 3. Answer entries before earlier lines

### Verdict

**CONFIRMED.** Reproduced exactly by rebuilding the TXT: "answered 00:17" sits above "Me 00:08"; "answered 03:22" sits above "Me 03:12".

### Which time is used

| Item | Time used | Clock |
|---|---|---|
| Line | `tStart` | capture clock (Unix ms) |
| Answer | `createdAt` = `askedAt` = `Date.now()` when the request was sent (`useLiveAnswers.ts:904`, `:230`). For an overwritten card this is the **last re-ask's** send time. | wall clock |
| Order | lines sorted by `tStart` (`core/review/conversation.ts:59-66`). Then each answer goes right after the turn holding its `sourceLineId`, the newest line of its question (`:170-195`, `:236-249`). | — |

### Root cause

R1. The Them line holding "Hi Zain… can you hear me okay?" has `tStart` = 00:00.1, though the words were spoken around 00:12–00:16. It therefore sorts **above** the user's 00:08 line, and its answer (00:17) follows it. The same happens at 03:22: the RAG question's Them line "starts" at 02:58.7, the moment the previous Them turn ended.

The mm:ss on Them turns is wrong for the same reason: "Them 00:00" for words spoken at ~00:12.

The two clocks (capture clock vs wall clock) are not the problem here. The difference is milliseconds, and answer placement uses the source line, not the clock.

### Fix

- **P0-A** fixes it for new calls. No change to `conversation.ts` is needed.
- Saved calls keep their wrong starts: the first-word time was never stored, so they can't be repaired exactly. Decision D5.

### Manual test

1. Run the script; press after each question.
2. **Pass:** in the session page and the PDF, every "Me" turn comes after the question it answers, and every "answered mm:ss" sits under its question and before the next "Me" turn.
3. **Pass:** each Them mm:ss is within ~1 s of when the agent started speaking (check against the recording).

---

## 4. Them lines merged across the user's replies

### Verdict

**CONFIRMED.** Flux did **not** keep a turn open: an EndOfTurn arrived each time the agent paused. **Our merge** joined the next stretch, because R1 gave it a start time inside the previous turn.

### Evidence (timing log; the same line id appearing twice means a merge)

| Them line | 1st stretch | You reply in between | 2nd stretch (as recorded) | Merged? |
|---|---|---|---|---|
| "Tell me about yourself…" | 23.7–26.1 s, final at 26.5 s (EndOfTurn) | 28.6–33.9 s | **26.2**–39.6 s; first words at 35.6 s | yes |
| "Next question, how did you deploy…" | 108.5–117.1 s | 121.9–125.5 s | **117.2**–131.3 s | yes |
| "…AI support co pilot…" | 217.7–221.4, 221.5–222.1 s | 225.4–240.5 s | **222.2**–242.9 s | yes |
| "You've built voice agents…" | 242.9–247.6 s | 254.1–259.3 s | **247.7**–262.2 s | yes |

In all 10 Them merges in the log, the second stretch "starts" 0.1–0.2 s after the first ends. In 8 of them its first words reached the app 6–20 s later. This rules out `eot_timeout_ms` (5 s) and a missing EndOfTurn: each first stretch was finalised 0.3–0.5 s after its last word.

### Root cause

- `FluxAssembler.handle()` opens a turn at the first message of a new `turn_index`, with `start = audio_window_start` (`core/stt/deepgram.ts:232-234`). Flux's next turn window begins where the last one ended, so the turn "starts" during the silence while the user answers.
- `Transcript.addFinal()` inserts lines by start time (`core/transcript/transcript.ts:709`). The stretch lands **before** the You line, so the previous same-speaker line is directly before it (`:715-717`).
- `shouldMerge()` (`core/transcript/merge.ts:78-79`) sees a 0.1 s gap, under `MERGE_GAP_MS` 1.5 s, and joins them.

### Effect on question selection and auto-answer

- **Press:** the answered speech is tracked per segment (ADR-0076 rule 3), so presses still sent the right words. Cards C, D and E's presses all asked one fresh line.
- **Re-ask:** this is what broke. The merged line's span covers the user's reply, so the reply "started over Them" and never ended the question (issue 1).
- **Auto-answer** (when on): the same missing reply means `autoNewestDue` would treat the user's answer as not having happened. A question asked right after a long user answer would still be answered, but the question window would grow across replies.
- **Transcript:** two questions show as one Them paragraph, with the reply below it.

### Fix

- **P0-A** removes the cause.
- **P1-D (guard):** in `shouldMerge()` / `addFinal()`, never join two lines of one speaker when a final line of the **other** speaker (not a blip) ends between them. Belt and braces for any engine whose starts are coarse. Low risk, effort S. Web only.

### Manual test

1. Agent asks Q1, you answer for ~5 s, agent says "Next question. Q2".
2. **Pass:** the transcript shows Them Q1 / You answer / Them Q2 as three paragraphs, in that order, both live and on the session page.

---

## 5. "You" accuracy

### Three-way comparison (short phrases only)

"Ours" is our You channel (Nova-3 on the mic). "Agent" is the voice agent's own transcription of the same speech, through its own audio path.

| Intended | Agent heard | Ours, run 1 | Ours, run 2 | Who erred |
|---|---|---|---|---|
| building **RAG** systems | "rack systems" | "the systems" | "RAG systems" ✓ | both (run 1); agent only (run 2) |
| through **Toptal** | "TopTel" | "Toptel" | — | **both** (name not in keyterms) |
| built **RAG pipelines** | "rack pipelines" | "**bill track by a friend**" | "track pipelines" | both; ours much worse in run 1 |
| **Qdrant** vector search | "quadrant vector searchable" | "**go ahead and** vector search" | "Qdrant" ✓ | both in run 1; agent only in run 2 (keyterm helped) |
| **support** ticket history | "Spot ticket" | "Sport tickets" | "sport ticket" | **both** |
| AI **support** copilot / **support** tickets | "support" ✓ | "**sport**" ×2 | "**sport**" ×2 | **ours only** |
| **Freshdesk** tickets come in | "Fastest tickets" | "fastest tickets" | "**Price's** tickets" | **both** (not in keyterms) |
| **Claude drafts** a reply | "Cloud routes are reply" | "Cloud routes are applied" | "Outrops, I reply" | **both** |
| **confidence** score | "Confluence score" | "Confluence score" | "Confluence score" | **both** (likely how it was said) |
| voice agent with **Deepgram** | ✓ | "the for" (dropped) | ✓ | ours only, run 1 |
| haven't used **Kafka** | ✓ | "**had you done** Kafka" | — | ours only (Kafka not in CV or keyterms) |
| Them: "Hi **Zain**" | (agent's own words) | "zone" | "Zone" | ours (name not in keyterms) |

**Errors both engines made** were Toptal, Freshdesk, "Claude drafts", confidence → "Confluence", and "rack" for RAG. Two different engines on two audio paths made the same errors, which points at **mic and pronunciation**, plus these words not being boosted.

**Errors only ours made:**
- "support" → "sport", four times;
- the whole first RAG sentence;
- the Kafka sentence;
- dropping "Deepgram" once.

Run 2 was clearly better than run 1 on terms in the keyterm list (RAG, Qdrant, Deepgram all right). That suggests the keyterms reached Nova-3. It is **SUSPECTED, not proven**: the trace that records `socket-open optional=true` and `configure terms=N` was off.

### Keyterms actually built for this session (counts only)

Rebuilt with the real `buildKeyterms()` (`core/stt/sessionHotwords.ts:337-368`) on the copied session.

- **What was sent: 40 terms** (cap 50, `:305`), the same list on both sockets (`core/stt/deepgram.ts:99-103`). It is made of the company, the role, the 13-word interview vocabulary, and terms found in the CV. The session's own **key-terms field is empty**.
- **In the list:** RAG, LLM, Qdrant, Claude, Deepgram, Confluence, Jira, Azure, Kubernetes.
- **Not in the list:**
  - **The user's name.** It is not a source at all; the account name and the other person's name are never added.
  - **Freshdesk and Toptal.** Each appears twice in the CV, but in different capitalised runs (alone, after another capitalised word, or at a sentence start). `extractDocumentTerms()` counts **exact runs**, needs 2 of the same run (`MIN_DOCUMENT_MENTIONS`), and holds sentence-start runs back (`:170-215`).
  - **"support" and "copilot".** Ordinary words; never picked.
  - **Kafka.** Not in the CV.
- **Was the retry without keyterms used?**
  - **How it works.** The fallback opens a socket without keyterms after a failed handshake (`core/stt/cloudStt.ts:341-372`), and then also skips Configure (`:721-723`).
  - **What the records show.** Not recorded (trace off).
  - **Indirect evidence.** Run 2's correct "Qdrant" and "Deepgram" on the You channel suggest the Nova-3 socket **did** open with keyterms.

### What is achievable

| Lever | Expected effect | Effort |
|---|---|---|
| **Today, no code:** type the missing terms into the session's Key terms (your first name, Toptal, Freshdesk, Qdrant, support copilot, Claude drafts) | Highest priority in the list; reaches both sockets at the next call (or mid-call via Configure) | none |
| **P1-F:** add the account's first name and the session's contact name to the keyterms. Count single capitalised words across runs (so Freshdesk/Toptal qualify). Allow up to ~100 terms (Deepgram's documented limit; the code comment says 100). Show the list on the session page ("Words Paramount AI listens for") | Fixes "Zain → zone", Freshdesk, Toptal; lets the user see gaps | S–M, web only |
| Mic: a headset or close mic, not the laptop mic; speak brand names slowly | Addresses the errors **both** engines made | user |
| Model: Nova-3 is already the You model (`server/deepgram.ts:23`). Flux is English-only and tuned for turn-taking, not accuracy. No model change is likely to fix "Freshdesk" without the keyterm | — | — |
| Answers are already robust: the prompt tells Claude to map misheard words to session terms (`server/prompt.ts:116-118`). This call's saved answers spell Freshdesk and Qdrant correctly | Transcript readability and notes are the real cost | — |

### Manual test

1. Add the key terms above. Turn Timing trace on. Repeat the run.
2. **Pass:** the trace shows `socket-open optional=true` on both channels, and `configure terms=N` if edited mid-call.
3. **Pass:** "Zain", Toptal, Freshdesk and "support" appear correctly in most lines.

---

## 6. A warning in the answer window ("transcript/context full, the new question wasn't captured")

### Verdict

**NOT REPRODUCED.**
- **No message like this exists.** I searched every user-facing string in the web app (`full`, `limit`, `truncat`, `too long`, `context`, `captured`, `cut off`). None says the transcript or context is full.
- **No request failed.** All 23 requests in this call either finished `done` or were cancelled by the next re-ask.
- **Nothing came near a cap.**

| Possible cap | Limit | This call |
|---|---|---|
| Request body (`MAX_REQUEST_BYTES`, `server/validate.ts`) | — | largest 14.7 KB |
| Input tokens (`MAX_ANSWER_INPUT_TOKENS`, `packages/shared`) | 100,000 | max 977 uncached + ~8.6k cached |
| Conversation tokens / chunks (`MAX_CONVERSATION_TOKENS` 40k / 300) | — | far below |
| Question words (`MAX_NEWEST_WORDS`, `newestQuestion.ts:56`) | 200 | max 126 |
| Document parts per question (P2-1, `core/documents/chunks.ts`) | 3–5 | 0: the CV is the only document and goes in the cached prefix, as designed |

In a 5-minute call none of these should ever trigger.

### What it most likely was (closest real messages)

| Message (`features/live/useLiveAnswers.ts`) | When | Fits? |
|---|---|---|
| `GAP_NOTICE` (`:125`): "Part of their audio was lost, so the question may be missing…" | a press with nothing new except lost-audio marks (`:1286`) | wording fits best. Saved data can't show whether an `[audio gap]` line appeared. |
| `SHOWING_EARLIER_NOTICE` (`:115`): "Showing the earlier answer — nothing new was asked since." | a press after a **re-ask had already absorbed** the new question. The re-ask moves `answeredEnd` forward (`:928`), so the press finds nothing new (`:1282`). | **very plausible here.** Cards B and E's re-asks swallowed questions the user may then have pressed for. |
| Claude's own `unclear` headline (a clarifying question) | a re-ask sending 100+ words holding several questions | possible; the text was overwritten (issue 2) |

### Fix (whichever it was, a press must never be blocked)

- **P1-G** (`features/live/useLiveAnswers.ts` `decideNewest`, `core/answer/newestQuestion.ts` `chooseNewest`):
  - A press after a re-ask that covered new speech **answers that speech on its own card**, never "Showing the earlier answer". P0-B/P0-C make that card exist.
  - On `gap`: send the newest words before and after the gap, and show "Part of their audio was lost" as a small line on the card, not instead of it.
  - A press must always end in an answer when there are Them words since the user's **last press**.
- Low risk, effort S. Web only.
- To pin it down: next test call with **Timing trace on**. The `press-decision` events record `shown-existing`, `gap` or `nothing-new` for every press. A screenshot of the message helps too.

### Manual test

1. Auto-answer off. Let the agent ask two questions back to back without pressing, then press.
2. **Pass:** you get an answer to the newest question. No notice-only outcome.
3. Repeat after unplugging the network for 2 s mid-question. **Pass:** an answer, with the lost-audio line on the card.

---

## 7. Drive: PDFs only, main video only

### What happens today

This call uploaded 5 files:
- Transcript.txt, Transcript.pdf, Notes.pdf;
- Part 1.mkv (main);
- Part 1 stereo.webm.

Where the TXT and the stereo file come from:

| Piece | File:line |
|---|---|
| TXT built (two builders: per call, and per session view) | `core/drive/callFiles.ts:145-160`, `:189-205` |
| File order | `core/drive/callUploader.ts:42` (`CALL_FILE_ORDER`) |
| Stereo listed (two builders) | `core/drive/callUploader.ts:194-207`; `core/drive/uploader.ts:273-281` |
| Stereo reported as expected | `core/drive/runner.ts:98` (`stereo: item.hasStereo`) |
| Server waits for stereo before the email | `server/google/report.ts:262-276` (`missingRecordingFiles`) |
| Email labels | `server/google/email.ts:96-116` |
| Server accepts the keys | `server/google/api.ts:802` (`rec:…:(main|stereo)`), `:957` (`call:…:(transcript-txt|…)`) |
| Desktop upload | `apps/desktop/src/drive/upload.ts:121` accepts both tracks; **no change needed** |

### Plan (P2-H; web only, one deploy)

1. **Stop making the TXT.**
   - Drop `transcript-txt` from both builders in `callFiles.ts` and from `CALL_FILE_ORDER`.
   - Keep the `CallFileKind` value and the server's key regex, so older open pages and old records still validate.
2. **Stop listing the stereo file.** Remove the stereo entry in `callUploader.ts` and `uploader.ts`.
3. **Expect only the main file:**
   - client: `runner.ts` reports `stereo: false`;
   - server: `report.ts` expects only `main`.

   The server change means an older open page (not yet reloaded) that still reports stereo can't hold the email back.
4. **Jobs already queued.** When a job is loaded, drop its **not-yet-sent** `transcript-txt` and `stereo` entries. Done entries are kept as they are.
5. **Emails.** The email lists only what was saved, so new emails show Recording + Transcript (PDF) + Notes (PDF). Keep the `stereo` and `transcript-txt` labels in `email.ts` for emails about older calls.

**Existing files untouched:** nothing is deleted from Drive or from the device. Calls already saved keep their TXT and stereo files.

**No duplicates:** the PDF and main-video keys don't change (`call:<start>:transcript-pdf`, `call:<start>:notes-pdf`, `rec:<id>:main`). Every builder adds by key, so nothing already uploaded is uploaded again, and "Upload to Drive" for an old session (`backfill.ts` / `earlierCalls.ts`) just stops adding TXT and stereo.

**The stereo file on this computer:** it is still recorded when the session saves its transcript (`features/live/useCallRecording.ts:213`; `core/recording/recorder.ts`). Decision D3.

Risk low, effort S–M. Tests to update: callUploader, uploader, callFiles, report and email.

Add a short ADR, because ADR-0072's file set changes. Update the user guide's Drive section to match.

### Manual test

1. Record a 1-minute call with transcript saving on; End.
2. **Pass:** the call's Drive folder holds exactly Transcript.pdf, Notes.pdf and Part 1.mkv.
3. **Pass:** the email arrives (not held), listing those three.
4. **Pass:** an older call's folder still has its TXT and stereo files.
5. **Pass:** pressing "Upload to Drive" on an older session uploads nothing twice.

---

## Prioritised fix list

| Pri | Fix | Fixes | Files | Risk | Effort | Where |
|---|---|---|---|---|---|---|
| **P0-A** | Flux line start = first spoken word | 1, 3, 4 (root) | `core/stt/deepgram.ts` (+ tests, including a replay of this call's line times, with ids and times only) | medium | M | web |
| **P0-B** | Bound the rule-6 re-ask: anchor on the original answer, at most 1–2, "new question after a gap" rule, auto-off behaviour per D1 | 1 | `core/answer/newestQuestion.ts`, `features/live/useLiveAnswers.ts` | low | S–M | web |
| **P0-C** | Never overwrite a finished answer to a different question | 2 | `features/live/useLiveAnswers.ts`, `core/answer/history.ts` | low | S | web |
| P1-G | A press always answers; gap and "earlier answer" become notes on a card, not instead of one | 6 | `features/live/useLiveAnswers.ts`, `core/answer/newestQuestion.ts` | low | S | web |
| P1-D | Merge guard: never join across the other speaker's line | 4 | `core/transcript/merge.ts`, `transcript.ts` | low | S | web |
| P1-F | Keyterms: name, contact name, single capitalised words, up to ~100, visible list | 5 | `core/stt/sessionHotwords.ts`, `features/live/LiveSession.tsx`, session page | low | S–M | web |
| P2-H | Drive: PDFs only, main video only | 7 | see §7 | low | S–M | web |
| P2 | Session page: answers open by default or a toggle | 2 (UX) | `features/review/ConversationSection.tsx` | low | S | web |

All fixes are web-only (Vercel deploy). The desktop app picks them up on reload; no desktop release is needed.

**Before the fix branch's test call:** turn on "Timing trace" (Settings, call timing log section), so the next call records socket, keyterm and press-decision events. Also save the call's data copy (ids and times only) to a dated folder under `docs/testing/calls/`.

## Decisions needed from you

- **D1. Re-ask with auto-answer off.**
  - Option (a), **recommended**: re-ask only when your press answered words still being spoken (grey), once.
  - Option (b): never re-ask when auto-answer is off.
  - Option (c): keep re-asking for any press, bounded by P0-B.
- **D2. When a re-ask adds a new question:** a new card (recommended), or replace in place while keeping the old answer in the card's history?
- **D3. The stereo file.**
  - Option (a), **recommended**: keep recording it on this computer but don't upload it. Nothing uses it on Drive; locally it is a clean source for re-transcription.
  - Option (b): stop recording it, which saves some CPU during recording.
- **D4. Answers on the session page:** open by default, or collapsed with a "Show all answers" toggle?
- **D5. Old calls:** leave their order as is (recommended; the first-word times were never stored), or add a "re-sort" that guesses Them start times from text length?
- **D6. Issue 6:** please send the exact wording or a screenshot if it appears again; with Timing trace on, I can name the path.

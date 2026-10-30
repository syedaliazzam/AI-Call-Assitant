# ADR-0025: Answers see the whole call and earlier answers, through an append-only cached conversation

- **Status:** Accepted
- **Date:** 2026-10-30 (Day 4)
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` (version 3.4.0) §6.1 (flow), §6.2 (latency), §6.3 (prompt caching), §7.2 (request and prompt), §7.4 (answers), §7.6 (learning loop), §11 (testing)
- **Supersedes / superseded by:** none. It replaces the "last ~3 minutes of transcript" request of architecture 3.3.0 §6.1.

## Context

During a call the user presses Answer and needs a short, correct answer within about a second. Day 3 sent the session details (cached) and a 3-minute transcript window with the question (uncached). That leaves two problems.

- **Consistency.** Questions build on each other ("and the second phase of that?"), the same question comes back minutes later, and new information can change an earlier answer. Claude can do this only if it sees what was said and what Kite already answered in this call. A 3-minute window loses both.
- **Speed and cost.** Sending the whole call on every request is only fast and cheap if it is cached. Claude's prompt cache matches the start of the prompt byte for byte. So the conversation must only ever grow at the end, and nothing already sent may change.

The official prompt-caching docs add two rules that shape the design:
- A cache read can land only at a position where an earlier request put a breakpoint.
- Each breakpoint looks back at most 20 blocks for an earlier entry.

A conversation sent as one text block that grows would therefore never read its own cache: the previous request's breakpoint would sit in the middle of the new, longer block. A request may carry at most 4 breakpoints.

## Decision

1. **The request carries the whole call** (`AnswerRequest.conversation` and `tail`; `transcript` removed):
   - **Conversation:** stable lines and the answers already given in this call, in time order, each with its time since Connect.
   - **Tail:** the lines that may still change.
2. **Stable lines** (`core/transcript/stability.ts`):
   - A line is stable when it is final, not an echo, at least 5 s old, and no line still being heard could merge into it or mark it as an echo.
   - Everything else goes in the uncached tail.
   - The thresholds come from the merge gap (1.5 s) and the echo window (2 s).
3. **Append-only chunks** (`core/answer/context.ts`):
   - Each request adds at most one new chunk: the lines that became stable and the answers that finished since the last request.
   - A chunk never changes once sent. A sent line that still grows later is continued with only its new words.
   - The server writes **one text block per chunk** and puts the breakpoint on the last chunk only. Request N+1 then starts with request N's blocks byte for byte, and its read lands on request N's breakpoint one block back, well inside the 20-block lookback.
4. **Three breakpoints**, within Anthropic's limit of 4:
   - the rules block;
   - the session block;
   - the last conversation chunk.

   With the Day 4 rules, the rules block (about 836 tokens) is itself above the 512-token minimum, so it is cached once and shared by every session.
5. **Consistency rules** in the system block:
   - "Earlier answers in this call are shown in the conversation. Stay consistent with them. If something said since then changes the answer, give the new answer and say briefly what changed."
   - "If the same question is asked again, build on the earlier answer instead of starting over."
6. **Long-call cap** (`server/prompt.ts` `capConversation()`):
   - Keep about 20,000 estimated tokens (characters ÷ 4), about 90 minutes of speech.
   - Above that, drop the oldest whole chunks in **steps of 5,000 tokens** and say "[Earlier part of the call omitted]".
   - The cut moves only when the excess crosses another step, so between steps the cached start is unchanged.
   - The rule depends only on the request, so the server needs no state.
7. **Keeping the cache warm:**
   - a warm-up when the live page opens, and again on Connect;
   - the **idle re-warm**: during a call, after 4.5 minutes with no warm-up or answer, one warm-up with the conversation chunks sent so far. It stops at End.
8. **Evaluation set** (`apps/web/tests/eval/`, `scripts/eval-answers.ts`, `docs/testing/answer-eval.md`):
   - 15 invented scenarios, answered through the real server prompt by Haiku and graded by Sonnet against a written rubric, plus two code checks.
   - A prompt change is kept only if the overall score rises and no scenario drops by more than one point.
9. **Learning loop** (§7.6):
   - Every answer is saved locally with a rating and a note (Day 4).
   - Day 5 turns them into proposed lessons, which the user approves, edits or rejects.
   - Approved lessons go into the system block's "Learned preferences" slot.
   - Nothing is learned without the user's approval, and nothing leaves the laptop except inside an answer request.

## Consequences

**Positive:**
- **Consistency.** Answers stay consistent and build on earlier ones. The evaluation's follow-up, repeat-question and changed-information scenarios score 9–10 / 10.
- **Cache reuse.** Each answer reads everything sent before it and writes only the new chunk. Measured against the real API (`verify:answer-cache`): reads 4,833 → 4,954 → 5,220, each the previous read plus the previous write. In production, 20 of 20 answers read the cache.
- **Speed.** Long calls stay fast, because only the new part of the prompt is processed.

**Negative:**
- **Timeline order.** A line that becomes stable after a later answer appears after it in the timeline, with its own correct time.
- **The last ~5 s.** The newest few seconds are always uncached (the tail). That is small: about 65 tokens of uncached input per answer, measured.
- **Cap.** At each step of the long-call cap the conversation is written to the cache once again.
- **More text sent.** More call text goes to Claude per request than with a 3-minute window. This is the same data class as before (§8.1); nothing is stored by the server.
- **Latency from far away.** The first-word target (≤ 1.0 s p50) is met on the server side (560–643 ms) but not end to end from South Asia (1,076–1,155 ms, about 500 ms of network to `iad1`). See §13. **Accepted for v1** (Day 5): about 1.1 s from Pakistan is still well below the 2–4 s reported for ParakeetAI. The session cookie cache (Day 5, ADR-0022) removes the per-answer database lookup.

## Alternatives considered

- **Keep the 3-minute window.** Loses earlier answers and the start of the call, so consistency fails. Rejected.
- **One growing conversation block.** Never reads its own cache (reads land only at earlier breakpoints). Rejected.
- **A breakpoint on every chunk.** More than 4 breakpoints is not allowed. Rejected.
- **One block per line.** Fails once more than 20 lines arrive between two answers, because the 20-block lookback is passed. Rejected.
- **Summarise old parts of the call.** Changes the cached prefix on every summary and can lose facts. Kept in the backlog.
- **Drop the oldest line at a time over the cap.** Changes the start on every request, so the conversation is never cached after the cap. Rejected for the stepped cut.

## Validation

- **Unit:**
  - the prefix-growth test: request N+1's cached part starts with exactly request N's;
  - byte stability;
  - the cap steps;
  - the breakpoint count;
  - two consecutive builder requests through the real prompt;
  - stable lines and question selection on invented transcripts.
- **Real API:** `pnpm --filter web verify:answer-cache` PASS (above).
- **Harness (CI):** append-only requests between two real answers in the answer UI.
- **Production:**
  - the e2e suites read the cache on every answer;
  - `/dev/latency` gives 20/20 cache hits per platform.
- **Evaluation:** baseline 9.17 / 10 (12 scenarios) → final 9.43 / 10 (15 scenarios), every round recorded.

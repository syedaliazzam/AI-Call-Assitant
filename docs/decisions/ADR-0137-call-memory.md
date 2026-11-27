# ADR-0137: Call memory: a running summary of the whole call

- **Status:** Accepted (released 28 Nov 2026)
- **Date:** 2026-11-28
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` (4.70.0) §6.1
- **Supersedes / superseded by:** none

## Context

The developer asked that answers can use anything said earlier in the call. The prompt already keeps the conversation word for word up to about 20,000 tokens (about 90 minutes; the 32-minute 27 Nov call was in it whole), and drops older parts beyond that.

## Decision

- `POST /api/memory` (`server/callMemory.ts`): the fast model updates a short memory (Key points, Questions asked (answered/open), What the user said, Open items; under 300 words) from the memory so far and the lines since. Not counted in the daily limit; logs sizes and timings only.
- The device asks for it in the background (`core/answer/callMemory.ts`): after 250 new words, or 30 after 4 minutes; never at a key press; kept for the call only, never stored.
- Every answer sends it (`AnswerRequest.memory`, at most 2,400 characters) in the uncached tail before the newest lines; the word-for-word conversation is still sent.

## Consequences

- Cost: about one fast-model request per 2–4 minutes of talk, roughly $0.006 per call-hour.
- Latency: a few hundred uncached tail tokens per answer; the press never waits for it.

## Validation

Unit tests (`callMemory.test.ts` ×2, `prompt-press.test.ts`); key-press case "something said 20 minutes ago" passed before and after.

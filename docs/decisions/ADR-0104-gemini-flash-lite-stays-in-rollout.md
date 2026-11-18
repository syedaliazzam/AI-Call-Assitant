# ADR-0104: Gemini 3.5 Flash Lite stays in the rollout, Gemini 3.6 Flash is retired, and the GPT warm-up is fixed

- **Status:** Accepted (18 Nov 2026, the developer's decision on the measurement)
- **Date:** 2026-11-18
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §7.2 (version 4.43.0)
- **Supersedes / superseded by:** changes ADR-0099's model list (Gemini 3.6 Flash removed) and its GPT warm-up; keeps ADR-0102's rollout (Gemini only for the accounts in `KITE_ANSWER_MODELS_USERS`)

## Context

ADR-0102 kept Gemini limited because its key was on Google's free tier. The team then moved the key's Google project to the paid tier (prepaid credits). Before opening Gemini to every account, the developer had both Gemini models measured against Claude Haiku 5.5 and GPT-5.6 Luna, all with the default Live answers prompt version 5 (ADR-0103). The rule for opening a Gemini model to everyone was:
- a score at or above 8.86;
- scenario 08 inventing nothing;
- the hidden line first in at least 29 of 30 replies;
- no placeholder;
- no 429s;
- a first-word median no slower than Luna's.

The measurements are recorded in `docs/testing/benchmark-results.md` and `docs/testing/answer-eval.md` (18 Nov 2026).

| | Claude Haiku 5.5 | GPT-5.6 Luna | Gemini 3.5 Flash Lite | Gemini 3.6 Flash |
|---|---|---|---|---|
| `answers` score | 9.37 (ADR-0103) | 9.13 | 8.97 | 9.00 |
| Hidden line first | 30/30 | 30/30 | 30/30 | **28/30** |
| Placeholder copied | 0 | 0 | 0 | **2** |
| First answer word p50 / p95 (ms) | 903 / 1,065 | 1,190 / 1,971 | **1,504** / 1,881 | **1,470** / 1,945 |
| Over the 4 s fallback limit | 0/20 | 0/20 | 0/20 | 1/20 (12.9 s) |
| Prompt cache reads | 20/20 | 20/20 | 0/20 | 1/20 |
| Cost per answer | $0.00022 | $0.00030 | $0.0021 | $0.0050 ($0.0100 from 1 Jan 2027) |
| 429s | 0 | 0 | 0 (one 503) | 0 |

- **The paid tier works.** 30 short requests in a minute to each Gemini model were all answered (HTTP 200). There was no 429 in about 230 Gemini requests. No rate-limit headers are sent; the responses carry `x-gemini-service-tier: standard`.
- **Both Gemini models fail the rule.** Their first word is about 300 ms slower than Luna's and 600 ms slower than Haiku's. Gemini's implicit cache almost never hit, so every answer read the whole prompt again. Gemini 3.6 Flash also broke the hidden line and copied the placeholder, and its answers had more invented details (the grader found some in 13 of 30).
- **The GPT warm-up failed in every call.** `warmOpenAI()` asked for one output token. GPT-5.6 Luna refuses a limit of 1 or 2 with HTTP 400 ("Could not finish the message because max_tokens or model output limit was reached"), streamed or not, and accepts 4 and above. The route caught the failure, so it was invisible to the user. The prompt was still cached: the first answer read the warm-up's prefix. But each warm-up was logged as failed (`answer: provider warm`, `ok: false`) and returned Claude's usage instead of GPT's.

## Decision

1. **Gemini 3.5 Flash Lite** stays offered only to the accounts in `KITE_ANSWER_MODELS_USERS`, as in ADR-0102. Its row and words are unchanged.
2. **Gemini 3.6 Flash is retired:**
   - `RETIRED_ANSWER_MODELS` and `isRetiredModel()` are added in `packages/shared`.
   - It is removed from the model list (overlay chip and ⋮ Model row, AI preferences, Settings defaults).
   - `modelOff()` reports it off, so a running call shows Claude Haiku.
   - A stored session or default set to it moves to Claude Haiku: on the dashboard, `moveOffUnavailableModels()`, which was `moveOffGroq()`, and during a call, `mustMoveToHaiku()` in `LiveAnswers.tsx`.
   - The server answers any request for it with Claude Haiku (`allowedModel()`), whatever the switches say.
   - The value `gemini-flash` stays a known answer model, so older or synced data still reads.
   - `eval-answers --model=gemini-flash` still works, to measure it again later.
3. **Claude Haiku stays the default** for every new session. No model replaces it: Haiku had the quickest first word, the lowest cost and the highest score.
4. **The GPT warm-up asks for a few tokens:** `OPENAI_WARM_MAX_TOKENS = 16` in `server/openai.ts`, which is about $0.00002 of output per warm-up. The route's fallback is unchanged.
5. **"Recommended" moves to Claude Haiku** (the developer's decision, 18 Nov 2026, after the measurement). The lists read "Claude Haiku (Recommended)" and "Gemini 3.5 Flash Lite" with no tag. The names, the order and the chip are unchanged.

## Consequences

- Sessions of rollout accounts that were set to Gemini 3.6 Flash now answer with Claude Haiku, and show and store it.
- A GPT session's warm-up now succeeds and reports GPT's own usage. The first answer's cache reads are as before (measured: 5,624–5,626 of about 6,240 input tokens, both with the failed and with the fixed warm-up; 0 without any warm-up).
- Gemini 3.5 Flash Lite, where used, costs about ten times Claude Haiku per answer while its cache does not hit.
- The "Recommended" tag moved from Gemini 3.5 Flash Lite (ADR-0099's candidate) to Claude Haiku, by the developer's decision the same day (Decision 5).

## Alternatives considered

- **Open Gemini 3.5 Flash Lite to everyone:** quality, rate limits and data terms are now fine, but it is slower than Luna and about ten times Haiku's cost. Rejected for now.
- **Explicit Gemini caches** to fix the cost and speed: rejected in ADR-0099 (a create and delete per call, billed per hour of storage). Not re-measured.
- **Remove `gemini-flash` from the shared type:** older and synced sessions would then not read as a known model. Rejected: it is kept and mapped to Haiku.
- **Abort a streamed warm-up after its first token:** loses the usage that shows the cache. Rejected for a small token limit.

## Validation

- **Unit tests:**
  - the lists without Gemini 3.6 Flash, its name (Claude Haiku) and that it is always off;
  - `allowedModel()` mapping it to Claude Haiku with every switch on;
  - the route answering a `gemini-flash` request with Claude Haiku;
  - moving sessions and defaults off it (`moveOffUnavailableModels()`, `mustMoveToHaiku()`);
  - the warm-up's token limit (never 1 or 2).
- **Measurements:** `docs/testing/benchmark-results.md` (Gemini on the paid tier; GPT warm-up before and after) and `docs/testing/answer-eval.md` (the four models on prompt version 5).

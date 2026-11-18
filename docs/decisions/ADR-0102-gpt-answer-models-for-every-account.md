# ADR-0102: The GPT answer models for every account

- **Status:** Accepted
- **Date:** 2026-11-18
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §7.2, §10.1 (version 4.41.0)
- **Supersedes / superseded by:** changes ADR-0099's rollout: `KITE_ANSWER_MODELS_USERS` now limits only the Gemini models.

## Context

ADR-0099 added Google's Gemini and OpenAI's GPT models as answer models, offered only to the accounts in `KITE_ANSWER_MODELS_USERS`. In practice that was the developer's account only. The developer now wants the GPT models (GPT-5.6 Luna and GPT-5.6 Terra) offered to every account. Gemini stays limited: its key is on Google's free tier, which has low rate limits and may use the prompts to improve Google's products. The privacy page already lists OpenAI as an answer provider (ADR-0099).

## Decision

1. **Server.** `getProviderEnabled('openai', …)` no longer checks the rollout list. OpenAI is on for an account when `OPENAI_API_KEY` is set and the admin's "Allow OpenAI (GPT) models" switch is on. Gemini still also needs the account in `KITE_ANSWER_MODELS_USERS`.
2. **`GET /api/models`.** Every account now gets `openai`. Only an account in the Gemini rollout also gets `moreModels: true` and `gemini`. `moreModels` now means "show the Gemini rows".
3. **One list, one set of words.** The classic list (Fast (Claude Haiku), Smart (Claude Sonnet), Fastest (Groq)) is removed. Every account sees ADR-0099's list in the developer's order and words. The Gemini rows are left out for accounts outside the rollout:
   - **Outside the rollout:** GPT-5.6 Luna (Fast), GPT-5.6 Terra, Claude Haiku, Claude Sonnet, Groq (Fastest).
   - **In the rollout:** Gemini 3.5 Flash Lite (Recommended), GPT-5.6 Luna (Fast), Gemini 3.6 Flash, GPT-5.6 Terra, Claude Haiku, Claude Sonnet, Groq (Fastest).

   The chip's short names are Luna, Terra, Haiku, Sonnet and Groq for everyone. Toasts read "<name> on" and "<name> is turned off by your admin". A single naming means a GPT model is never shown next to a Claude model called "Fast".
4. **Unchanged:**
   - Claude Haiku is the default for every new session.
   - An OpenAI error, or no first token within 4 s, moves the answer to Claude Haiku. This is recorded in the call trace and the server log.
   - Luna sends `reasoning_effort: 'none'`.
   - Each user may make 300 requests a day.
   - Ask AI and AI notes always use Claude.
   - The admin's per-provider switches still apply.

## What the user sees when the OpenAI key has no credit

OpenAI refuses the request with an HTTP error (429, `insufficient_quota`) before any text arrives. `streamOpenAIReply()` throws `ProviderError('http', 429)`, and the answer route moves the answer to Claude Haiku at once, without waiting for the 4 s first-token limit. The user gets a normal answer from Claude Haiku with no error message. The chip still says the GPT model. The server logs `answer: openai fallback to haiku` with `status: 429`, and the call's timing trace records `gpt-luna-fallback-error`. Each answer still tries OpenAI first, so every answer pays one failed OpenAI round trip (typically well under a second) before Haiku starts. The admin can turn "Allow OpenAI (GPT) models" off to stop this. Sessions then answer with Haiku directly.

## Consequences

- Every account's model list changes (new names, two GPT rows). Existing sessions keep their stored model (`fast`, `smart` or `groq`), so nothing changes until someone picks a GPT model.
- OpenAI spend now depends on every account's choice. It is billed to the OpenAI key, not the Claude Console budget. The admin can watch it in Admin → Usage ("OpenAI today / 7 days") and turn it off with the switch.
- When Gemini moves to a paid tier, removing the remaining check in `getProviderEnabled()` (or setting `KITE_ANSWER_MODELS_USERS=*`) offers it to everyone.

## Verification

Unit tests cover the server rule (OpenAI outside the rollout, Gemini not), the `GET /api/models` body for both kinds of account, a GPT session of an account outside the rollout answering with GPT, and the lists, names and toasts. In production a new non-admin account outside the rollout asked one question with GPT-5.6 Luna. The results are in `docs/testing/benchmark-results.md`.

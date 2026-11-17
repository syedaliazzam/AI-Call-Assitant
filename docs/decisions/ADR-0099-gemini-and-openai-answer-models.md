# ADR-0099: Google Gemini and OpenAI as answer models, measured before any default change

- **Status:** Accepted (the models and the rollout); the default model is unchanged until the developer decides on the measurement
- **Date:** 2026-11-17
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §6, §7.2, §8.1, §10.1 (version 4.39.0)
- **Supersedes / superseded by:** extends ADR-0095 (Groq as a third answer model, the Claude Haiku fallback) and ADR-0094 (the model during a call); changes ADR-0095's voice-question pause (1.5 s → 1.0 s).

## Context

The developer asked for the answer-model menu of a comparable product: Google's Gemini 3.5 Flash Lite ("Recommended", the candidate default), OpenAI's GPT-5.6 Luna ("Fast"), and the smarter Gemini 3.6 Flash and GPT-5.6 Terra, beside Claude Haiku (the current default and the fallback), Claude Sonnet and Groq. The default is to change only after a measurement from this laptop (Pakistan): first-word latency on `/dev/latency` and the `answers` evaluation group against its gate (8.86).

Two more providers is an architecture change: until now Claude (and, since ADR-0095, Groq for text answers) were the only processors of call content.

## Decision

### Models and where their ids come from

| Stored value | Shown as (rollout list) | Provider | Model id (variable, default) |
|---|---|---|---|
| `gemini-lite` | Gemini 3.5 Flash Lite (Recommended) | Google Gemini API | `KITE_MODEL_GEMINI_LITE`, `gemini-3.5-flash-lite` |
| `gpt-luna` | GPT-5.6 Luna (Fast) | OpenAI API | `KITE_MODEL_OPENAI_FAST`, `gpt-5.6-luna` |
| `gemini-flash` | Gemini 3.6 Flash | Google Gemini API | `KITE_MODEL_GEMINI_FLASH`, `gemini-3.6-flash` |
| `gpt-terra` | GPT-5.6 Terra | OpenAI API | `KITE_MODEL_OPENAI_SMART`, `gpt-5.6-terra` |
| `fast` | Claude Haiku | Anthropic | `KITE_MODEL_FAST` |
| `smart` | Claude Sonnet | Anthropic | `KITE_MODEL_SMART` |
| `groq` | Groq (Fastest) | Groq | `GROQ_MODEL` |

All four new ids were listed by each provider's models endpoint with our keys on 17 Nov 2026. Keys: `GEMINI_API_KEY`, `OPENAI_API_KEY` (server only; Vercel Production). `providerOf()` in `packages/shared` maps a model to its provider.

### Rollout and switches

- **Per account:** `KITE_ANSWER_MODELS_USERS` (account ids, or `*`; unset = no one), read by `moreModelsFor()` in `server/modelAccess.ts`. Only these accounts see the longer list (the order above) and may use the four models. Everyone else sees the classic list (Fast, Smart, Fastest) exactly as before, and `GET /api/models` sends them exactly the older fields.
- **Per provider:** Admin → Usage gets "Allow Gemini models in sessions" and "Allow OpenAI (GPT) models in sessions" (`app_setting` `gemini_model_enabled`, `openai_model_enabled`; cached 60 s like Groq's). A provider is on for an account when it is in the rollout, the server has the key and the switch is on (`getProviderEnabled()`). Otherwise the server answers with Claude Haiku (`allowedModel()`), and the lists show the model disabled with "Turned off by your admin".
- `GET /api/models` adds `moreModels`, `gemini`, `openai` for accounts in the rollout.

### Requests (latency settings)

- **One place per provider:** `server/gemini.ts` (REST `streamGenerateContent?alt=sse`, key in the `x-goog-api-key` header) and `server/openai.ts` (Chat Completions). Plain `fetch` with the shared server-sent-events reader, error type and fallback in `server/providerStream.ts` (moved out of `server/groq.ts`, which now uses them too). No new dependency.
- **Reasoning off or lowest:** OpenAI `reasoning_effort: 'none'` (the models refuse `'minimal'` with a 400); Gemini `thinkingConfig.thinkingLevel: 'minimal'` (Gemini 3.5 Flash Lite refuses `thinkingBudget: 0` with a 400; both models report 0 thought tokens with `'minimal'`). On every live answer, voice question, screenshot and warm-up. Streaming on.
- **Same prompt:** the prompt built for Claude (`buildPrompt()`: locked contract, global prompt, session with the user's preferences, conversation, end reminder) is converted, in the same order: the system blocks become one system message / system instruction, each turn keeps its blocks; a screenshot becomes an image part (`image_url` data URL / `inlineData`). The hidden-line contract fallback (ADR-0089) applies unchanged.
- **Caching:** our prefix order is kept, so the prefix grows as the call does. OpenAI caches a prefix of 1,024+ tokens automatically; `prompt_cache_key` is the call id (`AnswerRequest.callId`, new, id characters only, at most 64; sent by the live page and its warm-ups; nothing else reads it); `store: false`. Gemini uses its implicit cache (automatic on a repeated prefix). Explicit Gemini cached contents are not used: they need a create/delete lifecycle per call, are billed per hour of storage, and only the system part is stable enough to put in one, which the implicit cache already covers.
- **Warm-ups:** for a Gemini or GPT session a `warm` request warms that model (one output token) and Claude Haiku (its fallback, `max_tokens: 0` as before) in parallel; it returns the session's model's usage (Claude's when the provider's warm-up failed). The call's warm-up at Connect and the idle re-warm carry the call id. Switching to a Gemini or GPT model during a call warms it (`warmGroup()`: each of these models has its own cache; Fast and Groq still share Haiku's).
- **Fallback:** as ADR-0095: an error, no first token within 4 s (`FIRST_TOKEN_MS`), or an empty reply moves the same answer to Claude Haiku; logged (`answer: <provider> fallback to haiku`, reason and HTTP status only) and recorded (`done.model: 'fast'`, `fallback`). The call's timing trace names the model that fell back (`<model>-fallback-<reason>`; an older log's flag stays `groq-fallback-…`).
- **Unchanged:** Ask AI and AI notes keep their Claude models; Groq still answers text questions only.

### Switcher, usage and voice

- The overlay's chip and ⋮ Model row, the wizard's AI preferences, Settings → defaults and the review all read one list (`core/session/modelChoices.ts`). The chip shows a short name (Flash Lite, Luna, Gemini Flash, Terra, Haiku, Sonnet, Groq); the toast says "<name> on".
- **Usage:** `usage_day.gemini_requests` and `usage_day.openai_requests` (migration 0011, additive, default 0), increased in the same statement as the daily count when a request is sent to that provider (counted when asked, so a request that fell back still counts there). Admin → Usage shows "Gemini today / 7 days" and "OpenAI today / 7 days".
- **Voice:** the pause that sends a spoken question (one question or Voice mode) is now 1.0 s (`SEND_PAUSE_MS`, was 1.5 s).

### Measurement tools

- `/dev/latency` can choose the model and the session (the pilot review with its 2,000-word document, or an interview with an invented CV), also from its address (`?model=…&session=cv`), and counts fallbacks; `tests/e2e-prod/latency.spec.ts` passes `KITE_LATENCY_MODEL` and `KITE_LATENCY_SESSION`.
- `eval-answers --model=<gemini-lite|gpt-luna|gemini-flash|gpt-terra>` takes live answers from that model with the route's settings; the grader stays Sonnet. The spend meter knows Luna's and Flash Lite's list prices.

### Default

Unchanged (`fast`, Claude Haiku) until the developer approves a change on the measured results (`docs/testing/benchmark-results.md`).

## Consequences

- Google and OpenAI are new processors of call content (the same prompt Claude gets, screenshots included) for sessions set to their models; the privacy page lists them, and Groq, which it had not listed since ADR-0095. Keys are server-only; provider error text is never logged or forwarded.
- Two more provider bills. Usage is counted per provider; each provider can be turned off by an admin.
- A warm-up for a Gemini or GPT session is two requests (the provider and Haiku).
- An older live page publishes no `moreModels`: its overlay shows the classic list. An older server sends no `moreModels`: the classic list.

## Alternatives considered

- **The providers' SDKs (`openai`, `@google/genai`):** two dependencies for one streaming call each. Rejected for the shared `fetch` reader Groq already proved.
- **OpenAI's Responses API:** no benefit for a single streamed turn; Chat Completions shares the reader with Groq.
- **Explicit Gemini caches:** see Caching above.
- **Changing the default now:** rejected by the developer: measure first.

## Validation

- Unit: `server/openai.ts` and `server/gemini.ts` (conversion with images, streaming, usage, latency settings, cache key, HTTP and stream errors, warm-up); the answer route with both providers (answers and model names, model ids from the environment, screenshots to the provider, cache key, fallback on error and on the 4 s limit, warm-ups of both, rollout and switches, Ask AI, call id validation); `GET /api/models`; model access (rollout, switches, `allowedModel()`); usage counts per provider; the model lists, toasts and chip; warm groups and the call id; the timing trace's flag; the voice pause; `/dev/latency` with a model and the CV session.
- Measurement and evaluation: `docs/testing/benchmark-results.md` and `docs/testing/answer-eval.md` (paid runs agreed with the developer first).

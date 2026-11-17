# ADR-0100: A longer keep-alive for server → provider connections (rejected after measurement)

- **Status:** Rejected (measured, no gain; the change was deployed for the measurement and reverted the same day)
- **Date:** 2026-11-18
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6.2 (latency levers); no architecture change
- **Supersedes / superseded by:** none; follows the connection check in `docs/testing/benchmark-results.md` (ADR-0099, 18 Nov 2026)

## Context

The Claude SDK and the OpenAI, Gemini and Groq modules all use Node's global `fetch`. It closes an idle connection after 4 s, and none of the providers sends a Keep-Alive hint, so in a call (questions tens of seconds apart) every answer opens a new TLS connection from the server. The developer asked to test a longer keep-alive (about 60 s) and keep it only if answers are faster or equal and nothing breaks.

## Decision

Not adopted. The tested change was one undici `Agent` (`keepAliveTimeout` and `keepAliveMaxTimeout` 60 s) with undici's own `fetch` (`undici` 8.12.3, pinned), used as the Anthropic SDK's `fetch` and by `server/providerStream.ts`. Locally it did what it should: OpenAI and Claude both reused the connection after 20 s and 45 s idle, opened a new one after 65 s, with no errors; the real OpenAI, Gemini and Claude modules streamed through it.

On production (Haiku, the CV session, 20 answers 20 s apart, `/dev/latency?gap=20000`), it made no measurable difference:

| | First word p50 / p95 (ms) | Server: received → provider stream open p50 / p95 | Server: received → first text p50 / p95 |
|---|---|---|---|
| Before (Node's fetch) | 1,019 / 1,362 | 391 / 495 | 569 / 666 |
| After (60 s keep-alive) | 1,102 / 1,568 | 381 / 519 | 562 / 707 |

The server-side times are the same within noise. The function runs in `iad1`, next to the providers, so a new TLS connection there costs only tens of milliseconds, too little to show against the providers' own time to respond; and a Vercel request may land on another instance, whose pool is empty. The first-word difference is the network between this laptop and Vercel, which the change does not touch.

## Consequences

- No new dependency. Each answer still opens its own connection from the server.
- `/dev/latency` keeps the `?gap=<ms>` option (at most 60 s between answers) used for this measurement, and the production latency spec reports the server's stream-open time.

## Alternatives considered

- **Replacing Node's global dispatcher:** mixes the `undici` package with the undici Node bundles (different versions). Not tried.
- **A server-side ping to the providers between answers:** spends requests to save tens of milliseconds. Not tried.

## Validation

`docs/testing/benchmark-results.md` (18 Nov 2026, "Longer keep-alive to the providers"): the local connection check and the two production runs above.

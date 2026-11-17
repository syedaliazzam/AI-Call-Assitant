/**
 * File: apps/web/src/server/providerFetch.ts
 * Purpose: The fetch the server uses for the answer models' providers (Anthropic, OpenAI, Google Gemini, Groq),
 *          with one connection pool that keeps an idle connection open for PROVIDER_KEEP_ALIVE_MS. Node's
 *          built-in fetch closes an idle connection after 4 s (none of the providers sends a Keep-Alive hint),
 *          so in a call, where questions come tens of seconds apart, every answer opened a new TLS connection
 *          from the server. While a Vercel function instance stays alive between requests, this pool lets the
 *          next answer reuse the connection instead.
 * Used by: src/server/claude.ts (the Anthropic SDK's fetch), src/server/providerStream.ts (Groq, OpenAI,
 *          Gemini)
 * Depends on: undici (its own fetch and Agent, so the pool and the fetch are always the same version, whatever
 *             undici Node bundles)
 * Architecture: docs/decisions/ADR-0100-provider-connection-keep-alive.md
 *
 * Nothing here logs or reads request or response content.
 */
import 'server-only';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * How long an idle connection to a provider stays open, in ms (ADR-0100: the developer's ~60 s). A
 * connection the provider closes first is simply opened again; see the ADR for the measured idle limits.
 */
export const PROVIDER_KEEP_ALIVE_MS = 60_000;

/** The one connection pool for the providers (per server instance). */
const agent = new Agent({
  keepAliveTimeout: PROVIDER_KEEP_ALIVE_MS,
  keepAliveMaxTimeout: PROVIDER_KEEP_ALIVE_MS,
});

/**
 * fetch through the keep-alive pool. Same signature as the global fetch, so the Anthropic SDK and the provider
 * modules take it as their fetch.
 *
 * @param input The address or request.
 * @param init  The request options (method, headers, body, signal).
 * @returns The response.
 * Called from: src/server/claude.ts (getClaude()), src/server/providerStream.ts (postJson())
 */
export const providerFetch: typeof fetch = (input, init) =>
  // undici's fetch and the global one are the same WHATWG fetch; their TypeScript types differ only in
  // undici-specific extras, so the cast is safe. The dispatcher is the keep-alive pool.
  undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: agent,
  }) as unknown as Promise<Response>;

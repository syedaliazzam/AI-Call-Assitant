/**
 * File: apps/web/src/server/sttToken.ts
 * Purpose: The work of POST /api/stt/token (ADR-0076): for a signed-in account with cloud transcription,
 *          within a per-account rate limit, mint a 60-second Deepgram token and say where and with which
 *          models to open the call's two speech sockets. The browser opens them at Connect (never at a key
 *          press) and asks again for each reconnect. The Deepgram key never leaves the server, and nothing
 *          about the account is logged: only the outcome and the time taken.
 * Used by: app/api/stt/token/route.ts; tests/unit/server/sttToken.test.ts
 * Depends on: src/server/auth.ts (getCachedSession), src/server/deepgram.ts,
 *             src/server/google/rateLimit.ts (the same small in-memory limiter as the Google routes)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md C2; ADR-0076
 */
import 'server-only';
import type { SttTokenErrorCode, SttTokenResponse } from '@kite/shared';
import { getCachedSession } from './auth';
import {
  DeepgramGrantError,
  deepgramEnabledFor,
  getDeepgramConfig,
  mintDeepgramToken,
  type DeepgramConfig,
  type MintedToken,
} from './deepgram';
import { createRateLimiter, type RateLimiter } from './google/rateLimit';

/**
 * Tokens one account may ask for per minute. A call needs one per Connect and one per reconnect of a
 * channel (the background retries after a failover back off to every 30 s), so 30 leaves plenty of room
 * while stopping a stuck page from minting hundreds.
 */
export const TOKENS_PER_MINUTE = 30;

/** The signed-in account, as far as this route reads it. */
export interface TokenUser {
  /** Account id (compared with the rollout list; never logged). */
  id: string;
  /** True while the account must still change a temporary password. */
  mustChangePassword: boolean;
}

/** What handleSttToken() uses (tests replace each). */
export interface SttTokenDeps {
  /** The signed-in account and any refreshed cookies. */
  session: (headers: Headers) => Promise<{ user: TokenUser | null; setCookies: string[] }>;
  /** The Deepgram settings (null: not configured). */
  config: () => DeepgramConfig | null;
  /** Whether the account has cloud transcription. */
  enabled: (userId: string) => boolean;
  /** Mints a token. */
  mint: (config: DeepgramConfig) => Promise<MintedToken>;
  /** The per-account limiter. */
  limiter: RateLimiter;
}

/** The real dependencies (one limiter per server instance). */
const DEFAULT_DEPS: SttTokenDeps = {
  session: async (headers) => {
    const { session, setCookies } = await getCachedSession(headers);
    const user = session?.user
      ? { id: session.user.id, mustChangePassword: session.user.mustChangePassword === true }
      : null;
    return { user, setCookies };
  },
  config: () => getDeepgramConfig(),
  enabled: (userId) => deepgramEnabledFor(userId),
  mint: (config) => mintDeepgramToken(config),
  limiter: createRateLimiter(TOKENS_PER_MINUTE, 60_000),
};

/**
 * A JSON error reply that is never cached.
 *
 * @param status  HTTP status.
 * @param code    Machine-readable reason.
 * @param message Short explanation (no secrets, no account details).
 * @returns The response.
 * Called from: answer()
 */
function refuse(status: number, code: SttTokenErrorCode, message: string): Response {
  return Response.json({ code, message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * The decision, before any refreshed cookies are added.
 *
 * @param user The signed-in account, or null.
 * @param deps See SttTokenDeps.
 * @returns The response.
 * Called from: handleSttToken()
 */
async function answer(user: TokenUser | null, deps: SttTokenDeps): Promise<Response> {
  if (!user) return refuse(401, 'unauthorized', 'Sign in required');
  if (user.mustChangePassword) {
    return refuse(401, 'unauthorized', 'Change your temporary password first');
  }
  // Not rolled out to this account: the page keeps the on-device engine (no notice, nothing wrong).
  if (!deps.enabled(user.id)) return refuse(404, 'not_enabled', 'Cloud transcription is not on');
  if (!deps.limiter.allow(`stt-token:${user.id}`)) {
    return refuse(429, 'rate_limited', 'Too many requests; try again in a minute');
  }
  let config: DeepgramConfig | null;
  try {
    config = deps.config();
  } catch {
    // A malformed DEEPGRAM_HOST: the variable's name is in the server's own error, never its value.
    config = null;
  }
  if (!config) return refuse(503, 'not_configured', 'Cloud transcription is not set up');
  try {
    const minted = await deps.mint(config);
    const body: SttTokenResponse = {
      token: minted.token,
      expiresIn: minted.expiresIn,
      host: config.host,
      models: { them: config.themModel, you: config.youModel },
    };
    // A token must never sit in a shared cache.
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof DeepgramGrantError ? error.status : 0;
    // The status only: never the key, the token or Deepgram's reply.
    console.warn('stt-token: grant failed', { deepgramStatus: status });
    return refuse(502, 'upstream_error', 'Cloud transcription is unavailable');
  }
}

/**
 * Handles POST /api/stt/token.
 *
 * @param request The request (only its cookies are read; the body is ignored).
 * @param deps    See SttTokenDeps (tests only).
 * @returns 200 with an SttTokenResponse, or 401 (signed out / temporary password), 404 (not rolled out to
 *          this account), 429 (rate limit), 503 (no key on the server), 502 (Deepgram refused or did not
 *          answer); each with any refreshed sign-in cookie.
 * Called from: app/api/stt/token/route.ts
 */
export async function handleSttToken(
  request: Request,
  deps: SttTokenDeps = DEFAULT_DEPS,
): Promise<Response> {
  const startedAt = performance.now();
  const { user, setCookies } = await deps.session(request.headers);
  const response = await answer(user, deps);
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  console.info('stt-token', {
    status: response.status,
    ms: Math.round(performance.now() - startedAt),
  });
  return response;
}

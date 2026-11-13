/**
 * File: apps/web/src/server/deepgram.ts
 * Purpose: Cloud speech-to-text settings and short-lived Deepgram tokens (ADR-0076). Reads the Deepgram
 *          settings (host, the model per channel), says which accounts have cloud transcription
 *          (KITE_STT_DEEPGRAM_USERS), and mints a 60-second token with Deepgram's /v1/auth/grant on the
 *          same host. The long-lived DEEPGRAM_API_KEY stays on the server: it is never returned, logged or
 *          sent to a browser; browsers only ever get the 60-second token.
 * Used by: app/api/stt/token/route.ts, app/(app)/live/[id]/page.tsx (the flag)
 * Depends on: src/server/calldata/flag.ts (parseSyncUsers: the same "ids or *" list format)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1; docs/investigations/2026-11-13-production-
 *               readiness.md C2, C3; ADR-0076
 */
import 'server-only';
import { parseSyncUsers } from './calldata/flag';

/** Deepgram's EU endpoint: measured faster from Pakistan than the US one, and processing stays in the EU. */
export const DEFAULT_DEEPGRAM_HOST = 'api.eu.deepgram.com';

/** The model for the other side ("Them"): Flux, for its turn events (investigation C3). */
export const DEFAULT_THEM_MODEL = 'flux-general-en';

/** The model for the microphone ("You"): Nova-3, about half the local engine's errors on a real voice. */
export const DEFAULT_YOU_MODEL = 'nova-3';

/** How long a minted token works for, seconds. It is only needed for the WebSocket handshake. */
export const TOKEN_TTL_SECONDS = 60;

/** Longest wait for Deepgram's grant, ms (measured 0.9–2.4 s from Pakistan; the server is in iad1). */
export const GRANT_TIMEOUT_MS = 8_000;

/** The Deepgram settings a call uses. */
export interface DeepgramConfig {
  /** The API key (server only; never returned, logged or sent anywhere but Deepgram). */
  apiKey: string;
  /** Host name for both the grant and the WebSockets, for example 'api.eu.deepgram.com'. */
  host: string;
  /** Model for "Them" (a Flux model such as 'flux-general-en', or a Nova model). */
  themModel: string;
  /** Model for "You" (a Nova model such as 'nova-3'). */
  youModel: string;
}

/** A Deepgram token for one browser, as /api/stt/token returns it. */
export interface MintedToken {
  /** The short-lived token (never logged). */
  token: string;
  /** Seconds until it expires (Deepgram's own number, else TOKEN_TTL_SECONDS). */
  expiresIn: number;
}

/** A failure to mint a token. Its message never holds the key or Deepgram's reply body. */
export class DeepgramGrantError extends Error {
  /** Deepgram's HTTP status, or 0 when Deepgram could not be reached in time. */
  readonly status: number;

  /**
   * @param status  Deepgram's HTTP status (0 = network failure or timeout).
   * @param message What failed, without secrets.
   */
  constructor(status: number, message: string) {
    super(message);
    this.name = 'DeepgramGrantError';
    this.status = status;
  }
}

/**
 * A host name as configured, or the default: bare host names only (no scheme, path or port), so a
 * typo cannot point the grant, and the key with it, at a URL with a path.
 *
 * @param value DEEPGRAM_HOST, if set.
 * @returns The host name.
 * @throws Error naming the variable (never its value) when it is not a plain host name.
 * Called from: getDeepgramConfig()
 */
function hostFrom(value: string | undefined): string {
  const host = (value ?? '').trim();
  if (host === '') return DEFAULT_DEEPGRAM_HOST;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
    throw new Error('DEEPGRAM_HOST must be a host name such as api.eu.deepgram.com');
  }
  return host.toLowerCase();
}

/**
 * Reads the Deepgram settings from the environment.
 *
 * @param env The environment (default process.env; tests pass their own).
 * @returns The settings, or null when DEEPGRAM_API_KEY is not set (cloud transcription not configured).
 * @throws Error naming DEEPGRAM_HOST when it is not a plain host name.
 * Called from: app/api/stt/token/route.ts; tests
 */
export function getDeepgramConfig(
  env: Record<string, string | undefined> = process.env,
): DeepgramConfig | null {
  const apiKey = (env.DEEPGRAM_API_KEY ?? '').trim();
  if (apiKey === '') return null;
  return {
    apiKey,
    host: hostFrom(env.DEEPGRAM_HOST),
    themModel: (env.DEEPGRAM_MODEL_THEM ?? '').trim() || DEFAULT_THEM_MODEL,
    youModel: (env.DEEPGRAM_MODEL_YOU ?? '').trim() || DEFAULT_YOU_MODEL,
  };
}

/**
 * Whether an account uses cloud transcription (the rollout switch). Everyone else keeps the on-device
 * engine and today's question rules.
 *
 * @param userId The signed-in account's id.
 * @param env    The environment (default process.env; tests pass their own).
 * @returns True when listed in KITE_STT_DEEPGRAM_USERS, or when it is `*`.
 * Called from: app/(app)/live/[id]/page.tsx, app/api/stt/token/route.ts; tests
 */
export function deepgramEnabledFor(
  userId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const users = parseSyncUsers(env.KITE_STT_DEEPGRAM_USERS);
  return users === 'everyone' || users.has(userId);
}

/**
 * Mints a short-lived token with Deepgram's grant API, on the configured host (a token is only valid on
 * the host that minted it).
 *
 * @param config    The settings (key and host).
 * @param fetchImpl fetch (tests pass a fake).
 * @returns The token and its lifetime.
 * @throws DeepgramGrantError for a non-2xx reply (status kept), a reply without a token, or no reply
 *         within GRANT_TIMEOUT_MS (status 0). Deepgram's reply body is never read into the error.
 * Called from: app/api/stt/token/route.ts; tests
 */
export async function mintDeepgramToken(
  config: Pick<DeepgramConfig, 'apiKey' | 'host'>,
  fetchImpl: typeof fetch = fetch,
): Promise<MintedToken> {
  let response: Response;
  try {
    response = await fetchImpl(`https://${config.host}/v1/auth/grant`, {
      method: 'POST',
      headers: {
        // Deepgram's own scheme for API keys. The key goes to Deepgram only.
        Authorization: `Token ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      signal: AbortSignal.timeout(GRANT_TIMEOUT_MS),
    });
  } catch {
    throw new DeepgramGrantError(0, 'Deepgram could not be reached');
  }
  if (!response.ok) {
    // The body is not read: it could echo request details, and the status says enough.
    throw new DeepgramGrantError(
      response.status,
      `Deepgram refused the grant (${response.status})`,
    );
  }
  let body: { access_token?: unknown; expires_in?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new DeepgramGrantError(response.status, 'Deepgram sent an unreadable grant');
  }
  if (typeof body.access_token !== 'string' || body.access_token === '') {
    throw new DeepgramGrantError(response.status, 'Deepgram sent a grant without a token');
  }
  const expiresIn =
    typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) && body.expires_in > 0
      ? body.expires_in
      : TOKEN_TTL_SECONDS;
  return { token: body.access_token, expiresIn };
}

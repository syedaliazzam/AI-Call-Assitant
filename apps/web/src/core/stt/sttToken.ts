/**
 * File: apps/web/src/core/stt/sttToken.ts
 * Purpose: Asks Kite's server for a 60-second Deepgram token (POST /api/stt/token, ADR-0076). The browser
 *          only ever holds this short-lived token, never the server's Deepgram key. Asked at Connect and
 *          for each reconnect (a token is only needed for the WebSocket handshake); never at a key press.
 * Used by: src/core/stt/cloudStt.ts
 * Depends on: @kite/shared (SttTokenResponse)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md C2; ADR-0076
 */
import type { SttTokenErrorCode, SttTokenResponse } from '@kite/shared';

/** Longest wait for the token, ms (the grant itself measured 0.9–2.4 s from Pakistan). */
export const TOKEN_TIMEOUT_MS = 8_000;

/** A token request that failed. */
export class SttTokenError extends Error {
  /** The server's reason, or 'network' when it could not be reached. */
  readonly code: SttTokenErrorCode | 'network';

  /**
   * @param code    Why.
   * @param message Short explanation (no secrets).
   */
  constructor(code: SttTokenErrorCode | 'network', message: string) {
    super(message);
    this.name = 'SttTokenError';
    this.code = code;
  }
}

/**
 * Fetches a token.
 *
 * @param fetchImpl fetch (tests pass a fake).
 * @returns The token, host and models.
 * @throws SttTokenError with the server's code, or 'network'.
 * Called from: cloudStt.ts
 */
export async function fetchSttToken(fetchImpl: typeof fetch = fetch): Promise<SttTokenResponse> {
  let response: Response;
  try {
    response = await fetchImpl('/api/stt/token', {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch {
    throw new SttTokenError('network', 'The token request failed');
  }
  if (!response.ok) {
    let code: SttTokenErrorCode = 'upstream_error';
    try {
      const body = (await response.json()) as { code?: SttTokenErrorCode };
      if (body.code) code = body.code;
    } catch {
      // Not JSON: keep the generic code.
    }
    throw new SttTokenError(code, `Token refused (${response.status})`);
  }
  const body = (await response.json()) as Partial<SttTokenResponse>;
  if (
    typeof body.token !== 'string' ||
    typeof body.host !== 'string' ||
    typeof body.models?.them !== 'string' ||
    typeof body.models.you !== 'string'
  ) {
    throw new SttTokenError('upstream_error', 'The token reply was incomplete');
  }
  return {
    token: body.token,
    expiresIn: typeof body.expiresIn === 'number' ? body.expiresIn : 60,
    host: body.host,
    models: { them: body.models.them, you: body.models.you },
  };
}

/**
 * File: apps/web/src/server/google/tokens.ts
 * Purpose: The company Google account's short-lived access token (ADR-0074), for this server's own Drive
 *          calls only: from this server instance's memory while one is still good, otherwise refreshed
 *          with the stored (encrypted) refresh token. When Google refuses the refresh token
 *          (invalid_grant, invalid_client, unauthorized_client, revoked), the connection is marked
 *          "reconnect" so Settings asks an admin to reconnect; uploads wait on the devices.
 * Used by: src/server/google/api.ts, src/server/google/uploads.ts
 * Depends on: src/server/google/{oauth,company,config}.ts, src/server/calldata/crypto.ts
 * Architecture: ADR-0074 (ADR-0072 before it)
 *
 * The access token never leaves the server: no route returns it, and it is never logged.
 */
import 'server-only';
import type { DataKeys } from '../calldata/crypto';
import type { CallDataDb } from '../calldata/store';
import { getCompany, markCompanyReconnect, readCompanyToken } from './company';
import type { GoogleConfig } from './config';
import { GoogleRefusedError, refreshAccessToken, type FetchLike } from './oauth';

/** Taken off Google's lifetime, so a cached token still works for at least this long, in ms. */
export const TOKEN_MARGIN_MS = 5 * 60_000;

/** A cached access token. */
interface CachedToken {
  /** The token. */
  accessToken: string;
  /** When it stops being used (Google's expiry minus the margin), Unix ms. */
  expiresAt: number;
  /** The connection time it belongs to: a reconnect makes older tokens unusable. */
  connectedAt: number;
}

/** This instance's cached company token. */
let cached: CachedToken | null = null;

/**
 * Forgets the cached token (disconnect, reconnect).
 *
 * @returns Nothing.
 * Called from: api.ts (callback, disconnect); tests
 */
export function forgetCompanyToken(): void {
  cached = null;
}

/** What a token needs. */
export interface TokenDeps {
  /** The database. */
  db: CallDataDb;
  /** The data keys. */
  keys: DataKeys;
  /** The Google client. */
  config: GoogleConfig;
  /** The fetch for Google. */
  fetch: FetchLike;
  /** The clock (Unix ms). */
  now: () => number;
}

/**
 * Why no token could be had:
 * - not-connected: no admin has connected the company account;
 * - reconnect: Google refused the stored token (now, or earlier).
 */
export type TokenRefusal = 'not-connected' | 'reconnect';

/**
 * The company account's access token, for a Drive call made here on the server.
 *
 * @param deps Database, keys, client, fetch and clock.
 * @returns The token, or why there is none.
 * @throws GoogleUnavailableError when Google cannot be reached (try later); DataKeyError.
 * Called from: api.ts, uploads.ts; tests
 */
export async function companyAccessToken(deps: TokenDeps): Promise<string | TokenRefusal> {
  const row = await getCompany(deps.db);
  if (!row) {
    cached = null;
    return 'not-connected';
  }
  if (row.status === 'reconnect') {
    cached = null;
    return 'reconnect';
  }
  const connectedAt = row.connectedAt.getTime();
  if (cached && cached.connectedAt === connectedAt && cached.expiresAt > deps.now()) {
    return cached.accessToken;
  }
  try {
    const fresh = await refreshAccessToken(
      deps.fetch,
      deps.config,
      readCompanyToken(deps.keys, row),
    );
    cached = {
      accessToken: fresh.accessToken,
      expiresAt: deps.now() + fresh.expiresIn * 1000 - TOKEN_MARGIN_MS,
      connectedAt,
    };
    return fresh.accessToken;
  } catch (error) {
    if (error instanceof GoogleRefusedError) {
      cached = null;
      await markCompanyReconnect(deps.db);
      // The code only (for example 'invalid_grant'): never the token or Google's message.
      console.warn('google: company refresh refused, reconnect needed', { code: error.code });
      return 'reconnect';
    }
    throw error;
  }
}

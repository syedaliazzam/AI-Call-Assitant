/**
 * File: apps/web/src/server/google/tokens.ts
 * Purpose: Short-lived Google access tokens for an account (ADR-0072): from this server instance's
 *          memory while one is still good, otherwise refreshed with the stored (encrypted) refresh
 *          token. When Google refuses the refresh token (invalid_grant, invalid_client,
 *          unauthorized_client, revoked), the connection is marked "reconnect" so Settings and the next
 *          upload say "Reconnect Google Drive"; queued uploads wait on the devices.
 * Used by: src/server/google/api.ts
 * Depends on: src/server/google/{oauth,store,config}.ts, src/server/calldata/crypto.ts
 * Architecture: ADR-0072
 *
 * Tokens never leave this module except as the access token the signed-in owner asked for.
 */
import 'server-only';
import type { DataKeys } from '../calldata/crypto';
import type { CallDataDb } from '../calldata/store';
import type { GoogleConfig } from './config';
import { GoogleRefusedError, refreshAccessToken, type FetchLike } from './oauth';
import { getConnection, markReconnect, readRefreshToken } from './store';

/** Taken off Google's lifetime, so a token handed out still works for at least this long, in ms. */
export const TOKEN_MARGIN_MS = 5 * 60_000;

/** A cached access token. */
interface CachedToken {
  /** The token. */
  accessToken: string;
  /** When it stops being handed out (Google's expiry minus the margin), Unix ms. */
  expiresAt: number;
  /** The connection time it belongs to: a reconnect makes older tokens unusable. */
  connectedAt: number;
}

/** This instance's cache, by account. */
const cache = new Map<string, CachedToken>();

/**
 * Forgets an account's cached token (disconnect, reconnect).
 *
 * @param userId The account.
 * Called from: api.ts; tests
 */
export function forgetAccessToken(userId: string): void {
  cache.delete(userId);
}

/** What accessTokenFor() needs. */
export interface TokenDeps {
  /** The database. */
  db: CallDataDb;
  /** The data keys. */
  keys: DataKeys;
  /** The Google client. */
  config: GoogleConfig;
  /** The fetch. */
  fetch: FetchLike;
  /** The clock (Unix ms). */
  now: () => number;
}

/**
 * Why no token could be given:
 * - not-connected: no connection row;
 * - reconnect: Google refused the stored token (now, or earlier).
 */
export type TokenRefusal = 'not-connected' | 'reconnect';

/**
 * An access token for an account.
 *
 * @param deps   Database, keys, client, fetch and clock.
 * @param userId The account.
 * @returns The token and its expiry (Unix ms, margin taken off), or why there is none.
 * @throws GoogleUnavailableError when Google cannot be reached (try later); DataKeyError.
 * Called from: api.ts (access-token, folder); tests
 */
export async function accessTokenFor(
  deps: TokenDeps,
  userId: string,
): Promise<{ accessToken: string; expiresAt: number } | TokenRefusal> {
  const row = await getConnection(deps.db, userId);
  if (!row) {
    cache.delete(userId);
    return 'not-connected';
  }
  if (row.status === 'reconnect') {
    cache.delete(userId);
    return 'reconnect';
  }
  const connectedAt = row.connectedAt.getTime();
  const cached = cache.get(userId);
  if (cached && cached.connectedAt === connectedAt && cached.expiresAt > deps.now()) {
    return { accessToken: cached.accessToken, expiresAt: cached.expiresAt };
  }
  try {
    const fresh = await refreshAccessToken(
      deps.fetch,
      deps.config,
      readRefreshToken(deps.keys, row),
    );
    const expiresAt = deps.now() + fresh.expiresIn * 1000 - TOKEN_MARGIN_MS;
    cache.set(userId, { accessToken: fresh.accessToken, expiresAt, connectedAt });
    return { accessToken: fresh.accessToken, expiresAt };
  } catch (error) {
    if (error instanceof GoogleRefusedError) {
      cache.delete(userId);
      await markReconnect(deps.db, userId);
      // The code only (for example 'invalid_grant'): never the token or Google's message.
      console.warn('google: refresh refused, reconnect needed', { code: error.code });
      return 'reconnect';
    }
    throw error;
  }
}

/**
 * File: apps/web/src/server/google/oauth.ts
 * Purpose: The Google side of connecting Drive (ADR-0072): the signed OAuth state (tied to the
 *          signed-in account, checked against a short-lived cookie: CSRF), PKCE, the consent address
 *          (drive.file only, offline, prompt=consent), exchanging the code, refreshing an access token,
 *          revoking a token, and reading the picked folder. Pure functions plus calls through an
 *          injected fetch, so tests never reach Google.
 * Used by: src/server/google/api.ts, src/server/google/tokens.ts
 * Depends on: node:crypto, @kite/shared (DRIVE_SCOPE, DRIVE_FOLDER_MIME)
 * Architecture: ADR-0072; architecture §8.2
 *
 * Nothing here logs: tokens, codes and folder names never reach a log line.
 */
import 'server-only';
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { DRIVE_FOLDER_MIME, DRIVE_SCOPE } from '@kite/shared';
import type { GoogleConfig } from './config';

/** Google's consent page. */
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Google's token endpoint (code exchange and refresh). */
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Google's revoke endpoint. */
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** How long a connect attempt may take, from Kite to Google's consent and back, in ms. */
export const STATE_TTL_MS = 10 * 60_000;

/** The cookie that holds the attempt's nonce and PKCE verifier (httpOnly, /api/google only). */
export const STATE_COOKIE = 'kite_gdrive_oauth';

/** The fetch the Google calls use (tests pass a fake). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Google refused the stored token or the client: the person must connect again. Raised for
 * invalid_grant (revoked, expired after a testing project's 7 days), invalid_client and
 * unauthorized_client (the project or client changed).
 */
export class GoogleRefusedError extends Error {
  /**
   * @param code Google's error code (never a token or message from Google).
   */
  constructor(public readonly code: string) {
    super(`Google refused the token (${code})`);
    this.name = 'GoogleRefusedError';
  }
}

/** Google could not be reached or answered with a server error: try again later. */
export class GoogleUnavailableError extends Error {
  /**
   * @param status The HTTP status, or 0 when Google could not be reached.
   */
  constructor(public readonly status: number) {
    super(`Google is unavailable (${status})`);
    this.name = 'GoogleUnavailableError';
  }
}

/** The error codes that mean "connect again". */
const REFUSED_CODES = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

/**
 * Base64url of bytes.
 * @param bytes The bytes.
 * @returns The text.
 */
function b64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/**
 * The key that signs OAuth state, derived from BETTER_AUTH_SECRET (so no new secret is needed and a
 * signature can never be mistaken for one Better Auth makes: a separate HKDF label).
 *
 * @param secret BETTER_AUTH_SECRET.
 * @returns 32 bytes.
 * Called from: api.ts; tests
 */
export function stateKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'kite', 'kite-google-oauth-state-v1', 32));
}

/**
 * Compares two strings in constant time.
 * @param a One.
 * @param b The other.
 * @returns True when equal.
 */
function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A connect attempt, ready to send the person to Google. */
export interface OAuthStart {
  /** Google's consent address. */
  url: string;
  /** The cookie value (nonce and PKCE verifier) to set for the callback. */
  cookie: string;
}

/**
 * Starts a connect attempt: a signed state naming the account and a nonce, a PKCE pair, and the
 * consent address asking for drive.file only, with a refresh token (offline, prompt=consent).
 *
 * @param input.config      The Google client.
 * @param input.key         The state key (stateKey()).
 * @param input.userId      The signed-in account.
 * @param input.redirectUri This deployment's /api/google/callback address (registered at Google).
 * @param input.now         The clock (Unix ms).
 * @returns The address and the cookie value.
 * Called from: handleConnect() in api.ts; tests
 */
export function startOAuth(input: {
  config: GoogleConfig;
  key: Buffer;
  userId: string;
  redirectUri: string;
  now: number;
}): OAuthStart {
  const nonce = b64url(randomBytes(16));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const payload = b64url(
    Buffer.from(JSON.stringify({ u: input.userId, n: nonce, e: input.now + STATE_TTL_MS })),
  );
  const state = `${payload}.${b64url(createHmac('sha256', input.key).update(payload).digest())}`;
  const params = new URLSearchParams({
    client_id: input.config.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    // The only scope, ever (ADR-0072).
    scope: DRIVE_SCOPE,
    // A refresh token, so uploads after the call work without the person present.
    access_type: 'offline',
    // Always the consent screen: Google sends a refresh token only then.
    prompt: 'consent',
    // No earlier grants mixed in: the token holds drive.file and nothing else.
    include_granted_scopes: 'false',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `${GOOGLE_AUTH_URL}?${params.toString()}`, cookie: `${nonce}.${verifier}` };
}

/**
 * Checks the callback's state against the cookie and the signed-in account.
 *
 * @param input.state  The callback's state parameter.
 * @param input.cookie The STATE_COOKIE value, or null.
 * @param input.key    The state key.
 * @param input.userId The account signed in now.
 * @param input.now    The clock (Unix ms).
 * @returns The PKCE verifier, or why the callback is refused: 'invalid' (bad signature or cookie),
 *          'expired', 'account' (another account started it).
 * Called from: handleCallback() in api.ts; tests
 */
export function checkOAuthState(input: {
  state: string | null;
  cookie: string | null;
  key: Buffer;
  userId: string;
  now: number;
}): { ok: true; verifier: string } | { ok: false; reason: 'invalid' | 'expired' | 'account' } {
  const [payload, signature, ...extra] = (input.state ?? '').split('.');
  const [nonce, verifier, ...extraCookie] = (input.cookie ?? '').split('.');
  if (!payload || !signature || extra.length || !nonce || !verifier || extraCookie.length) {
    return { ok: false, reason: 'invalid' };
  }
  const expected = b64url(createHmac('sha256', input.key).update(payload).digest());
  if (!sameText(signature, expected)) return { ok: false, reason: 'invalid' };
  let parsed: { u?: unknown; n?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (typeof parsed.n !== 'string' || !sameText(parsed.n, nonce)) {
    return { ok: false, reason: 'invalid' };
  }
  if (typeof parsed.e !== 'number' || parsed.e < input.now) return { ok: false, reason: 'expired' };
  if (parsed.u !== input.userId) return { ok: false, reason: 'account' };
  return { ok: true, verifier };
}

/**
 * Reads Google's JSON error code from a failed token reply.
 * @param response The reply.
 * @returns The code ('invalid_grant', …) or 'unknown'.
 */
async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Posts a form to Google's token endpoint.
 * @param fetchFn The fetch.
 * @param form    The fields.
 * @returns The JSON reply.
 * @throws GoogleRefusedError for the "connect again" codes; GoogleUnavailableError otherwise.
 */
async function tokenRequest(
  fetchFn: FetchLike,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      cache: 'no-store',
    });
  } catch {
    throw new GoogleUnavailableError(0);
  }
  if (!response.ok) {
    const code = await errorCode(response);
    if (REFUSED_CODES.has(code)) throw new GoogleRefusedError(code);
    // Any other 4xx (for example a used code) also needs a fresh connect; a 5xx is temporary.
    if (response.status < 500) throw new GoogleRefusedError(code);
    throw new GoogleUnavailableError(response.status);
  }
  return (await response.json()) as Record<string, unknown>;
}

/** What a code exchange gives. */
export interface ExchangedTokens {
  /** The refresh token (encrypted before it is stored). */
  refreshToken: string;
  /** An access token, usable at once (the folder check). */
  accessToken: string;
  /** Seconds the access token lasts. */
  expiresIn: number;
}

/**
 * Exchanges the callback's code for tokens.
 *
 * @param fetchFn     The fetch.
 * @param config      The Google client.
 * @param code        The callback's code.
 * @param verifier    The PKCE verifier from the cookie.
 * @param redirectUri The same redirect address as the consent request.
 * @returns The tokens.
 * @throws GoogleRefusedError (also when no refresh token or no drive.file came back);
 *         GoogleUnavailableError.
 * Called from: handleCallback() in api.ts; tests
 */
export async function exchangeCode(
  fetchFn: FetchLike,
  config: GoogleConfig,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<ExchangedTokens> {
  const body = await tokenRequest(fetchFn, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  const scopes = typeof body.scope === 'string' ? body.scope.split(' ') : [];
  if (!scopes.includes(DRIVE_SCOPE)) throw new GoogleRefusedError('scope_not_granted');
  if (typeof body.refresh_token !== 'string' || typeof body.access_token !== 'string') {
    throw new GoogleRefusedError('no_refresh_token');
  }
  return {
    refreshToken: body.refresh_token,
    accessToken: body.access_token,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 3_600,
  };
}

/**
 * Gets a new access token with the stored refresh token.
 *
 * @param fetchFn      The fetch.
 * @param config       The Google client.
 * @param refreshToken The decrypted refresh token.
 * @returns The access token and its lifetime in seconds.
 * @throws GoogleRefusedError (connect again); GoogleUnavailableError (try later).
 * Called from: tokens.ts; tests
 */
export async function refreshAccessToken(
  fetchFn: FetchLike,
  config: GoogleConfig,
  refreshToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const body = await tokenRequest(fetchFn, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (typeof body.access_token !== 'string') throw new GoogleUnavailableError(502);
  return {
    accessToken: body.access_token,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 3_600,
  };
}

/**
 * Revokes a token at Google (Disconnect). A token Google no longer knows counts as revoked.
 *
 * @param fetchFn The fetch.
 * @param token   The refresh token.
 * @returns True when revoked (or already unknown to Google); false when Google could not be reached.
 * Called from: handleDisconnect() in api.ts; tests
 */
export async function revokeToken(fetchFn: FetchLike, token: string): Promise<boolean> {
  try {
    const response = await fetchFn(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      cache: 'no-store',
    });
    // 400 invalid_token: Google has already forgotten it (revoked elsewhere, or expired).
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}

/** A folder as Drive describes it. */
export interface DriveFolderInfo {
  /** Its id. */
  id: string;
  /** Its name. */
  name: string;
  /** Its Shared Drive, or null. */
  driveId: string | null;
}

/**
 * Reads the picked folder from Drive, so only a real, reachable folder is stored (with Drive's own
 * name and Shared Drive, not the page's).
 *
 * @param fetchFn     The fetch.
 * @param accessToken An access token.
 * @param folderId    The picked id.
 * @returns The folder, or null when it is not a folder, is in the bin, or Kite cannot see it.
 * @throws GoogleUnavailableError when Drive cannot be reached; GoogleRefusedError on 401.
 * Called from: handleFolder() in api.ts; tests
 */
export async function readDriveFolder(
  fetchFn: FetchLike,
  accessToken: string,
  folderId: string,
): Promise<DriveFolderInfo | null> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`);
  url.searchParams.set('fields', 'id,name,mimeType,driveId,trashed');
  url.searchParams.set('supportsAllDrives', 'true');
  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch {
    throw new GoogleUnavailableError(0);
  }
  if (response.status === 401) throw new GoogleRefusedError('unauthorized');
  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new GoogleUnavailableError(response.status);
  const file = (await response.json()) as {
    id?: unknown;
    name?: unknown;
    mimeType?: unknown;
    driveId?: unknown;
    trashed?: unknown;
  };
  if (
    typeof file.id !== 'string' ||
    typeof file.name !== 'string' ||
    file.mimeType !== DRIVE_FOLDER_MIME ||
    file.trashed === true
  ) {
    return null;
  }
  return {
    id: file.id,
    name: file.name,
    driveId: typeof file.driveId === 'string' ? file.driveId : null,
  };
}

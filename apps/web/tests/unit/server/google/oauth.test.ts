/**
 * Tests for apps/web/src/server/google/oauth.ts and config.ts (ADR-0072): the consent address asks for
 * drive.file only (offline, consent, PKCE S256); the signed state is accepted only with its own cookie,
 * for the same account, before it expires, and untampered; the code exchange needs drive.file and a
 * refresh token; refresh failures are sorted into "connect again" (invalid_grant, invalid_client,
 * unauthorized_client) and "try later" (5xx, network); revoke; the folder check; and the env readers.
 * No real Google call is made: every request goes to a fake fetch.
 */
import { describe, expect, it } from 'vitest';
import { DRIVE_SCOPE } from '@kite/shared';
import { emailConfig, googleConfig } from '@/server/google/config';
import {
  GoogleRefusedError,
  GoogleUnavailableError,
  checkOAuthState,
  exchangeCode,
  readDriveFolder,
  refreshAccessToken,
  revokeToken,
  startOAuth,
  stateKey,
  type FetchLike,
} from '@/server/google/oauth';

/** An invented client (never a real one). */
const CONFIG = {
  clientId: 'client-test',
  clientSecret: 'secret-test',
  pickerApiKey: null,
  appId: null,
};

/** An invented signing key. */
const KEY = stateKey('x'.repeat(40));

/**
 * A fake fetch that answers every request with one reply.
 * @param status The status.
 * @param body   The JSON body.
 * @returns The fetch and the requests it saw.
 */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchFn, calls };
}

describe('startOAuth', () => {
  it('asks for drive.file only, offline, with the consent screen and PKCE', () => {
    const start = startOAuth({
      config: CONFIG,
      key: KEY,
      userId: 'u1',
      redirectUri: 'https://kite.example/api/google/callback',
      now: 1_000,
    });
    const url = new URL(start.url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('false');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://kite.example/api/google/callback');
    expect(start.url).not.toMatch(/drive\.readonly|auth\/drive[^.]|calendar|gmail/);
  });
});

describe('checkOAuthState', () => {
  const begin = () => {
    const start = startOAuth({
      config: CONFIG,
      key: KEY,
      userId: 'u1',
      redirectUri: 'r',
      now: 1_000,
    });
    return { state: new URL(start.url).searchParams.get('state'), cookie: start.cookie };
  };

  it('accepts its own state and cookie for the same account', () => {
    const { state, cookie } = begin();
    const checked = checkOAuthState({ state, cookie, key: KEY, userId: 'u1', now: 2_000 });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.verifier).toBe(cookie.split('.')[1]);
  });

  it('refuses another account, an expired state, a tampered state and a missing or wrong cookie', () => {
    const { state, cookie } = begin();
    expect(checkOAuthState({ state, cookie, key: KEY, userId: 'u2', now: 2_000 })).toEqual({
      ok: false,
      reason: 'account',
    });
    expect(
      checkOAuthState({ state, cookie, key: KEY, userId: 'u1', now: 1_000 + 11 * 60_000 }),
    ).toEqual({ ok: false, reason: 'expired' });
    const tampered = `${state!.split('.')[0]}x.${state!.split('.')[1]}`;
    expect(
      checkOAuthState({ state: tampered, cookie, key: KEY, userId: 'u1', now: 2_000 }).ok,
    ).toBe(false);
    expect(checkOAuthState({ state, cookie: null, key: KEY, userId: 'u1', now: 2_000 }).ok).toBe(
      false,
    );
    const other = begin();
    expect(
      checkOAuthState({ state, cookie: other.cookie, key: KEY, userId: 'u1', now: 2_000 }).ok,
    ).toBe(false);
    expect(
      checkOAuthState({ state, cookie, key: stateKey('y'.repeat(40)), userId: 'u1', now: 2_000 })
        .ok,
    ).toBe(false);
  });
});

describe('exchangeCode', () => {
  it('returns the tokens when drive.file and a refresh token came back', async () => {
    const { fetchFn, calls } = fakeFetch(200, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3599,
      scope: DRIVE_SCOPE,
    });
    const tokens = await exchangeCode(fetchFn, CONFIG, 'code', 'verifier', 'https://r');
    expect(tokens).toEqual({ refreshToken: 'rt', accessToken: 'at', expiresIn: 3599 });
    const form = new URLSearchParams(String(calls[0]!.init!.body));
    expect(form.get('code_verifier')).toBe('verifier');
    expect(form.get('grant_type')).toBe('authorization_code');
  });

  it('refuses a reply without drive.file or without a refresh token', async () => {
    await expect(
      exchangeCode(
        fakeFetch(200, { access_token: 'a', refresh_token: 'r', scope: 'openid' }).fetchFn,
        CONFIG,
        'c',
        'v',
        'r',
      ),
    ).rejects.toMatchObject({ code: 'scope_not_granted' });
    await expect(
      exchangeCode(
        fakeFetch(200, { access_token: 'a', scope: DRIVE_SCOPE }).fetchFn,
        CONFIG,
        'c',
        'v',
        'r',
      ),
    ).rejects.toMatchObject({ code: 'no_refresh_token' });
  });
});

describe('refreshAccessToken', () => {
  it.each(['invalid_grant', 'invalid_client', 'unauthorized_client'])(
    'treats %s as "connect again"',
    async (code) => {
      await expect(
        refreshAccessToken(fakeFetch(400, { error: code }).fetchFn, CONFIG, 'rt'),
      ).rejects.toBeInstanceOf(GoogleRefusedError);
    },
  );

  it('treats a server error or no network as "try later"', async () => {
    await expect(
      refreshAccessToken(fakeFetch(503, { error: 'backend' }).fetchFn, CONFIG, 'rt'),
    ).rejects.toBeInstanceOf(GoogleUnavailableError);
    const offline: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(refreshAccessToken(offline, CONFIG, 'rt')).rejects.toBeInstanceOf(
      GoogleUnavailableError,
    );
  });

  it('returns a fresh token', async () => {
    const { fetchFn } = fakeFetch(200, { access_token: 'fresh', expires_in: 100 });
    expect(await refreshAccessToken(fetchFn, CONFIG, 'rt')).toEqual({
      accessToken: 'fresh',
      expiresIn: 100,
    });
  });
});

describe('revokeToken and readDriveFolder', () => {
  it('counts a token Google has already forgotten as revoked, and no network as not', async () => {
    expect(await revokeToken(fakeFetch(200, {}).fetchFn, 'rt')).toBe(true);
    expect(await revokeToken(fakeFetch(400, { error: 'invalid_token' }).fetchFn, 'rt')).toBe(true);
    expect(
      await revokeToken(async () => {
        throw new TypeError('offline');
      }, 'rt'),
    ).toBe(false);
  });

  it('accepts only a real folder, with Shared Drives supported', async () => {
    const folder = fakeFetch(200, {
      id: 'F1',
      name: 'Team calls',
      mimeType: 'application/vnd.google-apps.folder',
      driveId: 'D1',
    });
    expect(await readDriveFolder(folder.fetchFn, 'at', 'F1')).toEqual({
      id: 'F1',
      name: 'Team calls',
      driveId: 'D1',
    });
    expect(folder.calls[0]!.url).toContain('supportsAllDrives=true');
    const file = fakeFetch(200, { id: 'F1', name: 'x', mimeType: 'text/plain' });
    expect(await readDriveFolder(file.fetchFn, 'at', 'F1')).toBeNull();
    expect(await readDriveFolder(fakeFetch(404, {}).fetchFn, 'at', 'F1')).toBeNull();
  });
});

describe('config', () => {
  it('needs both client values; the email needs all five SMTP values and a real port', () => {
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'a' })).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' })).toEqual({
      clientId: 'a',
      clientSecret: 'b',
      pickerApiKey: null,
      appId: null,
    });
    const smtp = {
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '587',
      SMTP_USER: 'notify@example.test',
      SMTP_PASS: 'app-password\n',
      NOTIFY_FROM_EMAIL: 'Paramount AI <notify@example.test>',
    };
    expect(emailConfig(smtp)).toEqual({
      host: 'smtp.example.test',
      port: 587,
      user: 'notify@example.test',
      pass: 'app-password',
      from: 'Paramount AI <notify@example.test>',
    });
    for (const name of Object.keys(smtp)) {
      expect(emailConfig({ ...smtp, [name]: '' })).toBeNull();
    }
    expect(emailConfig({ ...smtp, SMTP_PORT: 'abc' })).toBeNull();
    expect(emailConfig({ ...smtp, SMTP_PORT: '70000' })).toBeNull();
  });
});

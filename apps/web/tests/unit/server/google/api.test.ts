/**
 * Tests for apps/web/src/server/google/api.ts, store.ts and tokens.ts (ADR-0072), with a real Postgres
 * in memory (PGlite), invented accounts, fresh test data keys, a fake Google and a fake SMTP mailer:
 * - connect → callback stores the refresh token ENCRYPTED (never readable in the row) and goes to the
 *   Picker; a callback for another account or without the state cookie stores nothing;
 * - access tokens: refreshed once and cached; a refused refresh (invalid_grant) marks the connection
 *   "reconnect" (409) and later calls do not reach Google; connecting again clears it and keeps the folder;
 * - POSTs from another site are refused; signed-out is 401; the token route is rate-limited;
 * - one email per session: a repeated notify sends nothing; without SMTP settings it is "not-set-up" and
 *   nothing is sent; switched off it is "off"; a failed email can be retried once per Retry, with a new
 *   Message-ID; the test email goes to the signed-in person only and is rate-limited;
 * - disconnect revokes at Google and deletes the row; settings validate the team list;
 * - ADR-0073: each call of a session (one started again) has its own email, listed and retried by call.
 */
import { DRIVE_SCOPE, type DriveNotifyRequest } from '@kite/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleAccessToken,
  handleCallback,
  handleConnect,
  handleDisconnect,
  handleFolder,
  handleNotifications,
  handleNotify,
  handleRetry,
  handleSettings,
  handleStatus,
  handleFlushCron,
  handleTestEmail,
  type GoogleDeps,
} from '@/server/google/api';
import type { OutgoingEmail } from '@/server/google/email';
import { createRateLimiter } from '@/server/google/rateLimit';
import { forgetAccessToken } from '@/server/google/tokens';
import { ALICE, BOB, createTestDb, type TestDb } from '../calldata/pgliteDb';

// The real sign-in, database and environment modules need production settings; these tests pass their
// own dependencies (GoogleDeps), so the modules are replaced by empty stand-ins.
vi.mock('@/server/auth', () => ({ auth: {} }));
vi.mock('@/server/db', () => ({ db: {} }));

/** The test site's address. */
const SITE = 'https://kite.example';

/** An invented session id. */
const S1 = '11111111-1111-4111-8111-111111111111';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await t.pg.exec('DELETE FROM google_drive; DELETE FROM drive_notification;');
  forgetAccessToken(ALICE);
  forgetAccessToken(BOB);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

/** One request the fakes saw. */
interface FakeCall {
  /** Its address. */
  url: string;
  /** Its options. */
  init?: RequestInit;
}

/** A reply the fake token endpoint gives. */
interface FakeReply {
  /** HTTP status. */
  status: number;
  /** JSON body. */
  body: unknown;
}

/** What the fake Google and mail server answer, and what they were asked. */
interface Fakes {
  /** Every request made, by URL. */
  calls: FakeCall[];
  /** The token endpoint's reply for a refresh. */
  refresh: FakeReply;
  /** The fake mail server: refuse (throw with this code), or null to accept. */
  smtpError: string | null;
  /** Every message the fake mail server was given. */
  mail: OutgoingEmail[];
}

/**
 * Dependencies for one signed-in account.
 * @param user    Who is signed in.
 * @param fakes   The fake replies.
 * @param options email: SMTP configured; tokenLimit: the token rate limit.
 * @returns The dependencies.
 */
function deps(
  user: string | 'signed-out',
  fakes: Fakes,
  options: { email?: boolean; tokenLimit?: number; now?: number; cron?: string } = {},
): GoogleDeps {
  return {
    user: async () => (user === 'signed-out' ? user : { id: user, email: `${user}@example.test` }),
    db: () => t.db,
    keys: () => t.keys,
    google: () => ({ clientId: 'cid', clientSecret: 'csec', pickerApiKey: 'pk', appId: '123' }),
    email: () =>
      options.email
        ? { host: 'smtp.example.test', port: 587, user: 'u', pass: 'p', from: 'n@example.test' }
        : null,
    site: () => ({ secret: 's'.repeat(40), baseUrl: SITE, trustedOrigins: [SITE] }),
    fetch: async (url, init) => {
      fakes.calls.push({ url, init });
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        const form = new URLSearchParams(String(init?.body));
        if (form.get('grant_type') === 'authorization_code') {
          return Response.json({
            access_token: 'at-1',
            refresh_token: 'refresh-secret-value',
            expires_in: 3600,
            scope: DRIVE_SCOPE,
          });
        }
        return Response.json(fakes.refresh.body, { status: fakes.refresh.status });
      }
      if (url.startsWith('https://oauth2.googleapis.com/revoke')) return new Response('{}');
      if (url.startsWith('https://www.googleapis.com/drive/v3/files/')) {
        return Response.json({
          id: 'FOLDER1',
          name: 'Team calls',
          mimeType: 'application/vnd.google-apps.folder',
        });
      }
      throw new Error(`unexpected request to ${url}`);
    },
    mailer: async (_config, message) => {
      fakes.mail.push(message);
      if (fakes.smtpError) throw Object.assign(new Error('refused'), { code: fakes.smtpError });
    },
    cronSecret: () => options.cron ?? null,
    now: () => options.now ?? Date.now(),
    limits: {
      token: createRateLimiter(options.tokenLimit ?? 100, 60_000),
      other: createRateLimiter(100, 60_000),
      test: createRateLimiter(1, 60_000),
    },
  };
}

/**
 * Fresh fake replies.
 * @returns Fakes that succeed.
 */
function fakes(): Fakes {
  return {
    calls: [],
    refresh: { status: 200, body: { access_token: 'at-2', expires_in: 3600 } },
    smtpError: null,
    mail: [],
  };
}

/**
 * A GET request.
 * @param path   The path (and query).
 * @param cookie A Cookie header.
 * @returns The request.
 */
function get(path: string, cookie?: string): Request {
  return new Request(`${SITE}${path}`, { headers: cookie ? { cookie } : {} });
}

/**
 * A POST request with a JSON body.
 * @param path   The path.
 * @param body   The body.
 * @param origin The Origin header.
 * @returns The request.
 */
function post(path: string, body: unknown, origin = SITE): Request {
  return new Request(`${SITE}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Connects an account through connect + callback, as a browser would.
 * @param d The dependencies.
 * @returns The callback's response.
 */
async function connect(d: GoogleDeps): Promise<Response> {
  const started = await handleConnect(get('/api/google/connect'), d);
  const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
  const cookie = started.headers.get('set-cookie')!.split(';')[0]!;
  return handleCallback(
    get(`/api/google/callback?code=c1&state=${encodeURIComponent(state)}`, cookie),
    d,
  );
}

/** A notify body. */
const NOTIFY: DriveNotifyRequest = {
  sessionId: S1,
  title: 'Acme – Backend Engineer',
  callStartedAt: Date.UTC(2026, 10, 11, 14, 30),
  durationMs: 30 * 60_000,
  files: [{ name: '2026-11-11 14.30 Transcript.txt', folder: 'Transcripts' }],
  folderUrl: 'https://drive.google.com/drive/folders/SESSIONF',
  timeZone: 'UTC',
  alsoNotify: null,
  expectedRecordings: [],
  goneRecordings: [],
  manualOnly: false,
};

describe('connect and callback', () => {
  it('stores the refresh token encrypted and sends the person to the Picker', async () => {
    const f = fakes();
    const d = deps(ALICE, f);
    const started = await handleConnect(get('/api/google/connect'), d);
    expect(started.status).toBe(302);
    expect(started.headers.get('set-cookie')).toMatch(
      /HttpOnly; SameSite=Lax; Max-Age=600; Secure/,
    );
    const done = await connect(d);
    expect(done.status).toBe(303);
    expect(done.headers.get('location')).toBe(`${SITE}/settings?drive=pick#google-drive`);
    const row = (
      await t.pg.query<{ refresh_token: string; status: string }>(
        'SELECT refresh_token, status FROM google_drive WHERE user_id = $1',
        [ALICE],
      )
    ).rows[0]!;
    expect(row.status).toBe('connected');
    expect(row.refresh_token).not.toContain('refresh-secret-value');
    const status = await (await handleStatus(get('/api/google/status'), d)).json();
    expect(status).toMatchObject({
      configured: true,
      status: 'connected',
      folder: null,
      saveEnabled: true,
    });
  });

  it('stores nothing for a callback without the cookie or for another account', async () => {
    const f = fakes();
    const started = await handleConnect(get('/api/google/connect'), deps(ALICE, f));
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    const cookie = started.headers.get('set-cookie')!.split(';')[0]!;
    const noCookie = await handleCallback(
      get(`/api/google/callback?code=c&state=${state}`),
      deps(ALICE, f),
    );
    expect(noCookie.headers.get('location')).toContain('reason=state-invalid');
    const otherAccount = await handleCallback(
      get(`/api/google/callback?code=c&state=${state}`, cookie),
      deps(BOB, f),
    );
    expect(otherAccount.headers.get('location')).toContain('reason=state-account');
    expect((await t.pg.query('SELECT 1 FROM google_drive')).rows).toHaveLength(0);
    expect(f.calls.some((call) => call.url.includes('/token'))).toBe(false);
  });
});

describe('access tokens and reconnect', () => {
  it('refreshes once and caches; a refused refresh marks reconnect and stops calling Google', async () => {
    const f = fakes();
    const d = deps(ALICE, f);
    await connect(d);
    const first = await handleAccessToken(get('/api/google/access-token'), d);
    expect(await first.json()).toMatchObject({ accessToken: 'at-2' });
    await handleAccessToken(get('/api/google/access-token'), d);
    const refreshes = () =>
      f.calls.filter(
        (c) => new URLSearchParams(String(c.init?.body)).get('grant_type') === 'refresh_token',
      ).length;
    expect(refreshes()).toBe(1);

    forgetAccessToken(ALICE);
    f.refresh = { status: 400, body: { error: 'invalid_grant' } };
    const refused = await handleAccessToken(get('/api/google/access-token'), d);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'reconnect' });
    expect((await (await handleStatus(get('/api/google/status'), d)).json()).status).toBe(
      'reconnect',
    );
    await handleAccessToken(get('/api/google/access-token'), d);
    expect(refreshes()).toBe(2);

    // Connecting again keeps the folder and clears "reconnect".
    await t.pg.query(
      `UPDATE google_drive SET folder_id = 'F', folder_name = 'Calls' WHERE user_id = $1`,
      [ALICE],
    );
    f.refresh = { status: 200, body: { access_token: 'at-3', expires_in: 3600 } };
    await connect(d);
    const status = await (await handleStatus(get('/api/google/status'), d)).json();
    expect(status).toMatchObject({ status: 'connected', folder: { id: 'F', name: 'Calls' } });
    expect(
      await (await handleAccessToken(get('/api/google/access-token'), d)).json(),
    ).toMatchObject({
      accessToken: 'at-3',
    });
  });

  it('is rate-limited, and 401 signed out, 404 not connected', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { tokenLimit: 1 });
    expect((await handleAccessToken(get('/api/google/access-token'), d)).status).toBe(404);
    expect((await handleAccessToken(get('/api/google/access-token'), d)).status).toBe(429);
    expect(
      (await handleAccessToken(get('/api/google/access-token'), deps('signed-out', f))).status,
    ).toBe(401);
  });
});

describe('folder, settings and disconnect', () => {
  it('stores the folder as Drive describes it, refuses POSTs from other sites, validates addresses', async () => {
    const f = fakes();
    const d = deps(ALICE, f);
    await connect(d);
    expect(
      (
        await handleFolder(
          post('/api/google/folder', { folderId: 'FOLDER1' }, 'https://evil.example'),
          d,
        )
      ).status,
    ).toBe(403);
    const picked = await handleFolder(post('/api/google/folder', { folderId: 'FOLDER1' }), d);
    expect(await picked.json()).toMatchObject({ folder: { id: 'FOLDER1', name: 'Team calls' } });
    expect(
      (await handleSettings(post('/api/google/settings', { alsoNotify: ['not-an-address'] }), d))
        .status,
    ).toBe(400);
    await handleSettings(
      post('/api/google/settings', {
        alsoNotify: ['Team@Example.test', 'team@example.test'],
        emailEnabled: false,
      }),
      d,
    );
    const status = await (await handleStatus(get('/api/google/status'), d)).json();
    expect(status.email).toMatchObject({ enabled: false, alsoNotify: ['team@example.test'] });
  });

  it('revokes at Google and deletes the row', async () => {
    const f = fakes();
    const d = deps(ALICE, f);
    await connect(d);
    const out = await handleDisconnect(post('/api/google/disconnect', {}), d);
    expect(await out.json()).toEqual({ revoked: true });
    const revoke = f.calls.find((c) => c.url.includes('/revoke'))!;
    expect(new URLSearchParams(String(revoke.init?.body)).get('token')).toBe(
      'refresh-secret-value',
    );
    expect((await t.pg.query('SELECT 1 FROM google_drive')).rows).toHaveLength(0);
  });
});

describe('one email per session', () => {
  it('sends once; a repeat sends nothing; Retry works only after a failure', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    await connect(d);
    const mailCount = () => f.mail.length;
    f.smtpError = 'ETIMEDOUT';
    const first = await handleNotify(post('/api/drive/notify', NOTIFY), d);
    expect(await first.json()).toEqual({ status: 'failed' });
    const again = await handleNotify(post('/api/drive/notify', { ...NOTIFY, title: 'Changed' }), d);
    expect(await again.json()).toEqual({ status: 'failed' });
    expect(mailCount()).toBe(1);

    f.smtpError = null;
    const retried = await handleRetry(post('/api/drive/notifications', { sessionId: S1 }), d);
    expect(await retried.json()).toEqual({ status: 'sent' });
    expect((await handleRetry(post('/api/drive/notifications', { sessionId: S1 }), d)).status).toBe(
      404,
    );
    expect(mailCount()).toBe(2);
    expect(new Set(f.mail.map((m) => m.messageId)).size).toBe(2);
    expect(f.mail[0]!.messageId).toMatch(/^<kite-drive-saved\.[0-9a-f]{40}\.1@example\.test>$/);

    const list = await (await handleNotifications(get('/api/drive/notifications'), d)).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      sessionId: S1,
      // The latest report's title (the repeat above renamed it); still one email.
      title: 'Changed',
      status: 'sent',
      recipients: 1,
    });
    const stored = (await t.pg.query<{ content: string }>('SELECT content FROM drive_notification'))
      .rows[0]!;
    expect(stored.content).not.toContain('Acme');
  });

  it('stays inert without SMTP settings, and is "off" when switched off', async () => {
    const f = fakes();
    await connect(deps(ALICE, f));
    const inert = await handleNotify(post('/api/drive/notify', NOTIFY), deps(ALICE, f));
    expect(await inert.json()).toEqual({ status: 'not-set-up' });
    await connect(deps(BOB, f));
    await handleSettings(post('/api/google/settings', { emailEnabled: false }), deps(BOB, f));
    const off = await handleNotify(
      post('/api/drive/notify', NOTIFY),
      deps(BOB, f, { email: true }),
    );
    expect(await off.json()).toEqual({ status: 'off' });
    expect(f.mail).toHaveLength(0);
    const status = await (await handleStatus(get('/api/google/status'), deps(ALICE, f))).json();
    expect(status.email.configured).toBe(false);
  });

  it('sends to the person and the session override instead of the Settings list', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    await connect(d);
    await handleSettings(post('/api/google/settings', { alsoNotify: ['team@example.test'] }), d);
    await handleNotify(
      post('/api/drive/notify', { ...NOTIFY, alsoNotify: ['lead@example.test'] }),
      d,
    );
    expect(f.mail[0]!.to).toEqual([`${ALICE}@example.test`, 'lead@example.test']);
  });

  it('refuses a notification that is not the structured shape', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    await connect(d);
    const extra = await handleNotify(
      post('/api/drive/notify', { ...NOTIFY, transcript: 'words' }),
      d,
    );
    expect(extra.status).toBe(400);
    const badLink = await handleNotify(
      post('/api/drive/notify', { ...NOTIFY, folderUrl: 'https://evil.example/x' }),
      d,
    );
    expect(badLink.status).toBe(400);
  });
});

describe('test email', () => {
  it('goes to the signed-in person only, says nothing about calls, and is rate-limited', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    const sent = await handleTestEmail(post('/api/drive/test-email', {}), d);
    expect(await sent.json()).toEqual({ status: 'sent' });
    expect(f.mail).toHaveLength(1);
    expect(f.mail[0]!.to).toEqual([`${ALICE}@example.test`]);
    expect(f.mail[0]!.subject).toBe('Paramount AI test email');
    expect((await handleTestEmail(post('/api/drive/test-email', {}), d)).status).toBe(429);
    expect(f.mail).toHaveLength(1);
  });

  it('says why it failed, refuses other sites, and needs SMTP settings', async () => {
    const f = fakes();
    f.smtpError = 'EAUTH';
    expect(
      await (
        await handleTestEmail(post('/api/drive/test-email', {}), deps(ALICE, f, { email: true }))
      ).json(),
    ).toEqual({ status: 'failed', reason: 'rejected' });
    expect(
      (
        await handleTestEmail(
          post('/api/drive/test-email', {}, 'https://evil.example'),
          deps(BOB, f, { email: true }),
        )
      ).status,
    ).toBe(403);
    expect((await handleTestEmail(post('/api/drive/test-email', {}), deps(BOB, f))).status).toBe(
      409,
    );
  });
});

/** A recording the desktop app makes: one part with a stereo file. */
const REC = '22222222-2222-4222-8222-222222222222';

/** The browser's report: the transcript, and the recording the account knows the session has. */
const FROM_BROWSER: DriveNotifyRequest = {
  ...NOTIFY,
  files: [
    {
      name: '2026-11-11 14.30 Transcript.txt',
      folder: 'Transcripts',
      key: 'call:1:transcript-txt',
      fileId: 'TXT0000001',
      kind: 'transcript-txt',
    },
  ],
  expectedRecordings: [{ id: REC, part: 1, stereo: true }],
};

/** The desktop app's report: the recording part and its stereo file. */
const FROM_DESKTOP: DriveNotifyRequest = {
  ...NOTIFY,
  files: [
    {
      name: 'p1.mkv',
      folder: 'Recordings',
      key: `rec:${REC}:main`,
      fileId: 'REC0000001',
      kind: 'recording',
      part: 1,
    },
    {
      name: 'p1 stereo.webm',
      folder: 'Recordings',
      key: `rec:${REC}:stereo`,
      fileId: 'STE0000001',
      kind: 'stereo',
      part: 1,
    },
  ],
  expectedRecordings: [{ id: REC, part: 1, stereo: true }],
};

describe('one complete email per session (1.6.0)', () => {
  it('waits for the recording, then sends ONE email with every file linked', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    await connect(d);
    const first = await handleNotify(post('/api/drive/notify', FROM_BROWSER), d);
    expect(await first.json()).toEqual({ status: 'collecting' });
    expect(f.mail).toHaveLength(0);
    // Only the main file: still waiting for the stereo file.
    const half = { ...FROM_DESKTOP, files: [FROM_DESKTOP.files[0]!] };
    expect(await (await handleNotify(post('/api/drive/notify', half), d)).json()).toEqual({
      status: 'collecting',
    });
    const done = await handleNotify(post('/api/drive/notify', FROM_DESKTOP), d);
    expect(await done.json()).toEqual({ status: 'sent' });
    expect(f.mail).toHaveLength(1);
    for (const link of ['REC0000001', 'STE0000001', 'TXT0000001']) {
      expect(f.mail[0]!.text).toContain(`https://drive.google.com/file/d/${link}/view`);
    }
    expect(f.mail[0]!.text).not.toContain('Recording upload pending');
    // A restart reporting everything again sends nothing.
    await handleNotify(post('/api/drive/notify', FROM_DESKTOP), d);
    await handleNotify(post('/api/drive/notify', FROM_BROWSER), d);
    expect(f.mail).toHaveLength(1);
  });

  it('sends after 24 hours without the recording, saying it is pending', async () => {
    const f = fakes();
    await connect(deps(ALICE, f));
    await handleNotify(post('/api/drive/notify', FROM_BROWSER), deps(ALICE, f, { email: true }));
    expect(f.mail).toHaveLength(0);
    const later = deps(ALICE, f, { email: true, now: Date.now() + 25 * 3_600_000 });
    const list = await (await handleNotifications(get('/api/drive/notifications'), later)).json();
    expect(f.mail).toHaveLength(1);
    expect(f.mail[0]!.text).toContain('Recording upload pending');
    expect(list.items[0]).toMatchObject({ status: 'sent', recordingPending: true });
    // The recording arriving later is recorded, but no second email.
    await handleNotify(post('/api/drive/notify', FROM_DESKTOP), later);
    expect(f.mail).toHaveLength(1);
  });

  it('never emails a "manual only" session by itself; Send email sends it with every link', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    await connect(d);
    const out = await handleNotify(
      post('/api/drive/notify', { ...FROM_DESKTOP, manualOnly: true }),
      d,
    );
    expect(await out.json()).toEqual({ status: 'not-set-up' });
    expect(f.mail).toHaveLength(0);
    const sent = await handleRetry(post('/api/drive/notifications', { sessionId: S1 }), d);
    expect(await sent.json()).toEqual({ status: 'sent' });
    expect(f.mail[0]!.text).toContain('https://drive.google.com/file/d/REC0000001/view');
  });

  it('runs the daily job only with CRON_SECRET, for every account', async () => {
    const f = fakes();
    await connect(deps(ALICE, f));
    await handleNotify(post('/api/drive/notify', FROM_BROWSER), deps(ALICE, f, { email: true }));
    const cron = (secret: string | undefined, header?: string) =>
      handleFlushCron(
        new Request(`${SITE}/api/cron/drive-flush`, {
          headers: header ? { authorization: header } : {},
        }),
        deps('signed-out', f, { email: true, cron: secret, now: Date.now() + 25 * 3_600_000 }),
      );
    expect((await cron(undefined, 'Bearer x')).status).toBe(404);
    expect((await cron('s'.repeat(20), 'Bearer wrong')).status).toBe(401);
    expect(f.mail).toHaveLength(0);
    const ok = await cron('s'.repeat(20), `Bearer ${'s'.repeat(20)}`);
    expect(await ok.json()).toEqual({ checked: 1 });
    expect(f.mail).toHaveLength(1);
    expect(f.mail[0]!.to).toEqual([`${ALICE}@example.test`]);
  });
});

describe('one email per call (ADR-0073: a session started again)', () => {
  /** The same session's second call, an hour later, with its own transcript. */
  const SECOND_CALL: DriveNotifyRequest = {
    ...NOTIFY,
    callStartedAt: NOTIFY.callStartedAt + 3_600_000,
    durationMs: 20 * 60_000,
    files: [{ name: '2026-11-11 15.30 Transcript.txt', folder: 'Transcripts' }],
  };

  it('sends each call its own email, once; the first call reported again sends nothing', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    await connect(d);
    expect(await (await handleNotify(post('/api/drive/notify', NOTIFY), d)).json()).toEqual({
      status: 'sent',
    });
    expect(await (await handleNotify(post('/api/drive/notify', SECOND_CALL), d)).json()).toEqual({
      status: 'sent',
    });
    expect(f.mail).toHaveLength(2);
    // Each email holds only its own call's files.
    expect(f.mail[0]!.text).toContain('14.30 Transcript.txt');
    expect(f.mail[0]!.text).not.toContain('15.30 Transcript.txt');
    expect(f.mail[1]!.text).toContain('15.30 Transcript.txt');
    expect(f.mail[1]!.text).not.toContain('14.30 Transcript.txt');
    // Two different messages.
    expect(new Set(f.mail.map((m) => m.messageId)).size).toBe(2);
    // Reports repeated after a restart send nothing more.
    await handleNotify(post('/api/drive/notify', NOTIFY), d);
    await handleNotify(post('/api/drive/notify', SECOND_CALL), d);
    expect(f.mail).toHaveLength(2);

    const list = await (await handleNotifications(get('/api/drive/notifications'), d)).json();
    expect(
      (list.items as { sessionId: string; call: number | null }[])
        .map((item) => [item.sessionId, item.call])
        .sort(),
    ).toEqual([
      [S1, null],
      [S1, SECOND_CALL.callStartedAt],
    ]);
  });

  it('retries a later call’s failed email by its call, leaving the first call’s alone', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    await connect(d);
    await handleNotify(post('/api/drive/notify', NOTIFY), d);
    f.smtpError = 'ETIMEDOUT';
    expect(await (await handleNotify(post('/api/drive/notify', SECOND_CALL), d)).json()).toEqual({
      status: 'failed',
    });
    f.smtpError = null;
    // The first call's email was sent: nothing to retry there.
    expect((await handleRetry(post('/api/drive/notifications', { sessionId: S1 }), d)).status).toBe(
      404,
    );
    const retried = await handleRetry(
      post('/api/drive/notifications', { sessionId: S1, call: SECOND_CALL.callStartedAt }),
      d,
    );
    expect(await retried.json()).toEqual({ status: 'sent' });
    expect(f.mail.at(-1)!.text).toContain('15.30 Transcript.txt');
  });
});

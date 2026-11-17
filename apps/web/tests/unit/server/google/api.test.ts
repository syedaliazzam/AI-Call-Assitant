/**
 * Tests for apps/web/src/server/google/api.ts, company.ts, tokens.ts, uploads.ts and store.ts (ADR-0072,
 * ADR-0073, ADR-0074), with a real Postgres in memory (PGlite, every committed migration), invented
 * accounts, fresh test data keys, a fake Google (OAuth, a fake company Drive) and a fake SMTP mailer:
 * - ADR-0074: only an admin connects the company account; its refresh token is stored ENCRYPTED in
 *   drive_company with the account's address; a callback without the cookie or for another account
 *   stores nothing; a refused refresh marks "reconnect" for everyone and later calls do not reach Google;
 *   connecting again keeps the folder; only an admin picks the folder (checked with the company token) or
 *   disconnects (revoke, then delete); everyone keeps their own switches and team list (drive_member);
 * - NO ROUTE RETURNS A TOKEN: the session folders are made by the server, tagged per account and session;
 *   a recording upload returns only its session address and a ticket bound to the account; the offset and
 *   the completion need that ticket; a file that does not verify (size, MD5, tag) goes to the bin; the
 *   page's small files are uploaded by the server (MD5 checked, at most 4 MB);
 * - notify links only Drive ids the company token finds with this account's tag;
 * - POSTs from another site are refused; signed-out is 401; the routes are rate-limited; a page opened for
 *   another account (ACCOUNT_HEADER, privacy fix of 14 Nov 2026) is refused with 409;
 * - one email per call: a repeated notify sends nothing; without SMTP settings it is "not-set-up"; switched
 *   off it is "off"; a failed email can be retried, with a new Message-ID; the test email goes to the
 *   signed-in person only and is rate-limited;
 * - ADR-0073: each call of a session (one started again) has its own email, listed and retried by call;
 * - ADR-0077 (two-step rule): email 1 "Call saved" as soon as the transcript and notes are in ("Recording:
 *   uploading…"), email 2 "Recording saved" when the recording is (never when it was in email 1),
 *   "Recording not uploaded" after 24 hours, "manual only" ignored; a failed email is listed with Retry and
 *   tried again by itself an hour later (never an older call's);
 * - ADR-0097: each person's session folders go in ONE folder of their own in the company folder (named
 *   after their display name, made once, shared with them only, never with anyone else); a session folder
 *   from before (still in the company folder itself) is found and used where it is; call-access shares
 *   the person's own folder; the one-time move (secret-only, dry run by default) moves each folder into
 *   its proven owner's folder with the same id, removes the per-session share, leaves unmatched folders,
 *   and replies with counts only; Settings' my-folder gives the person's own folder only (none before it
 *   exists), read-only.
 */
import { createHash } from 'node:crypto';
import { ACCOUNT_HEADER, DRIVE_SCOPE, type DriveNotifyRequest } from '@kite/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleCallAccess,
  handleCallback,
  handleConnect,
  handleDisconnect,
  handleFolder,
  handleMyFolder,
  handleNotifications,
  handleNotify,
  handlePickerConfig,
  handleRetry,
  handleSessionFolder,
  handleSettings,
  handleSmallUpload,
  handleStatus,
  handleFlushCron,
  handleTestEmail,
  handleUploadComplete,
  handleUploadOffset,
  handleUploadStart,
  type GoogleDeps,
} from '@/server/google/api';
import type { OutgoingEmail } from '@/server/google/email';
import { createRateLimiter } from '@/server/google/rateLimit';
import { forgetCompanyToken } from '@/server/google/tokens';
import { handleMoveToUserFolders } from '@/server/google/move';
import {
  UNNAMED_USER_FOLDER,
  fileTag,
  folderTags,
  userFolderName,
  userFolderTags,
} from '@/server/google/uploads';
import { ALICE, BOB, createTestDb, type TestDb } from '../calldata/pgliteDb';

// The real sign-in, database and environment modules need production settings; these tests pass their
// own dependencies (GoogleDeps), so the modules are replaced by empty stand-ins.
vi.mock('@/server/auth', () => ({ auth: {} }));
vi.mock('@/server/db', () => ({ db: {} }));

/** The test site's address. */
const SITE = 'https://kite.example';

/** An invented session id. */
const S1 = '11111111-1111-4111-8111-111111111111';

/** A recording the desktop app makes: one part with a stereo file. */
const REC = '22222222-2222-4222-8222-222222222222';

/** The company folder the fake Drive has. */
const COMPANY_FOLDER = 'FOLDER1';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await t.pg.exec(
    'DELETE FROM drive_company; DELETE FROM drive_member; DELETE FROM drive_notification; DELETE FROM call_record;',
  );
  forgetCompanyToken();
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

/** A file or folder in the fake company Drive. */
interface FakeFile {
  /** Its id. */
  id: string;
  /** Its name. */
  name: string;
  /** Its folder. */
  parent: string;
  /** Its type. */
  mimeType: string;
  /** Its tags. */
  appProperties: Record<string, string>;
  /** Its size (files). */
  size?: number;
  /** Its MD5 (files). */
  md5?: string;
  /** In the bin. */
  trashed: boolean;
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
  /** The fake company Drive. */
  files: Map<string, FakeFile>;
  /** Its resumable upload sessions, by address. */
  uploads: Map<string, { file: Omit<FakeFile, 'id'>; bytes: number; got: number }>;
  /** Its id counter. */
  n: number;
  /** ADR-0096: Viewer permissions the fake Drive was asked to add (folder, address, notification email). */
  shares: { fileId: string; email: string; role: string; notify: string | null }[];
  /** ADR-0096: the status the fake Drive answers a permission request with (200 grants). */
  shareStatus: number;
  /** ADR-0097: the status the fake Drive answers a move with (200 moves). */
  moveStatus: number;
}

/**
 * Adds a file to the fake Drive, tagged as Kite tags it for an account's session.
 * @param f      The fakes.
 * @param id     Its id.
 * @param key    Its stable key.
 * @param userId The account.
 */
function seed(f: Fakes, id: string, key: string, userId = ALICE): void {
  f.files.set(id, {
    id,
    name: key,
    parent: 'somewhere',
    mimeType: 'text/plain',
    appProperties: { kiteFile: fileTag(userId, S1, key).value },
    size: 10,
    trashed: false,
  });
}

/**
 * A file as Drive's API describes it.
 * @param file The fake file.
 * @returns Its JSON.
 */
function described(file: FakeFile) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    appProperties: file.appProperties,
    trashed: file.trashed,
    ...(file.size !== undefined ? { size: String(file.size) } : {}),
    ...(file.md5 ? { md5Checksum: file.md5 } : {}),
  };
}

/**
 * The fake Drive API.
 * @param f    The fakes.
 * @param url  The address.
 * @param init The request.
 * @returns The reply.
 */
async function fakeDrive(f: Fakes, url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET';
  const address = new URL(url);
  if (address.pathname === '/drive/v3/about') {
    return Response.json({ user: { emailAddress: 'Company@Example.test' } });
  }
  if (address.pathname === '/drive/v3/files' && method === 'GET') {
    const q = address.searchParams.get('q') ?? '';
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    const tags = [...q.matchAll(/key='([^']+)' and value='([^']+)'/g)];
    const matches = [...f.files.values()].filter(
      (file) =>
        !file.trashed &&
        file.parent === parent &&
        tags.every(([, key, value]) => file.appProperties[key!] === value),
    );
    // ADR-0097: a listing (the move) asks for every match with its tags.
    if (address.searchParams.get('pageSize') !== '1') {
      return Response.json({
        files: matches.map((file) => ({ id: file.id, appProperties: file.appProperties })),
      });
    }
    const found = matches[0];
    return Response.json({ files: found ? [{ id: found.id }] : [] });
  }
  if (address.pathname === '/drive/v3/files' && method === 'POST') {
    const meta = JSON.parse(String(init?.body)) as {
      name: string;
      mimeType: string;
      parents: string[];
      appProperties: Record<string, string>;
    };
    const id = `FILE${String(++f.n).padStart(6, '0')}`;
    f.files.set(id, {
      id,
      name: meta.name,
      parent: meta.parents[0]!,
      mimeType: meta.mimeType,
      appProperties: meta.appProperties,
      trashed: false,
    });
    return Response.json({ id });
  }
  const fileId = /^\/drive\/v3\/files\/([^/]+)$/.exec(address.pathname)?.[1];
  if (fileId) {
    const file = f.files.get(decodeURIComponent(fileId));
    if (!file) return new Response('{}', { status: 404 });
    // ADR-0097: a move names its new and old parent; any other PATCH here is the bin.
    if (method === 'PATCH' && address.searchParams.get('addParents')) {
      if (f.moveStatus !== 200) return new Response('{}', { status: f.moveStatus });
      if (file.parent !== address.searchParams.get('removeParents')) {
        return new Response('{}', { status: 400 });
      }
      file.parent = address.searchParams.get('addParents')!;
    } else if (method === 'PATCH') {
      file.trashed = true;
    }
    return Response.json(described(file));
  }
  // ADR-0096: a Viewer permission on a folder.
  const permissionsOf = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(address.pathname)?.[1];
  // ADR-0097: a folder's shares, as Drive lists them.
  if (permissionsOf && method === 'GET') {
    const fileId = decodeURIComponent(permissionsOf);
    return Response.json({
      permissions: f.shares
        .filter((share) => share.fileId === fileId)
        .map((share) => ({
          id: `P-${share.email}`,
          type: 'user',
          role: share.role,
          emailAddress: share.email,
        })),
    });
  }
  const permission = /^\/drive\/v3\/files\/([^/]+)\/permissions\/([^/]+)$/.exec(address.pathname);
  if (permission && method === 'DELETE') {
    const fileId = decodeURIComponent(permission[1]!);
    const email = decodeURIComponent(permission[2]!).replace(/^P-/, '');
    f.shares = f.shares.filter((share) => !(share.fileId === fileId && share.email === email));
    return new Response(null, { status: 204 });
  }
  if (permissionsOf && method === 'POST') {
    if (f.shareStatus !== 200) return new Response('{}', { status: f.shareStatus });
    const body = JSON.parse(String(init?.body)) as { role: string; emailAddress: string };
    // Sharing again with someone who already has it changes nothing (as in Drive).
    const fileId = decodeURIComponent(permissionsOf);
    if (f.shares.some((share) => share.fileId === fileId && share.email === body.emailAddress)) {
      return Response.json({ id: 'perm' });
    }
    f.shares.push({
      fileId: decodeURIComponent(permissionsOf),
      email: body.emailAddress,
      role: body.role,
      notify: address.searchParams.get('sendNotificationEmail'),
    });
    return Response.json({ id: 'perm' });
  }
  if (address.pathname === '/upload/drive/v3/files' && method === 'POST') {
    const type = address.searchParams.get('uploadType');
    if (type === 'resumable') {
      const meta = JSON.parse(String(init?.body)) as {
        name: string;
        parents: string[];
        appProperties: Record<string, string>;
      };
      const headers = init?.headers as Record<string, string>;
      const location = `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${++f.n}`;
      f.uploads.set(location, {
        file: {
          name: meta.name,
          parent: meta.parents[0]!,
          mimeType: headers['X-Upload-Content-Type']!,
          appProperties: meta.appProperties,
          trashed: false,
        },
        bytes: Number(headers['X-Upload-Content-Length']),
        got: 0,
      });
      return new Response(null, { status: 200, headers: { Location: location } });
    }
    // multipart: the metadata part, then the bytes.
    const boundary = /boundary=(.+)$/.exec(
      (init?.headers as Record<string, string>)['Content-Type']!,
    )![1]!;
    const text = Buffer.from(init?.body as Buffer).toString('latin1');
    const parts = text.split(`--${boundary}`);
    const meta = JSON.parse(parts[1]!.split('\r\n\r\n')[1]!.trim()) as {
      name: string;
      parents: string[];
      appProperties: Record<string, string>;
    };
    const content = parts[2]!.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
    const bytes = Buffer.from(content, 'latin1');
    const id = `FILE${String(++f.n).padStart(6, '0')}`;
    const file: FakeFile = {
      id,
      name: meta.name,
      parent: meta.parents[0]!,
      mimeType: 'text/plain',
      appProperties: meta.appProperties,
      size: bytes.byteLength,
      md5: createHash('md5').update(bytes).digest('hex'),
      trashed: false,
    };
    f.files.set(id, file);
    return Response.json(described(file));
  }
  if (f.uploads.has(url) && method === 'PUT') {
    const session = f.uploads.get(url)!;
    return new Response(null, {
      status: 308,
      headers: session.got ? { Range: `bytes=0-${session.got - 1}` } : {},
    });
  }
  throw new Error(`unexpected Drive request ${method} ${address.pathname}`);
}

/**
 * Finishes an upload in the fake Drive, as the desktop shell's last chunk would.
 * @param f     The fakes.
 * @param url   The session address.
 * @param bytes The file's bytes.
 * @returns The file's id.
 */
function finishUpload(f: Fakes, url: string, bytes: Buffer): string {
  const session = f.uploads.get(url)!;
  const id = `FILE${String(++f.n).padStart(6, '0')}`;
  f.files.set(id, {
    ...session.file,
    id,
    size: bytes.byteLength,
    md5: createHash('md5').update(bytes).digest('hex'),
  });
  f.uploads.delete(url);
  return id;
}

/**
 * Dependencies for one signed-in account.
 * @param user    Who is signed in.
 * @param fakes   The fake replies.
 * @param options email: SMTP configured; admin (default: ALICE is, BOB is not); limits; clock; cron.
 * @returns The dependencies.
 */
function deps(
  user: string | 'signed-out',
  fakes: Fakes,
  options: {
    email?: boolean;
    admin?: boolean;
    uploadLimit?: number;
    now?: number;
    cron?: string;
  } = {},
): GoogleDeps {
  return {
    user: async () =>
      user === 'signed-out'
        ? user
        : {
            id: user,
            email: `${user}@example.test`,
            // As the test database names it.
            name: user,
            admin: options.admin ?? user === ALICE,
          },
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
      if (url.startsWith('https://www.googleapis.com/')) return fakeDrive(fakes, url, init);
      throw new Error(`unexpected request to ${url}`);
    },
    mailer: async (_config, message) => {
      fakes.mail.push(message);
      if (fakes.smtpError) throw Object.assign(new Error('refused'), { code: fakes.smtpError });
    },
    cronSecret: () => options.cron ?? null,
    now: () => options.now ?? Date.now(),
    limits: {
      upload: createRateLimiter(options.uploadLimit ?? 100, 60_000),
      other: createRateLimiter(100, 60_000),
      test: createRateLimiter(1, 60_000),
    },
  };
}

/**
 * Fresh fake replies, with the company folder and the files the email tests report.
 * @returns Fakes that succeed.
 */
function fakes(): Fakes {
  const f: Fakes = {
    calls: [],
    refresh: { status: 200, body: { access_token: 'at-2', expires_in: 3600 } },
    smtpError: null,
    mail: [],
    files: new Map(),
    uploads: new Map(),
    n: 0,
    shares: [],
    shareStatus: 200,
    moveStatus: 200,
  };
  f.files.set(COMPANY_FOLDER, {
    id: COMPANY_FOLDER,
    name: 'Team calls',
    parent: 'root',
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: {},
    trashed: false,
  });
  seed(f, 'TXT0000001', 'call:1:transcript-txt');
  seed(f, 'REC0000001', `rec:${REC}:main`);
  seed(f, 'STE0000001', `rec:${REC}:stereo`);
  return f;
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
 * Connects the company account through connect + callback, as an admin's browser would.
 * @param d The dependencies (an admin's).
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

/**
 * Connects the company account and picks the company folder (an admin).
 * @param f The fakes.
 * @returns When done.
 */
async function setUp(f: Fakes): Promise<void> {
  const admin = deps(ALICE, f);
  await connect(admin);
  await handleFolder(post('/api/google/folder', { folderId: COMPANY_FOLDER }), admin);
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

describe('the company account (admins only)', () => {
  it('stores the refresh token encrypted with the account, and sends the admin to pick the folder', async () => {
    const f = fakes();
    const d = deps(ALICE, f);
    const started = await handleConnect(get('/api/google/connect'), d);
    expect(started.status).toBe(302);
    expect(started.headers.get('set-cookie')).toMatch(
      /HttpOnly; SameSite=Lax; Max-Age=600; Secure/,
    );
    const done = await connect(d);
    expect(done.headers.get('location')).toBe(`${SITE}/settings?drive=pick#google-drive`);
    const row = (
      await t.pg.query<{ refresh_token: string; status: string; account_email: string }>(
        'SELECT refresh_token, status, account_email FROM drive_company',
      )
    ).rows[0]!;
    expect(row.status).toBe('connected');
    expect(row.account_email).toBe('company@example.test');
    expect(row.refresh_token).not.toContain('refresh-secret-value');
    // The admin sees the account; everyone sees the connection.
    const forAdmin = await (await handleStatus(get('/api/google/status'), d)).json();
    expect(forAdmin).toMatchObject({
      configured: true,
      status: 'connected',
      folder: null,
      admin: true,
      account: 'company@example.test',
      saveEnabled: true,
    });
    const forBob = await (await handleStatus(get('/api/google/status'), deps(BOB, f))).json();
    expect(forBob).toMatchObject({ status: 'connected', admin: false, account: null });
  });

  it('refuses a person who is not an admin, and stores nothing for a bad callback', async () => {
    const f = fakes();
    const notAdmin = await handleConnect(get('/api/google/connect'), deps(BOB, f));
    expect(notAdmin.headers.get('location')).toContain('reason=admin-only');
    const started = await handleConnect(get('/api/google/connect'), deps(ALICE, f));
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    const cookie = started.headers.get('set-cookie')!.split(';')[0]!;
    const noCookie = await handleCallback(
      get(`/api/google/callback?code=c&state=${state}`),
      deps(ALICE, f),
    );
    expect(noCookie.headers.get('location')).toContain('reason=state-invalid');
    const otherAdmin = await handleCallback(
      get(`/api/google/callback?code=c&state=${state}`, cookie),
      deps(BOB, f, { admin: true }),
    );
    expect(otherAdmin.headers.get('location')).toContain('reason=state-account');
    expect((await t.pg.query('SELECT 1 FROM drive_company')).rows).toHaveLength(0);
    expect(f.calls.some((call) => call.url.includes('/token'))).toBe(false);
  });

  it('marks "reconnect" when Google refuses the token, for everyone; connecting again keeps the folder', async () => {
    const f = fakes();
    await setUp(f);
    f.refresh = { status: 400, body: { error: 'invalid_grant' } };
    forgetCompanyToken();
    const refused = await handleSessionFolder(
      post('/api/drive/session-folder', { sessionId: S1, name: 'Session' }),
      deps(BOB, f),
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'reconnect' });
    expect(
      (await (await handleStatus(get('/api/google/status'), deps(BOB, f))).json()).status,
    ).toBe('reconnect');
    const refreshes = () =>
      f.calls.filter(
        (c) => new URLSearchParams(String(c.init?.body)).get('grant_type') === 'refresh_token',
      ).length;
    const before = refreshes();
    await handleSessionFolder(
      post('/api/drive/session-folder', { sessionId: S1, name: 'Session' }),
      deps(BOB, f),
    );
    expect(refreshes()).toBe(before);
    f.refresh = { status: 200, body: { access_token: 'at-3', expires_in: 3600 } };
    await connect(deps(ALICE, f));
    const status = await (await handleStatus(get('/api/google/status'), deps(BOB, f))).json();
    expect(status).toMatchObject({ status: 'connected', folder: { id: COMPANY_FOLDER } });
  });

  it('lets only an admin pick the folder (checked with the company token) or disconnect', async () => {
    const f = fakes();
    await connect(deps(ALICE, f));
    expect(
      (await handleFolder(post('/api/google/folder', { folderId: COMPANY_FOLDER }), deps(BOB, f)))
        .status,
    ).toBe(403);
    expect(
      (
        await handleFolder(
          post('/api/google/folder', { folderId: COMPANY_FOLDER }, 'https://evil.example'),
          deps(ALICE, f),
        )
      ).status,
    ).toBe(403);
    // A folder the company account cannot open (picked while signed in to another account).
    expect(
      (await handleFolder(post('/api/google/folder', { folderId: 'NOT-SHARED' }), deps(ALICE, f)))
        .status,
    ).toBe(404);
    const picked = await handleFolder(
      post('/api/google/folder', { folderId: COMPANY_FOLDER }),
      deps(ALICE, f),
    );
    expect(await picked.json()).toMatchObject({
      folder: { id: COMPANY_FOLDER, name: 'Team calls' },
    });
    // The Picker's settings: admins only, and no token in them.
    expect((await handlePickerConfig(get('/api/google/picker-config'), deps(BOB, f))).status).toBe(
      403,
    );
    const config = await (
      await handlePickerConfig(get('/api/google/picker-config'), deps(ALICE, f))
    ).json();
    expect(config).toEqual({
      apiKey: 'pk',
      appId: '123',
      clientId: 'cid',
      account: 'company@example.test',
    });
    expect((await handleDisconnect(post('/api/google/disconnect', {}), deps(BOB, f))).status).toBe(
      403,
    );
    const out = await handleDisconnect(post('/api/google/disconnect', {}), deps(ALICE, f));
    expect(await out.json()).toEqual({ revoked: true });
    const revoke = f.calls.find((c) => c.url.includes('/revoke'))!;
    expect(new URLSearchParams(String(revoke.init?.body)).get('token')).toBe(
      'refresh-secret-value',
    );
    expect((await t.pg.query('SELECT 1 FROM drive_company')).rows).toHaveLength(0);
  });

  it('keeps each person’s own switches and team list, with no connection of their own', async () => {
    const f = fakes();
    const d = deps(BOB, f);
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
    expect(status.saveEnabled).toBe(true);
    // ALICE's are her own.
    const alice = await (await handleStatus(get('/api/google/status'), deps(ALICE, f))).json();
    expect(alice.email).toMatchObject({ enabled: true, alsoNotify: [] });
  });
});

describe('server-side uploads: no token reaches a client (ADR-0074)', () => {
  /** A recording file's key. */
  const KEY = `rec:${REC}:main`;
  /** Its invented bytes. */
  const BYTES = Buffer.alloc(1_000, 7);

  it('makes the session folders once, tagged to the account and session (another person gets their own)', async () => {
    const f = fakes();
    await setUp(f);
    const body = { sessionId: S1, name: '2026-11-11 Acme – Engineer' };
    const first = await (
      await handleSessionFolder(post('/api/drive/session-folder', body), deps(BOB, f))
    ).json();
    const again = await (
      await handleSessionFolder(post('/api/drive/session-folder', body), deps(BOB, f))
    ).json();
    expect(again).toEqual(first);
    // ADR-0097: in BOB's own folder, which is in the company folder.
    const own = f.files.get(f.files.get(first.folderId)!.parent)!;
    expect(own.parent).toBe(COMPANY_FOLDER);
    expect(own.appProperties).toEqual({
      kiteOwner: userFolderTags(BOB)[0]!.value,
      kiteFolder: 'user',
    });
    expect(f.files.get(first.recordingsId)!.parent).toBe(first.folderId);
    // The same session id from another account never reaches BOB's folders.
    const other = await (
      await handleSessionFolder(post('/api/drive/session-folder', body), deps(ALICE, f))
    ).json();
    expect(other.folderId).not.toBe(first.folderId);
    // Nothing in any reply is a token.
    expect(JSON.stringify([first, other])).not.toMatch(/at-\d|refresh-secret-value/);
  });

  it('starts an upload with only its address and a ticket, resumes and verifies it', async () => {
    const f = fakes();
    await setUp(f);
    const d = deps(BOB, f);
    await handleSessionFolder(post('/api/drive/session-folder', { sessionId: S1, name: 'S' }), d);
    const start = {
      sessionId: S1,
      key: KEY,
      name: 'Part 1.mkv',
      mimeType: 'video/x-matroska',
      bytes: BYTES.byteLength,
    };
    const started = await (await handleUploadStart(post('/api/drive/uploads', start), d)).json();
    expect(started).toMatchObject({ status: 'started' });
    expect(Object.keys(started).sort()).toEqual(['status', 'ticket', 'uploadUrl']);
    expect(JSON.stringify(started)).not.toMatch(/at-\d|refresh-secret-value/);
    // Where it got to: only with this account's ticket for this address.
    const where = await handleUploadOffset(
      post('/api/drive/uploads/offset', { uploadUrl: started.uploadUrl, ticket: started.ticket }),
      d,
    );
    expect(await where.json()).toEqual({ state: 'partial', offset: 0 });
    const stolen = await handleUploadOffset(
      post('/api/drive/uploads/offset', { uploadUrl: started.uploadUrl, ticket: started.ticket }),
      deps(ALICE, f),
    );
    expect(stolen.status).toBe(403);
    // The shell finishes it; the server verifies size, MD5 and tag.
    const fileId = finishUpload(f, started.uploadUrl, BYTES);
    const md5 = createHash('md5').update(BYTES).digest('hex');
    const done = await handleUploadComplete(
      post('/api/drive/uploads/complete', {
        uploadUrl: started.uploadUrl,
        ticket: started.ticket,
        fileId,
        md5,
      }),
      d,
    );
    expect(await done.json()).toEqual({ fileId });
    // Asked again (a restart): it is already there.
    expect(await (await handleUploadStart(post('/api/drive/uploads', start), d)).json()).toEqual({
      status: 'exists',
      fileId,
    });
  });

  it('bins a finished file that does not verify, so it is uploaded again', async () => {
    const f = fakes();
    await setUp(f);
    const d = deps(BOB, f);
    await handleSessionFolder(post('/api/drive/session-folder', { sessionId: S1, name: 'S' }), d);
    const start = {
      sessionId: S1,
      key: KEY,
      name: 'Part 1.mkv',
      mimeType: 'video/x-matroska',
      bytes: BYTES.byteLength,
    };
    const started = await (await handleUploadStart(post('/api/drive/uploads', start), d)).json();
    // Fewer bytes arrived than the ticket says.
    const fileId = finishUpload(f, started.uploadUrl, BYTES.subarray(0, 10));
    const bad = await handleUploadComplete(
      post('/api/drive/uploads/complete', {
        uploadUrl: started.uploadUrl,
        ticket: started.ticket,
        fileId,
      }),
      d,
    );
    expect(bad.status).toBe(409);
    expect(await bad.json()).toMatchObject({ code: 'verify_failed' });
    expect(f.files.get(fileId)!.trashed).toBe(true);
    // Another file's id with this ticket is refused (and not binned: not this upload's).
    const other = await handleUploadComplete(
      post('/api/drive/uploads/complete', {
        uploadUrl: started.uploadUrl,
        ticket: started.ticket,
        fileId: 'TXT0000001',
      }),
      d,
    );
    expect(other.status).toBe(409);
    expect(f.files.get('TXT0000001')!.trashed).toBe(false);
    // The next start makes a new upload.
    expect(
      await (await handleUploadStart(post('/api/drive/uploads', start), d)).json(),
    ).toMatchObject({ status: 'started' });
  });

  it('uploads the page’s small files itself, checking the bytes, at most 4 MB', async () => {
    const f = fakes();
    await setUp(f);
    const d = deps(BOB, f);
    /**
     * A multipart request for one small file.
     * @param key   The file's key.
     * @param bytes Its bytes.
     * @returns The request.
     */
    const form = (key: string, bytes: Uint8Array) => {
      const body = new FormData();
      body.set('sessionId', S1);
      body.set('key', key);
      body.set('name', 'Transcript.txt');
      // A copy on a plain ArrayBuffer (what Blob accepts in the DOM types).
      body.set('file', new Blob([new Uint8Array(bytes)]), 'Transcript.txt');
      return new Request(`${SITE}/api/drive/files`, {
        method: 'POST',
        headers: { origin: SITE },
        body,
      });
    };
    const key = 'call:1794389400000:transcript-txt';
    // The session folder first.
    expect((await handleSmallUpload(form(key, Buffer.from('lines')), d)).status).toBe(409);
    await handleSessionFolder(post('/api/drive/session-folder', { sessionId: S1, name: 'S' }), d);
    const saved = await (await handleSmallUpload(form(key, Buffer.from('lines')), d)).json();
    const file = f.files.get(saved.fileId)!;
    expect(file.size).toBe(5);
    expect(file.appProperties.kiteFile).toBe(fileTag(BOB, S1, key).value);
    // Again: the same file, never a second copy.
    expect(await (await handleSmallUpload(form(key, Buffer.from('lines')), d)).json()).toEqual(
      saved,
    );
    expect((await handleSmallUpload(form('rec:x:main', Buffer.from('x')), d)).status).toBe(400);
    expect(
      (await handleSmallUpload(form('call:1:notes-pdf', Buffer.alloc(4 * 1024 * 1024 + 1)), d))
        .status,
    ).toBe(413);
    // ADR-0093: replace=1 (a renamed call's PDFs) saves the new copy, then moves the old one to the bin.
    const again = form(key, Buffer.from('renamed'));
    const body = await again.formData();
    body.set('replace', '1');
    const replaced = await (
      await handleSmallUpload(
        new Request(`${SITE}/api/drive/files`, { method: 'POST', headers: { origin: SITE }, body }),
        d,
      )
    ).json();
    expect(replaced.fileId).not.toBe(saved.fileId);
    expect(f.files.get(replaced.fileId)!.size).toBe(7);
    expect(f.files.get(replaced.fileId)!.trashed).toBe(false);
    expect(f.files.get(saved.fileId)!.trashed).toBe(true);
  });

  it('links in the email only Drive ids the company token finds with this account’s tag', async () => {
    const f = fakes();
    await setUp(f);
    const d = deps(ALICE, f, { email: true });
    await handleNotify(
      post('/api/drive/notify', {
        ...NOTIFY,
        files: [
          {
            name: 'Ours.txt',
            folder: 'Transcripts',
            key: 'call:1:transcript-txt',
            fileId: 'TXT0000001',
            kind: 'transcript-txt',
          },
          {
            name: 'Forged.txt',
            folder: 'Transcripts',
            key: 'call:1:notes-pdf',
            fileId: 'SOMEONEELSE',
            kind: 'notes-pdf',
          },
        ],
      }),
      d,
    );
    expect(f.mail).toHaveLength(1);
    expect(f.mail[0]!.text).toContain('https://drive.google.com/file/d/TXT0000001/view');
    expect(f.mail[0]!.text).not.toContain('SOMEONEELSE');
    expect(f.mail[0]!.text).toContain('Forged.txt');
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

  it('refuses a page opened for another account (privacy fix of 14 Nov 2026): 409, nothing sent', async () => {
    const f = fakes();
    // A window of Bob's, still open after Alice signed in on the same browser profile.
    const stale = new Request(`${SITE}/api/drive/test-email`, {
      method: 'POST',
      headers: { origin: SITE, 'content-type': 'application/json', [ACCOUNT_HEADER]: BOB },
      body: '{}',
    });
    const refused = await handleTestEmail(stale, deps(ALICE, f, { email: true }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'account_changed' });
    expect(f.mail).toHaveLength(0);
    const status = await handleStatus(
      new Request(`${SITE}/api/google/status`, { headers: { [ACCOUNT_HEADER]: BOB } }),
      deps(ALICE, f),
    );
    expect(status.status).toBe(409);
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
    // ADR-0080: the main file is all it waits for, though this (older) page says the part has a stereo
    // file: the email goes.
    const main = { ...FROM_DESKTOP, files: [FROM_DESKTOP.files[0]!] };
    const done = await handleNotify(post('/api/drive/notify', main), d);
    expect(await done.json()).toEqual({ status: 'sent' });
    expect(f.mail).toHaveLength(1);
    for (const link of ['REC0000001', 'TXT0000001']) {
      expect(f.mail[0]!.text).toContain(`https://drive.google.com/file/d/${link}/view`);
    }
    expect(f.mail[0]!.text).not.toContain('Recording upload pending');
    // A restart reporting everything again (an older page with its stereo file too) sends nothing.
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

describe('two emails per call (ADR-0077)', () => {
  /** The call's Transcripts files are in; a recording is expected on the office laptop. */
  const CALL_FILES: DriveNotifyRequest = {
    ...FROM_BROWSER,
    emailRule: 'two-step',
    callFilesSaved: true,
    recordingsFolderUrl: 'https://drive.google.com/drive/folders/RECFOLDER1',
    expectedRecordings: [{ id: REC, part: 1, stereo: true, deviceName: 'Office laptop' }],
  };
  /** Later: the recording's files are in too. */
  const ALL_FILES: DriveNotifyRequest = {
    ...CALL_FILES,
    files: [...FROM_BROWSER.files, ...FROM_DESKTOP.files],
  };

  it('sends "Call saved" once the transcript is in, then "Recording saved" once, and never a third', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    await connect(d);
    // The Transcripts files not all in yet: nothing goes.
    const early = await handleNotify(
      post('/api/drive/notify', { ...CALL_FILES, callFilesSaved: false }),
      d,
    );
    expect(await early.json()).toEqual({ status: 'collecting' });
    expect(f.mail).toHaveLength(0);
    expect(await (await handleNotify(post('/api/drive/notify', CALL_FILES), d)).json()).toEqual({
      status: 'sent',
    });
    expect(f.mail).toHaveLength(1);
    expect(f.mail[0]!.subject).toBe('Call saved — Acme – Backend Engineer');
    expect(f.mail[0]!.text).toContain('Recording: uploading…');
    expect(f.mail[0]!.text).toContain(
      'Recordings folder: https://drive.google.com/drive/folders/RECFOLDER1',
    );
    expect(f.mail[0]!.text).toContain('https://drive.google.com/file/d/TXT0000001/view');
    // ADR-0080: the main video is in: "Recording saved" goes, though this (older) page says the part has
    // a stereo file (it is never waited for).
    const main = { ...ALL_FILES, files: [...FROM_BROWSER.files, FROM_DESKTOP.files[0]!] };
    await handleNotify(post('/api/drive/notify', main), d);
    expect(f.mail).toHaveLength(2);
    expect(f.mail[1]!.subject).toBe('Recording saved — Acme – Backend Engineer');
    expect(f.mail[1]!.text).toContain('https://drive.google.com/file/d/REC0000001/view');
    expect(f.mail[1]!.text).not.toContain('STE0000001');
    expect(f.mail[1]!.text).not.toContain('TXT0000001');
    expect(f.mail[0]!.messageId).not.toBe(f.mail[1]!.messageId);
    // Reports repeated after a restart (one with the older page's stereo file too) send nothing more.
    await handleNotify(post('/api/drive/notify', ALL_FILES), d);
    await handleNotify(post('/api/drive/notify', CALL_FILES), d);
    expect(f.mail).toHaveLength(2);
    const list = await (await handleNotifications(get('/api/drive/notifications'), d)).json();
    expect(
      (list.items as { kind: string; status: string; call: number | null }[])
        .map((item) => [item.kind, item.status, item.call])
        .sort(),
    ).toEqual([
      ['call', 'sent', CALL_FILES.callStartedAt],
      ['recording', 'sent', CALL_FILES.callStartedAt],
    ]);
  });

  it('sends one email when the recording is already in, and ignores "manual only"', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    await connect(d);
    const out = await handleNotify(
      post('/api/drive/notify', { ...ALL_FILES, manualOnly: true }),
      d,
    );
    expect(await out.json()).toEqual({ status: 'sent' });
    expect(f.mail).toHaveLength(1);
    expect(f.mail[0]!.subject.startsWith('Call saved')).toBe(true);
    expect(f.mail[0]!.text).not.toContain('Recording: uploading');
    expect(f.mail[0]!.text).toContain('https://drive.google.com/file/d/REC0000001/view');
    const list = await (await handleNotifications(get('/api/drive/notifications'), d)).json();
    expect(list.items).toHaveLength(1);
  });

  it('says "Recording not uploaded" on the named computer after 24 hours', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    await connect(d);
    await handleNotify(post('/api/drive/notify', CALL_FILES), d);
    expect(f.mail).toHaveLength(1);
    const later = deps(ALICE, f, { email: true, now: Date.now() + 25 * 3_600_000 });
    await handleNotifications(get('/api/drive/notifications'), later);
    expect(f.mail).toHaveLength(2);
    expect(f.mail[1]!.subject).toBe('Recording not uploaded — Acme – Backend Engineer');
    expect(f.mail[1]!.text).toContain('Open Paramount AI on Office laptop');
    // The recording arriving afterwards sends nothing more.
    await handleNotify(post('/api/drive/notify', ALL_FILES), later);
    expect(f.mail).toHaveLength(2);
  });

  it('records a failed email with Retry, and tries it again by itself an hour later; older calls never', async () => {
    const f = fakes();
    const d = deps(ALICE, f, { email: true });
    await connect(d);
    f.smtpError = 'EAUTH';
    expect(await (await handleNotify(post('/api/drive/notify', CALL_FILES), d)).json()).toEqual({
      status: 'failed',
    });
    // An older call (the single email) fails too.
    const older: DriveNotifyRequest = {
      ...NOTIFY,
      callStartedAt: NOTIFY.callStartedAt - 86_400_000,
    };
    await handleNotify(post('/api/drive/notify', older), d);
    expect(f.mail).toHaveLength(2);
    let list = await (await handleNotifications(get('/api/drive/notifications'), d)).json();
    const failed = (items: { status: string }[]) => items.filter((i) => i.status === 'failed');
    expect(failed(list.items)).toHaveLength(2);
    f.smtpError = null;
    // Half an hour later: not yet.
    const soon = deps(ALICE, f, { email: true, now: Date.now() + 30 * 60_000 });
    await handleNotifications(get('/api/drive/notifications'), soon);
    expect(f.mail).toHaveLength(2);
    // An hour later: the new call's email goes by itself; the older call's waits for Retry.
    const hour = deps(ALICE, f, { email: true, now: Date.now() + 61 * 60_000 });
    list = await (await handleNotifications(get('/api/drive/notifications'), hour)).json();
    expect(f.mail).toHaveLength(3);
    expect(f.mail[2]!.subject.startsWith('Call saved')).toBe(true);
    expect(failed(list.items)).toHaveLength(1);
    // Email 2 waits for the recording; failed, it is retried by its kind.
    f.smtpError = 'ETIMEDOUT';
    await handleNotify(post('/api/drive/notify', ALL_FILES), hour);
    f.smtpError = null;
    const retried = await handleRetry(
      post('/api/drive/notifications', {
        sessionId: S1,
        call: CALL_FILES.callStartedAt,
        recording: true,
      }),
      hour,
    );
    expect(await retried.json()).toEqual({ status: 'sent' });
    expect(f.mail.at(-1)!.subject.startsWith('Recording saved')).toBe(true);
  });
});

describe('the Meetings library: Viewer access to the person’s own folder (ADR-0096)', () => {
  /** A notify body with a verified recording link for ALICE's S1. */
  const WITH_RECORDING: DriveNotifyRequest = {
    ...NOTIFY,
    files: [
      {
        name: '2026-11-11 14.30 Part 1.mkv',
        folder: 'Recordings',
        key: `rec:${REC}:main`,
        fileId: 'REC0000001',
        kind: 'recording',
        part: 1,
      },
    ],
  };

  it('shares the person’s own session folder as Viewer, without Google’s email, and lists the call’s files', async () => {
    const f = fakes();
    await setUp(f);
    const alice = deps(ALICE, f);
    const made = await handleSessionFolder(
      post('/api/drive/session-folder', { sessionId: S1, name: 'Session' }),
      alice,
    );
    const { folderId } = (await made.json()) as { folderId: string };
    await handleNotify(post('/api/drive/notify', WITH_RECORDING), alice);

    const response = await handleCallAccess(
      post('/api/drive/call-access', { sessionId: S1, callStartedAt: NOTIFY.callStartedAt }),
      alice,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.access).toBe('viewer');
    expect(body.folderUrl).toBe(`https://drive.google.com/drive/folders/${folderId}`);
    expect(body.files).toEqual([
      {
        kind: 'recording',
        part: 1,
        name: '2026-11-11 14.30 Part 1.mkv',
        url: 'https://drive.google.com/file/d/REC0000001/view',
      },
    ]);
    // ADR-0097: one share, on ALICE's own folder (the session folder's parent), never the session folder.
    const own = f.files.get(folderId)!.parent;
    expect(own).not.toBe(COMPANY_FOLDER);
    expect(f.shares).toEqual([
      { fileId: own, email: `${ALICE}@example.test`, role: 'reader', notify: 'false' },
    ]);

    // Another call of the same session has none of these files.
    const other = await handleCallAccess(
      post('/api/drive/call-access', { sessionId: S1, callStartedAt: NOTIFY.callStartedAt + 1 }),
      alice,
    );
    expect((await other.json()).files).toEqual([]);
  });

  it('never reaches another person’s folder or files, even with the same session id', async () => {
    const f = fakes();
    await setUp(f);
    const alice = deps(ALICE, f);
    await handleSessionFolder(
      post('/api/drive/session-folder', { sessionId: S1, name: 'Session' }),
      alice,
    );
    await handleNotify(post('/api/drive/notify', WITH_RECORDING), alice);

    const response = await handleCallAccess(
      post('/api/drive/call-access', { sessionId: S1, callStartedAt: NOTIFY.callStartedAt }),
      deps(BOB, f),
    );
    expect(await response.json()).toEqual({ folderUrl: null, access: 'none', files: [] });
    // Only ALICE's own folder was ever shared, and only with ALICE.
    expect(f.shares.map((share) => share.email)).toEqual([`${ALICE}@example.test`]);
  });

  it('says "refused" when Google will not share with the address', async () => {
    const f = fakes();
    await setUp(f);
    const alice = deps(ALICE, f);
    await handleSessionFolder(
      post('/api/drive/session-folder', { sessionId: S1, name: 'Session' }),
      alice,
    );
    f.shareStatus = 400;
    const response = await handleCallAccess(
      post('/api/drive/call-access', { sessionId: S1, callStartedAt: NOTIFY.callStartedAt }),
      alice,
    );
    const body = await response.json();
    expect(body.access).toBe('refused');
    expect(body.folderUrl).toMatch(/^https:[/][/]drive[.]google[.]com[/]drive[/]folders[/]/);
  });

  it('refuses signed-out, another site and a bad body', async () => {
    const f = fakes();
    await setUp(f);
    const request = { sessionId: S1, callStartedAt: NOTIFY.callStartedAt };
    expect(
      (await handleCallAccess(post('/api/drive/call-access', request), deps('signed-out', f)))
        .status,
    ).toBe(401);
    expect(
      (
        await handleCallAccess(
          post('/api/drive/call-access', request, 'https://evil.example'),
          deps(ALICE, f),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleCallAccess(
          post('/api/drive/call-access', { ...request, folderId: 'X' }),
          deps(ALICE, f),
        )
      ).status,
    ).toBe(400);
  });
});

describe('one Drive folder per person (ADR-0097)', () => {
  /** A second invented session id. */
  const S2 = '33333333-3333-4333-8333-333333333333';

  /**
   * Adds a session folder made before ADR-0097: in the company folder itself, tagged to its account,
   * and (as ADR-0096 did) shared with that person on its own.
   * @param f       The fakes.
   * @param id      Its id.
   * @param userId  The account.
   * @param session The session.
   */
  function legacyFolder(f: Fakes, id: string, userId: string, session: string): void {
    const tags = Object.fromEntries(
      folderTags(userId, session, 'session').map((tag) => [tag.key, tag.value]),
    );
    f.files.set(id, {
      id,
      name: `Session ${id}`,
      parent: COMPANY_FOLDER,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: tags,
      trashed: false,
    });
    f.shares.push({ fileId: id, email: `${userId}@example.test`, role: 'reader', notify: 'false' });
  }

  /**
   * Records a synced session for an account (ids only, as the move reads them).
   * @param userId  The account.
   * @param session The session.
   */
  async function syncedSession(userId: string, session: string): Promise<void> {
    await t.pg.query(`INSERT INTO call_record (user_id, kind, id) VALUES ($1, 'session', $2)`, [
      userId,
      session,
    ]);
  }

  /**
   * The person's own folder, if any.
   * @param f      The fakes.
   * @param userId The account.
   * @returns The folder.
   */
  function ownFolder(f: Fakes, userId: string): FakeFile | undefined {
    const value = userFolderTags(userId)[0]!.value;
    return [...f.files.values()].find((file) => file.appProperties.kiteOwner === value);
  }

  /** The move's secret in the tests. */
  const MOVE_SECRET = 'm'.repeat(40);

  /**
   * A request to the one-time move.
   * @param body   The body.
   * @param secret The secret sent.
   * @returns The request.
   */
  function moveRequest(body: unknown, secret = MOVE_SECRET): Request {
    return new Request(`${SITE}/api/cron/drive-user-folders`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('names a folder after the display name, cleaned', () => {
    expect(userFolderName('  Sara\u0007  Khan ')).toBe('Sara Khan');
    expect(userFolderName('\u0000 ')).toBe(UNNAMED_USER_FOLDER);
    expect(userFolderName('x'.repeat(300))).toHaveLength(100);
  });

  it('makes one folder per person, the first time, shared only with them; never another person’s', async () => {
    const f = fakes();
    await setUp(f);
    const bob = deps(BOB, f);
    await handleSessionFolder(post('/api/drive/session-folder', { sessionId: S1, name: 'A' }), bob);
    await handleSessionFolder(post('/api/drive/session-folder', { sessionId: S2, name: 'B' }), bob);
    const folders = [...f.files.values()].filter(
      (file) => file.appProperties.kiteFolder === 'user',
    );
    expect(folders).toHaveLength(1);
    expect(folders[0]!.name).toBe(BOB);
    expect(folders[0]!.parent).toBe(COMPANY_FOLDER);
    // Both sessions inside it; the company folder never shared; BOB only, Viewer, no email.
    const sessions = [...f.files.values()].filter(
      (file) => file.appProperties.kiteFolder === 'session',
    );
    expect(sessions.map((file) => file.parent)).toEqual([folders[0]!.id, folders[0]!.id]);
    expect(f.shares).toEqual([
      { fileId: folders[0]!.id, email: `${BOB}@example.test`, role: 'reader', notify: 'false' },
    ]);
    expect(ownFolder(f, ALICE)).toBeUndefined();
  });

  it('keeps using a session folder made before, where it is', async () => {
    const f = fakes();
    await setUp(f);
    legacyFolder(f, 'OLDFOLDER1', BOB, S1);
    const bob = deps(BOB, f);
    const made = await (
      await handleSessionFolder(
        post('/api/drive/session-folder', { sessionId: S1, name: 'A' }),
        bob,
      )
    ).json();
    expect(made.folderId).toBe('OLDFOLDER1');
    expect(f.files.get('OLDFOLDER1')!.parent).toBe(COMPANY_FOLDER);
    // Its subfolders are found inside it, so uploads still land there.
    expect(f.files.get(made.transcriptsId)!.parent).toBe('OLDFOLDER1');
    // Call-access shares that folder by itself (as before) until it is moved.
    const access = await (
      await handleCallAccess(
        post('/api/drive/call-access', { sessionId: S1, callStartedAt: NOTIFY.callStartedAt }),
        bob,
      )
    ).json();
    expect(access.folderUrl).toBe('https://drive.google.com/drive/folders/OLDFOLDER1');
    expect(access.access).toBe('viewer');
  });

  it('moves each folder into its owner’s folder (dry run first), with the same id, counts only', async () => {
    const f = fakes();
    await setUp(f);
    legacyFolder(f, 'OLDALICE01', ALICE, S1);
    legacyFolder(f, 'OLDALICE02', ALICE, S2);
    legacyFolder(f, 'OLDBOB0001', BOB, S1);
    // A folder no known session matches.
    legacyFolder(f, 'ORPHAN0001', 'user-gone', S1);
    await syncedSession(ALICE, S1);
    await syncedSession(BOB, S1);
    // S2 of ALICE is known from a transcript line's session only.
    await t.pg.query(
      `INSERT INTO call_record (user_id, kind, id, session_id) VALUES ($1, 'utterance', 'u1', $2)`,
      [ALICE, S2],
    );
    const md = { google: deps(ALICE, f), secret: () => MOVE_SECRET };

    const dry = await handleMoveToUserFolders(moveRequest({}), md);
    expect(dry.status).toBe(200);
    const plan = await dry.json();
    expect(plan).toEqual({
      mode: 'dry-run',
      sessionFolders: 4,
      matched: 3,
      unmatched: 1,
      users: [
        { user: 1, folders: 2, hasOwnFolder: false },
        { user: 2, folders: 1, hasOwnFolder: false },
      ],
    });
    // Nothing changed, and the reply names no one and no folder.
    expect(f.files.get('OLDALICE01')!.parent).toBe(COMPANY_FOLDER);
    expect(ownFolder(f, ALICE)).toBeUndefined();
    expect(JSON.stringify(plan)).not.toMatch(/user-alice|user-bob|OLDALICE|OLDBOB|ORPHAN|example/);

    const applied = await (await handleMoveToUserFolders(moveRequest({ apply: true }), md)).json();
    expect(applied.applied).toEqual({
      moved: 3,
      failed: 0,
      sharesRemoved: 3,
      sharesKept: 0,
      userFoldersMade: 2,
      shareRefused: 0,
      remaining: 0,
    });
    const alice = ownFolder(f, ALICE)!;
    const bob = ownFolder(f, BOB)!;
    expect(f.files.get('OLDALICE01')!.parent).toBe(alice.id);
    expect(f.files.get('OLDALICE02')!.parent).toBe(alice.id);
    expect(f.files.get('OLDBOB0001')!.parent).toBe(bob.id);
    expect(f.files.get('ORPHAN0001')!.parent).toBe(COMPANY_FOLDER);
    // One share per person, on their own folder; the per-session shares are gone (the orphan keeps its).
    expect(f.shares.map((share) => [share.fileId, share.email]).sort()).toEqual(
      [
        [alice.id, `${ALICE}@example.test`],
        [bob.id, `${BOB}@example.test`],
        ['ORPHAN0001', 'user-gone@example.test'],
      ].sort(),
    );
    // Run again: nothing left to move.
    const again = await (await handleMoveToUserFolders(moveRequest({ apply: true }), md)).json();
    expect(again).toMatchObject({ matched: 0, unmatched: 1, applied: { moved: 0, remaining: 0 } });
    // The moved folder is still found for its owner (same id, so links still open).
    const access = await (
      await handleCallAccess(
        post('/api/drive/call-access', { sessionId: S1, callStartedAt: NOTIFY.callStartedAt }),
        deps(BOB, f),
      )
    ).json();
    expect(access.folderUrl).toBe('https://drive.google.com/drive/folders/OLDBOB0001');
  });

  it('moves in batches, and puts a share back when a move fails', async () => {
    const f = fakes();
    await setUp(f);
    legacyFolder(f, 'OLDALICE01', ALICE, S1);
    legacyFolder(f, 'OLDALICE02', ALICE, S2);
    await syncedSession(ALICE, S1);
    await syncedSession(ALICE, S2);
    const md = { google: deps(ALICE, f), secret: () => MOVE_SECRET };
    const first = await (
      await handleMoveToUserFolders(moveRequest({ apply: true, limit: 1 }), md)
    ).json();
    expect(first.applied).toMatchObject({ moved: 1, remaining: 1 });
    f.moveStatus = 403;
    const second = await (await handleMoveToUserFolders(moveRequest({ apply: true }), md)).json();
    expect(second.applied).toMatchObject({ moved: 0, failed: 1 });
    // The folder that did not move keeps its own share.
    const stuck = [...f.files.values()].find((file) => file.parent === COMPANY_FOLDER)!;
    expect(f.shares.some((share) => share.fileId === stuck.id)).toBe(true);
  });

  it('gives Settings the person’s own folder only, and none before it exists', async () => {
    const f = fakes();
    await setUp(f);
    const bob = deps(BOB, f);
    expect(await (await handleMyFolder(get('/api/drive/my-folder'), bob)).json()).toEqual({
      url: null,
    });
    await handleSessionFolder(post('/api/drive/session-folder', { sessionId: S1, name: 'A' }), bob);
    const own = ownFolder(f, BOB)!;
    expect(await (await handleMyFolder(get('/api/drive/my-folder'), bob)).json()).toEqual({
      url: `https://drive.google.com/drive/folders/${own.id}`,
    });
    // ALICE has none yet: never BOB's.
    expect(
      await (await handleMyFolder(get('/api/drive/my-folder'), deps(ALICE, f))).json(),
    ).toEqual({ url: null });
    // Nothing was made or shared by asking.
    expect(f.shares).toHaveLength(1);
    expect((await handleMyFolder(get('/api/drive/my-folder'), deps('signed-out', f))).status).toBe(
      401,
    );
  });

  it('is closed without the secret, and refuses a wrong one', async () => {
    const f = fakes();
    await setUp(f);
    expect(
      (
        await handleMoveToUserFolders(moveRequest({}), {
          google: deps(ALICE, f),
          secret: () => null,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await handleMoveToUserFolders(moveRequest({}, 'x'.repeat(40)), {
          google: deps(ALICE, f),
          secret: () => MOVE_SECRET,
        })
      ).status,
    ).toBe(401);
  });
});

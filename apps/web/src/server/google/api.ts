/**
 * File: apps/web/src/server/google/api.ts
 * Purpose: The /api/google/* and /api/drive/* handlers. ADR-0074: ONE company Google account, connected
 *          by an admin (OAuth with a signed, account-bound state and PKCE; the callback stores its refresh
 *          token encrypted); its folder picked by an admin in Google Picker (the Picker's token comes from
 *          Google to the admin's browser, never from here) and checked with Drive; disconnect (revoke,
 *          then delete). NO ROUTE EVER RETURNS A GOOGLE TOKEN: the server makes each session's folders,
 *          starts each recording upload and gives the client only that upload's session address with a
 *          signed ticket, answers where an upload got to, verifies a finished one (tag, size, MD5), and
 *          uploads the page's own small files itself. Also status, each person's switches and team list,
 *          and the "saved" email (one per call, ADR-0073; only Drive ids the company token can verify are
 *          linked) with its list and Retry. ADR-0077: calls ended from 13 Nov 2026 get two emails ("Call
 *          saved" once the transcript and notes are in, "Recording saved" once the recording is), and a
 *          failed email of theirs is tried again by itself, an hour apart, for three days. The account always comes from the signed-in session, read from
 *          the database, never from the request. POSTs must come from a Kite address (Origin check) on
 *          top of the SameSite session cookie.
 * Used by: app/api/google/{connect,callback,status,picker-config,folder,settings,disconnect}/route.ts,
 *          app/api/drive/{session-folder,uploads,uploads/offset,uploads/complete,files,notify,
 *          notifications,test-email}/route.ts, app/api/cron/drive-flush/route.ts
 * Depends on: zod, @kite/shared, src/server/auth.ts, src/server/db.ts, src/server/env.ts,
 *             src/server/calldata/crypto.ts,
 *             src/server/google/{company,config,oauth,store,tokens,uploads,email,rateLimit,report}.ts
 * Architecture: ADR-0074 (ADR-0072, ADR-0073); architecture §7.2, §8.1, §8.2
 *
 * Logs carry the route and a status or code only: never tokens, ids, addresses, titles or file names.
 */
import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  DRIVE_NOTIFICATIONS_SHOWN,
  MAX_ALSO_NOTIFY,
  MAX_EMAIL_CHARS,
  MAX_SAVED_FILES,
  MAX_SAVED_NAME_CHARS,
  driveFolderUrl,
  isDriveLink,
  type DriveNotificationItem,
  type DriveNotificationStatus,
  type DriveNotificationsResponse,
  type DriveNotifyResponse,
  type DrivePickerConfig,
  type DriveSessionFolderResponse,
  type DriveStatusResponse,
  type DriveTestEmailResponse,
  type DriveUploadOffsetResponse,
  type DriveUploadStartResponse,
  type DriveVerifiedFile,
} from '@kite/shared';
import { auth } from '../auth';
import { DataKeyError, dataKeys, type DataKeys } from '../calldata/crypto';
import type { CallDataDb } from '../calldata/store';
import { db } from '../db';
import {
  deleteCompany,
  getCompany,
  type CompanyConnectionRow,
  getMember,
  readCompanyToken,
  saveCompany,
  setCompanyFolder,
  updateMember,
} from './company';
import { getAuthEnv } from '../env';
import { emailConfig, googleConfig, type EmailConfig, type GoogleConfig } from './config';
import { emailMessageId, sendSavedEmail, sendTestEmail, smtpMailer, type Mailer } from './email';
import {
  GoogleRefusedError,
  GoogleUnavailableError,
  STATE_COOKIE,
  checkOAuthState,
  exchangeCode,
  readDriveAccount,
  readDriveFolder,
  revokeToken,
  startOAuth,
  stateKey,
  type FetchLike,
} from './oauth';
import { createRateLimiter, type RateLimiter } from './rateLimit';
import {
  claimCollecting,
  claimRetry,
  finishNotification,
  listNotifications,
  listOverdue,
  listRetryCandidates,
  readRecord,
  writeRecord,
  type NotificationContent,
  type NotificationRecord,
} from './store';
import {
  REPORT_WAIT_MS,
  emailDue,
  isComplete,
  mergeRecordingReport,
  mergeReport,
  needsRecordingEmail,
  notificationKey,
  recipientsFor,
  recordingContent,
  recordingKey,
  reportKey,
  splitNotificationKey,
} from './report';
import { companyAccessToken, forgetCompanyToken } from './tokens';
import {
  MAX_SMALL_UPLOAD_BYTES,
  TICKET_TTL_MS,
  driveServer,
  ensureSessionFolders,
  fileMatches,
  fileTag,
  findSubfolder,
  md5Hex,
  readTicket,
  signTicket,
  type DriveServer,
} from './uploads';

/** Where Settings shows the Google Drive section. */
const SETTINGS_PATH = '/settings';

/** The signed-in account, as the handlers need it. */
export interface DriveUser {
  /** The account's id. */
  id: string;
  /** Its login email (the "saved" email's first recipient). */
  email: string;
  /** True for an admin (connects the company account, picks the folder; ADR-0074). */
  admin: boolean;
}

/** What the handlers need from outside (tests replace them). */
export interface GoogleDeps {
  /** The signed-in account, or a refusal: 'signed-out' or 'password' (must change it first). */
  user(headers: Headers): Promise<DriveUser | 'signed-out' | 'password'>;
  /** The database. */
  db(): CallDataDb;
  /** The data keys (throws DataKeyError when none is set). */
  keys(): DataKeys;
  /** The Google client, or null when not configured. */
  google(): GoogleConfig | null;
  /** The email sender, or null when not configured. */
  email(): EmailConfig | null;
  /** BETTER_AUTH_SECRET (signs the OAuth state), the public address and every trusted address. */
  site(): { secret: string; baseUrl: string; trustedOrigins: string[] };
  /** The fetch for Google. */
  fetch: FetchLike;
  /** Sends email over SMTP (nodemailer; tests pass a fake). */
  mailer: Mailer;
  /** CRON_SECRET (Vercel sends it to the daily job), or null when not set. */
  cronSecret(): string | null;
  /** The clock (Unix ms). */
  now(): number;
  /** Rate limits. */
  limits: {
    /** The upload routes (folders, start, offset, complete, small files): several per file. */
    upload: RateLimiter;
    /** Every other route. */
    other: RateLimiter;
    /** The test email (a few an hour: it reaches a real mailbox). */
    test: RateLimiter;
  };
}

/** The real dependencies. */
export const realGoogleDeps: GoogleDeps = {
  async user(headers) {
    // Always the database, not the cookie cache: a disabled account is refused at once.
    const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!session) return 'signed-out';
    if (session.user.mustChangePassword) return 'password';
    return { id: session.user.id, email: session.user.email, admin: session.user.role === 'admin' };
  },
  // The app's Neon client has the common Drizzle Postgres shape the store needs.
  db: () => db as unknown as CallDataDb,
  keys: () => dataKeys(),
  google: () => googleConfig(),
  email: () => emailConfig(),
  site: () => {
    const env = getAuthEnv();
    return { secret: env.secret, baseUrl: env.baseUrl, trustedOrigins: env.trustedOrigins };
  },
  fetch: (input, init) => fetch(input, init),
  mailer: smtpMailer,
  // At least 16 characters, so a placeholder value never opens the job.
  cronSecret: () => {
    const secret = process.env.CRON_SECRET?.trim();
    return secret && secret.length >= 16 ? secret : null;
  },
  now: () => Date.now(),
  // Uploads: a few requests per file, so 240 a minute covers a backlog of sessions. Test emails: 3 in
  // 10 minutes per account.
  limits: {
    upload: createRateLimiter(240, 60_000),
    other: createRateLimiter(60, 60_000),
    test: createRateLimiter(3, 10 * 60_000),
  },
};

/**
 * A JSON error response, never cached.
 * @param status  HTTP status.
 * @param code    Machine-readable code.
 * @param message Text for the person (never a token or call data).
 * @returns The response.
 */
function failure(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * A JSON reply, never cached.
 * @param body The body.
 * @returns The response.
 */
function reply(body: unknown): Response {
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * A redirect to Settings' Google Drive section with a result for the page to show.
 * @param base   The address to redirect on.
 * @param result 'pick' (connected: open the Picker) or 'error'.
 * @param reason The error's code.
 * @param cookie A Set-Cookie value (clearing the state cookie), or null.
 * @returns The response.
 */
function toSettings(
  base: string,
  result: 'pick' | 'error',
  reason: string | null,
  cookie: string | null,
): Response {
  const url = new URL(SETTINGS_PATH, base);
  url.searchParams.set('drive', result);
  if (reason) url.searchParams.set('reason', reason);
  url.hash = 'google-drive';
  const headers = new Headers({ Location: url.toString(), 'Cache-Control': 'no-store' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

/**
 * This request's own address when it is a trusted Kite address (the custom domain or the vercel.app
 * address desktop apps use), else the public address. The OAuth redirect goes back to the address the
 * person is on, so the session and state cookies are there.
 * @param request The request.
 * @param site    The addresses.
 * @returns The origin.
 */
function siteOrigin(request: Request, site: ReturnType<GoogleDeps['site']>): string {
  const own = new URL(request.url).origin;
  return site.trustedOrigins.includes(own) ? own : site.baseUrl;
}

/**
 * Whether a POST came from a Kite page: its Origin is a trusted address. Browsers always send Origin
 * on fetch POSTs; a form posted from another site is refused even before the SameSite cookie rule.
 * @param request The request.
 * @param site    The addresses.
 * @returns True when allowed.
 */
function fromKite(request: Request, site: ReturnType<GoogleDeps['site']>): boolean {
  const origin = request.headers.get('origin');
  return !!origin && site.trustedOrigins.includes(origin);
}

/**
 * Reads one cookie from a request.
 * @param request The request.
 * @param name    The cookie's name.
 * @returns Its value, or null.
 */
function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * The state cookie's Set-Cookie value.
 * @param value  The value, or '' to clear it.
 * @param secure True on https.
 * @returns The header value.
 */
function stateCookie(value: string, secure: boolean): string {
  // Path /api/google: sent only to the callback (and connect). Lax: Google's redirect back is a
  // top-level GET, which Lax cookies go with. HttpOnly: page scripts never see the PKCE verifier.
  return [
    `${STATE_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/api/google',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${value ? 600 : 0}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** What a handler body gets. */
interface Context {
  /** The signed-in account. */
  user: DriveUser;
  /** The dependencies. */
  deps: GoogleDeps;
}

/**
 * Runs a JSON handler for a signed-in account, turning known errors into replies.
 * @param request The request.
 * @param deps    The dependencies.
 * @param route   The route's name, for the log.
 * @param options post: check Origin; limit: which rate limit counts it.
 * @param run     The handler.
 * @returns Its response, or 401, 403, 429, 503 (key or Google), 500.
 */
async function withUser(
  request: Request,
  deps: GoogleDeps,
  route: string,
  options: { post: boolean; limit: 'upload' | 'other' | 'test' },
  run: (ctx: Context) => Promise<Response>,
): Promise<Response> {
  if (options.post && !fromKite(request, deps.site())) {
    return failure(403, 'forbidden', 'Not allowed from this page.');
  }
  const user = await deps.user(request.headers);
  if (user === 'signed-out') return failure(401, 'unauthorized', 'Sign in required');
  if (user === 'password')
    return failure(403, 'password_change_required', 'Change your password first');
  if (!deps.limits[options.limit].allow(`${route}:${user.id}`)) {
    return failure(429, 'too_many', 'Too many requests. Wait a minute and try again.');
  }
  try {
    return await run({ user, deps });
  } catch (error) {
    if (error instanceof DataKeyError) {
      console.error('drive: data key unavailable', { route });
      return failure(503, 'unavailable', 'Google Drive is not available right now.');
    }
    // ADR-0074: the company folder is gone or the company account lost access to it.
    if (error instanceof GoogleUnavailableError && error.status === 404) {
      console.warn('drive: company folder gone', { route });
      return failure(409, 'folder_gone', 'The company Drive folder could not be opened.');
    }
    // A fresh company token refused: try later (a revoked token is marked at the next refresh).
    if (error instanceof GoogleRefusedError) {
      console.warn('drive: google refused', { route, code: error.code });
      return failure(503, 'google_unavailable', 'Google did not answer. Try again shortly.');
    }
    if (error instanceof GoogleUnavailableError) {
      console.warn('drive: google unavailable', { route, status: error.status });
      return failure(503, 'google_unavailable', 'Google did not answer. Try again shortly.');
    }
    // The error's name only: a database or Google message can quote values.
    console.error(`drive: ${route} failed`, {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return failure(500, 'failed', 'Something went wrong. Try again.');
  }
}

/**
 * Reads a JSON body against a schema.
 * @param request The request.
 * @param schema  The schema.
 * @returns The value, or null when it is not JSON or does not fit (never echoed back).
 */
async function readBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T> | null> {
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A list of addresses: valid, lower-case, no repeats, at most MAX_ALSO_NOTIFY. */
const addressList = z
  .array(z.email().max(MAX_EMAIL_CHARS))
  .max(MAX_ALSO_NOTIFY)
  .transform((list) => [...new Set(list.map((address) => address.trim().toLowerCase()))]);

/**
 * Drive calls with the company token, server-side only (ADR-0074), or the reply saying why not.
 * @param deps The dependencies.
 * @returns The calls and the company connection, or an error response.
 */
async function companyToken(
  deps: GoogleDeps,
): Promise<{ drive: DriveServer; company: CompanyConnectionRow } | Response> {
  const config = deps.google();
  if (!config) return failure(404, 'not_configured', 'Google Drive is not set up.');
  const company = await getCompany(deps.db());
  if (!company) {
    return failure(
      404,
      'not_connected',
      'Google Drive is not connected yet. An admin connects it.',
    );
  }
  const token = await companyAccessToken({
    db: deps.db(),
    keys: deps.keys(),
    config,
    fetch: deps.fetch,
    now: deps.now,
  });
  if (token === 'not-connected') {
    return failure(
      404,
      'not_connected',
      'Google Drive is not connected yet. An admin connects it.',
    );
  }
  if (token === 'reconnect') {
    return failure(409, 'reconnect', 'Google Drive needs an admin to reconnect it.');
  }
  return { drive: driveServer(deps.fetch, token), company };
}

/** The company folder the upload routes work in. */
interface CompanyFolder {
  /** Its Drive id. */
  folderId: string;
  /** Its Shared Drive, or null for My Drive. */
  driveId: string | null;
}

/**
 * The company Drive with a usable token AND its folder (the upload routes), or the reply saying why not.
 * @param deps The dependencies.
 * @returns Drive calls with the company token and the company folder, or an error response.
 */
async function companyDrive(
  deps: GoogleDeps,
): Promise<{ drive: DriveServer; folder: CompanyFolder } | Response> {
  const connected = await companyToken(deps);
  if (connected instanceof Response) return connected;
  const { folderId, driveId } = connected.company;
  if (!folderId) {
    return failure(409, 'no_folder', 'An admin needs to choose the company Drive folder.');
  }
  return { drive: connected.drive, folder: { folderId, driveId } };
}

/**
 * GET /api/google/status (ADR-0074): the company connection and folder, and the person's own switches.
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveStatusResponse.
 * Called from: app/api/google/status/route.ts
 */
export function handleStatus(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'status', { post: false, limit: 'other' }, async ({ user }) => {
    // Calls that waited 24 hours for a recording get their email now (cheap: an indexed query).
    if (deps.google()) await flushOverdue(deps, user.id).catch(() => 0);
    const company = deps.google() ? await getCompany(deps.db()) : null;
    const member = await getMember(deps.db(), user.id);
    const body: DriveStatusResponse = {
      configured: deps.google() !== null,
      status: company
        ? company.status === 'reconnect'
          ? 'reconnect'
          : 'connected'
        : 'not-connected',
      folder:
        company?.folderId && company.folderName
          ? {
              id: company.folderId,
              name: company.folderName,
              driveId: company.driveId,
              url: driveFolderUrl(company.folderId),
            }
          : null,
      admin: user.admin,
      // The company account's address: admins only.
      account: user.admin ? (company?.accountEmail ?? null) : null,
      saveEnabled: member.saveEnabled,
      email: {
        configured: deps.email() !== null,
        enabled: member.emailEnabled,
        alsoNotify: member.alsoNotify,
      },
    };
    return reply(body);
  });
}

/**
 * GET /api/google/connect (admins only, ADR-0074): sends the admin to Google's consent page to connect
 * the company Google account.
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 302 to Google with the state cookie set; 303 to Settings with a reason when it cannot start;
 *          303 to /login when signed out.
 * Called from: app/api/google/connect/route.ts
 */
export async function handleConnect(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  const site = deps.site();
  const origin = siteOrigin(request, site);
  const user = await deps.user(request.headers);
  if (user === 'signed-out' || user === 'password') {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/login', origin).toString() },
    });
  }
  if (!user.admin) return toSettings(origin, 'error', 'admin-only', null);
  const config = deps.google();
  if (!config) return toSettings(origin, 'error', 'not-configured', null);
  if (!deps.limits.other.allow(`connect:${user.id}`))
    return toSettings(origin, 'error', 'too-many', null);
  const start = startOAuth({
    config,
    key: stateKey(site.secret),
    userId: user.id,
    redirectUri: `${origin}/api/google/callback`,
    now: deps.now(),
  });
  console.info('drive: company connect started');
  return new Response(null, {
    status: 302,
    headers: {
      Location: start.url,
      'Set-Cookie': stateCookie(start.cookie, origin.startsWith('https:')),
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * GET /api/google/callback (admins only, ADR-0074): Google sends the admin back here. Checks the state
 * (signature, expiry, this account, the cookie's nonce), exchanges the code, stores the company account's
 * refresh token encrypted with its address, and goes to Settings to pick the folder.
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 303 to Settings (?drive=pick, or ?drive=error&reason=…).
 * Called from: app/api/google/callback/route.ts
 */
export async function handleCallback(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  const site = deps.site();
  const origin = siteOrigin(request, site);
  const clear = stateCookie('', origin.startsWith('https:'));
  const params = new URL(request.url).searchParams;
  const user = await deps.user(request.headers);
  if (user === 'signed-out' || user === 'password') {
    return toSettings(origin, 'error', 'signed-out', clear);
  }
  if (!user.admin) return toSettings(origin, 'error', 'admin-only', clear);
  const config = deps.google();
  if (!config) return toSettings(origin, 'error', 'not-configured', clear);
  const checked = checkOAuthState({
    state: params.get('state'),
    cookie: readCookie(request, STATE_COOKIE),
    key: stateKey(site.secret),
    userId: user.id,
    now: deps.now(),
  });
  if (!checked.ok) {
    console.warn('drive: callback refused', { reason: checked.reason });
    return toSettings(origin, 'error', `state-${checked.reason}`, clear);
  }
  // The admin pressed Cancel on Google's page (or Google refused): nothing is stored.
  if (params.get('error') || !params.get('code')) {
    return toSettings(origin, 'error', 'denied', clear);
  }
  try {
    const tokens = await exchangeCode(
      deps.fetch,
      config,
      params.get('code')!,
      checked.verifier,
      `${origin}/api/google/callback`,
    );
    const account = await readDriveAccount(deps.fetch, tokens.accessToken);
    await saveCompany(deps.db(), deps.keys(), tokens.refreshToken, account, user.id);
    forgetCompanyToken();
    console.info('drive: company connected');
    return toSettings(origin, 'pick', null, clear);
  } catch (error) {
    const reason =
      error instanceof GoogleRefusedError
        ? error.code === 'scope_not_granted'
          ? 'scope'
          : 'refused'
        : error instanceof DataKeyError
          ? 'unavailable'
          : 'google-unavailable';
    console.warn('drive: connect failed', { reason });
    return toSettings(origin, 'error', reason, clear);
  }
}

/**
 * GET /api/google/picker-config (admins only): the Picker's API key, project number, OAuth client id and
 * the company account's address. ADR-0074: no token: the admin's page gets its own from Google.
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DrivePickerConfig; 403 not an admin; 404 when the Picker is not set up.
 * Called from: app/api/google/picker-config/route.ts
 */
export function handlePickerConfig(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'picker', { post: false, limit: 'other' }, async ({ user }) => {
    if (!user.admin) return failure(403, 'admin_only', 'Only an admin chooses the folder.');
    const config = deps.google();
    if (!config?.pickerApiKey || !config.appId) {
      return failure(404, 'not_configured', 'Google Picker is not set up.');
    }
    const company = await getCompany(deps.db());
    return reply({
      apiKey: config.pickerApiKey,
      appId: config.appId,
      clientId: config.clientId,
      account: company?.accountEmail ?? null,
    } satisfies DrivePickerConfig);
  });
}

/** POST /api/google/folder's body. */
const folderSchema = z.object({ folderId: z.string().regex(/^[A-Za-z0-9_-]{5,200}$/) }).strict();

/**
 * POST /api/google/folder (admins only): stores the company folder picked in Google Picker, as Drive
 * describes it to the company account (so a folder picked while signed in to another account, which the
 * company account cannot open, is refused).
 * @param request The request (body: DriveFolderRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 { folder }; 400; 403 not an admin; 404 not connected or folder not found; 409 reconnect.
 * Called from: app/api/google/folder/route.ts
 */
export function handleFolder(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'folder', { post: true, limit: 'other' }, async ({ user }) => {
    if (!user.admin) return failure(403, 'admin_only', 'Only an admin chooses the folder.');
    const config = deps.google();
    if (!config) return failure(404, 'not_configured', 'Google Drive is not set up.');
    const body = await readBody(request, folderSchema);
    if (!body) return failure(400, 'invalid_request', 'folderId: invalid');
    const token = await companyAccessToken({
      db: deps.db(),
      keys: deps.keys(),
      config,
      fetch: deps.fetch,
      now: deps.now,
    });
    if (token === 'not-connected') {
      return failure(404, 'not_connected', 'Connect the company Google account first.');
    }
    if (token === 'reconnect') {
      return failure(409, 'reconnect', 'Reconnect the company Google account.');
    }
    const folder = await readDriveFolder(deps.fetch, token, body.folderId);
    if (!folder) {
      return failure(
        404,
        'folder_not_found',
        'The company account cannot open that folder. Choose it while signed in to the company account.',
      );
    }
    await setCompanyFolder(deps.db(), folder);
    console.info('drive: company folder chosen', { sharedDrive: folder.driveId !== null });
    return reply({ folder: { ...folder, url: driveFolderUrl(folder.id) } });
  });
}

/** POST /api/google/settings' body. */
const settingsSchema = z
  .object({
    saveEnabled: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
    alsoNotify: addressList.optional(),
  })
  .strict();

/**
 * POST /api/google/settings: the person's own switches and team list (ADR-0074: no connection needed).
 * @param request The request (body: DriveSettingsRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 { ok: true }; 400 (an invalid address, too many).
 * Called from: app/api/google/settings/route.ts
 */
export function handleSettings(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'settings', { post: true, limit: 'other' }, async ({ user }) => {
    const body = await readBody(request, settingsSchema);
    if (!body) {
      return failure(
        400,
        'invalid_request',
        `Check the addresses (at most ${MAX_ALSO_NOTIFY}, each a valid email).`,
      );
    }
    await updateMember(deps.db(), user.id, body);
    return reply({ ok: true });
  });
}

/**
 * POST /api/google/disconnect (admins only): revokes the company refresh token at Google and deletes the
 * connection. The row goes even when Google cannot be reached (the token then expires unused).
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 { revoked }; 403 not an admin.
 * Called from: app/api/google/disconnect/route.ts
 */
export function handleDisconnect(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'disconnect', { post: true, limit: 'other' }, async ({ user }) => {
    if (!user.admin) return failure(403, 'admin_only', 'Only an admin disconnects Google Drive.');
    const row = await getCompany(deps.db());
    let revoked = true;
    if (row) {
      let token: string | null = null;
      try {
        token = readCompanyToken(deps.keys(), row);
      } catch {
        // Unreadable (a removed key): nothing to revoke from here; the row still goes.
        revoked = false;
      }
      if (token) revoked = await revokeToken(deps.fetch, token);
      await deleteCompany(deps.db());
    }
    forgetCompanyToken();
    console.info('drive: company disconnected', { revoked });
    return reply({ revoked });
  });
}

/** A file or folder name: no control characters, bounded. */
const driveName = z
  .string()
  .min(1)
  .max(MAX_SAVED_NAME_CHARS)
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  .refine((name) => !/[\u0000-\u001f\u007f]/.test(name));

/** POST /api/drive/session-folder's body. */
const sessionFolderSchema = z.object({ sessionId: z.uuid(), name: driveName }).strict();

/**
 * POST /api/drive/session-folder (ADR-0074): finds or makes the session's folder and its Recordings and
 * Transcripts in the company folder, with the company token (server-side only). The folders' tags bind
 * them to this account and session.
 * @param request The request (body: DriveSessionFolderRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveSessionFolderResponse; 400; 404 not connected; 409 no folder, reconnect, folder gone.
 * Called from: app/api/drive/session-folder/route.ts
 */
export function handleSessionFolder(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'folders', { post: true, limit: 'upload' }, async ({ user }) => {
    const body = await readBody(request, sessionFolderSchema);
    if (!body) return failure(400, 'invalid_request', 'The session folder request is not valid.');
    const company = await companyDrive(deps);
    if (company instanceof Response) return company;
    const ids = await ensureSessionFolders(
      company.drive,
      company.folder,
      user.id,
      body.sessionId,
      body.name,
    );
    return reply(ids satisfies DriveSessionFolderResponse);
  });
}

/** The recording types a session folder takes. */
const RECORDING_TYPES = ['video/x-matroska', 'video/webm', 'audio/webm'] as const;

/** POST /api/drive/uploads' body. */
const uploadStartSchema = z
  .object({
    sessionId: z.uuid(),
    // ADR-0080: pages no longer upload the stereo file, but an older open page still may; it stays valid.
    key: z.string().regex(/^rec:[0-9a-f-]{36}:(main|stereo)$/),
    name: driveName,
    mimeType: z.enum(RECORDING_TYPES),
    // Up to 50 GB (a long screen recording); Drive's own limit is far higher.
    bytes: z
      .number()
      .int()
      .min(0)
      .max(50 * 1024 ** 3),
  })
  .strict();

/**
 * POST /api/drive/uploads (ADR-0074): one recording file. Returns the file when it is already in the
 * session's Recordings (by its tag, and the right size), else starts a resumable upload with the company
 * token and returns ONLY that upload's session address and a signed ticket for it. A file with the tag but
 * the wrong size (an earlier mismatch) goes to the bin first.
 * @param request The request (body: DriveUploadStartRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveUploadStartResponse; 400; 404 not connected; 409 no session folder, reconnect.
 * Called from: app/api/drive/uploads/route.ts
 */
export function handleUploadStart(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'upload', { post: true, limit: 'upload' }, async ({ user }) => {
    const body = await readBody(request, uploadStartSchema);
    if (!body) return failure(400, 'invalid_request', 'The upload request is not valid.');
    const company = await companyDrive(deps);
    if (company instanceof Response) return company;
    const parentId = await findSubfolder(
      company.drive,
      company.folder,
      user.id,
      body.sessionId,
      'Recordings',
    );
    if (!parentId) return failure(409, 'no_session_folder', 'The session folder is not made yet.');
    const tag = fileTag(user.id, body.sessionId, body.key);
    const existing = await company.drive.find(parentId, [tag], company.folder.driveId);
    if (existing) {
      const facts = await company.drive.file(existing);
      if (facts && fileMatches(facts, { tag: tag.value, bytes: body.bytes })) {
        return reply({ status: 'exists', fileId: existing } satisfies DriveUploadStartResponse);
      }
      await company.drive.trash(existing);
    }
    const uploadUrl = await company.drive.startUpload({
      name: body.name,
      parentId,
      mimeType: body.mimeType,
      bytes: body.bytes,
      tags: [tag],
    });
    const ticket = signTicket(deps.site().secret, user.id, uploadUrl, {
      sessionId: body.sessionId,
      key: body.key,
      bytes: body.bytes,
      tag: tag.value,
      expiresAt: deps.now() + TICKET_TTL_MS,
    });
    return reply({ status: 'started', uploadUrl, ticket } satisfies DriveUploadStartResponse);
  });
}

/** A resumable session's address, as Google gives it. */
const uploadUrlSchema = z
  .string()
  .max(2000)
  .refine((url) => url.startsWith('https://www.googleapis.com/upload/drive/v3/files?'));

/** POST /api/drive/uploads/offset's body. */
const offsetSchema = z
  .object({ uploadUrl: uploadUrlSchema, ticket: z.string().max(2000) })
  .strict();

/**
 * POST /api/drive/uploads/offset (ADR-0074): where an upload this account was given got to (a restart
 * or a resume). Only for a ticket the server signed for this account and address.
 * @param request The request (body: DriveUploadOffsetRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveUploadOffsetResponse; 400; 403 a ticket that is not this account's.
 * Called from: app/api/drive/uploads/offset/route.ts
 */
export function handleUploadOffset(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'offset', { post: true, limit: 'upload' }, async ({ user }) => {
    const body = await readBody(request, offsetSchema);
    if (!body) return failure(400, 'invalid_request', 'The upload request is not valid.');
    const ticket = readTicket(deps.site().secret, user.id, body.uploadUrl, body.ticket, deps.now());
    if (!ticket) return failure(403, 'bad_ticket', 'This upload is not yours, or it expired.');
    const company = await companyDrive(deps);
    if (company instanceof Response) return company;
    const where = await company.drive.offset(body.uploadUrl, ticket.bytes);
    return reply(where satisfies DriveUploadOffsetResponse);
  });
}

/** POST /api/drive/uploads/complete's body. */
const completeSchema = z
  .object({
    uploadUrl: uploadUrlSchema,
    ticket: z.string().max(2000),
    fileId: z.string().regex(/^[A-Za-z0-9_-]{5,200}$/),
    md5: z
      .string()
      .regex(/^[0-9a-fA-F]{32}$/)
      .optional(),
  })
  .strict();

/**
 * POST /api/drive/uploads/complete (ADR-0074): the client says an upload finished. The server reads the
 * file with the company token and accepts its id only when it carries this upload's tag, has the ticket's
 * size and (when the client sent one) the same MD5; a mismatch goes to the bin, so it is uploaded again.
 * @param request The request (body: DriveUploadCompleteRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveVerifiedFile; 400; 403 a ticket that is not this account's; 409 verify_failed.
 * Called from: app/api/drive/uploads/complete/route.ts
 */
export function handleUploadComplete(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'complete', { post: true, limit: 'upload' }, async ({ user }) => {
    const body = await readBody(request, completeSchema);
    if (!body) return failure(400, 'invalid_request', 'The upload request is not valid.');
    const ticket = readTicket(deps.site().secret, user.id, body.uploadUrl, body.ticket, deps.now());
    if (!ticket) return failure(403, 'bad_ticket', 'This upload is not yours, or it expired.');
    const company = await companyDrive(deps);
    if (company instanceof Response) return company;
    const facts = await company.drive.file(body.fileId);
    const expected = {
      tag: ticket.tag,
      bytes: ticket.bytes,
      ...(body.md5 ? { md5: body.md5 } : {}),
    };
    if (!facts || !fileMatches(facts, expected)) {
      // Our own file with the wrong bytes: binned, so the next upload starts clean.
      if (facts && facts.appProperties.kiteFile === ticket.tag) await company.drive.trash(facts.id);
      console.warn('drive: upload did not verify');
      return failure(
        409,
        'verify_failed',
        'The uploaded file did not match. It is uploaded again.',
      );
    }
    return reply({ fileId: facts.id } satisfies DriveVerifiedFile);
  });
}

/**
 * The page's own files' keys (ADR-0074: uploaded through the server). ADR-0080: pages no longer make the
 * transcript TXT, but an older open page still may, so its key stays valid.
 */
const SMALL_KEY = /^call:\d{1,15}:(transcript-txt|transcript-pdf|notes-pdf)$/;

/**
 * POST /api/drive/files (ADR-0074): one of the page's own files (a call's transcript TXT or PDF, or its
 * notes PDF), sent as multipart/form-data (sessionId, key, name, file), at most 4 MB. Uploaded to the
 * session's Transcripts with the company token; held in memory for this request only, never stored or
 * logged. Returns the file when it is already there. The upload is checked against the bytes sent (MD5).
 * @param request The request (multipart form).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveVerifiedFile; 400; 404 not connected; 409 no session folder, reconnect; 413 too large.
 * Called from: app/api/drive/files/route.ts
 */
export function handleSmallUpload(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'file', { post: true, limit: 'upload' }, async ({ user }) => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return failure(400, 'invalid_request', 'The file was not sent as a form.');
    }
    const sessionId = form.get('sessionId');
    const key = form.get('key');
    const name = form.get('name');
    const file = form.get('file');
    if (
      typeof sessionId !== 'string' ||
      !z.uuid().safeParse(sessionId).success ||
      typeof key !== 'string' ||
      !SMALL_KEY.test(key) ||
      typeof name !== 'string' ||
      !driveName.safeParse(name).success ||
      !(file instanceof Blob)
    ) {
      return failure(400, 'invalid_request', 'The file request is not valid.');
    }
    if (file.size > MAX_SMALL_UPLOAD_BYTES) {
      return failure(413, 'too_large', 'This file is too large to save to Drive.');
    }
    const company = await companyDrive(deps);
    if (company instanceof Response) return company;
    const parentId = await findSubfolder(
      company.drive,
      company.folder,
      user.id,
      sessionId,
      'Transcripts',
    );
    if (!parentId) return failure(409, 'no_session_folder', 'The session folder is not made yet.');
    const tag = fileTag(user.id, sessionId, key);
    // Already there (saved before this device lost track of it): never uploaded twice.
    const existing = await company.drive.find(parentId, [tag], company.folder.driveId);
    if (existing) return reply({ fileId: existing } satisfies DriveVerifiedFile);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const facts = await company.drive.uploadSmall(
      {
        name,
        parentId,
        mimeType: key.endsWith('-pdf') ? 'application/pdf' : 'text/plain',
        tags: [tag],
      },
      bytes,
    );
    if (!fileMatches(facts, { tag: tag.value, bytes: bytes.byteLength, md5: md5Hex(bytes) })) {
      await company.drive.trash(facts.id);
      console.warn('drive: small upload did not verify');
      return failure(502, 'verify_failed', 'Google Drive did not keep the file. Try again.');
    }
    return reply({ fileId: facts.id } satisfies DriveVerifiedFile);
  });
}

/** A Drive file id. */
const driveId = z.string().regex(/^[A-Za-z0-9_-]{5,200}$/);

/** POST /api/drive/notify's body: structured fields only, each bounded. */
const notifySchema = z
  .object({
    sessionId: z.uuid(),
    title: z.string().trim().min(1).max(MAX_SAVED_NAME_CHARS),
    callStartedAt: z.number().int().positive(),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(48 * 3_600_000),
    files: z
      .array(
        z
          .object({
            name: z.string().min(1).max(MAX_SAVED_NAME_CHARS),
            folder: z.enum(['Recordings', 'Transcripts']),
            key: z
              .string()
              .regex(/^(rec|call):[A-Za-z0-9:-]{1,120}$/)
              .optional(),
            fileId: driveId.optional(),
            kind: z
              .enum(['recording', 'stereo', 'transcript-txt', 'transcript-pdf', 'notes-pdf'])
              .optional(),
            part: z.number().int().min(1).max(999).optional(),
          })
          .strict(),
      )
      .max(MAX_SAVED_FILES),
    folderUrl: z.string().max(400).refine(isDriveLink),
    timeZone: z.string().max(64),
    alsoNotify: addressList.nullable(),
    expectedRecordings: z
      .array(
        z
          .object({
            id: z.uuid(),
            part: z.number().int().min(1).max(999),
            stereo: z.boolean(),
            // ADR-0077: the computer holding it (its name as the person set it), for email 2's fallback.
            deviceName: z.string().trim().min(1).max(80).optional(),
          })
          .strict(),
      )
      .max(MAX_SAVED_FILES),
    goneRecordings: z.array(z.uuid()).max(MAX_SAVED_FILES),
    manualOnly: z.boolean(),
    // ADR-0077: the two-step email rule, whether the Transcripts files are in, the Recordings folder.
    emailRule: z.literal('two-step').optional(),
    callFilesSaved: z.boolean().optional(),
    recordingsFolderUrl: z.string().max(400).refine(isDriveLink).optional(),
  })
  .strict();

/** ADR-0077: a failed two-step email is tried again by itself at most this often, ms. */
export const AUTO_RETRY_EVERY_MS = 60 * 60_000;

/** ADR-0077: and only for records this young, ms (three days). */
export const AUTO_RETRY_FOR_MS = 3 * 24 * 60 * 60_000;

/** ADR-0077: and at most this many attempts in all. */
export const AUTO_RETRY_MAX_ATTEMPTS = 24;

/**
 * Sends a session's one email now: works out the recipients (the person, then the session's own list or
 * the Settings list), notes on the record whether the recording is still missing, sends it, and records
 * the outcome.
 * @param deps      The dependencies.
 * @param userId    The account.
 * @param email     The person's address.
 * @param sessionId The session.
 * @param content   The session's record.
 * @param attempt   The attempt number (the Message-ID).
 * @param sender    The SMTP settings.
 * @returns 'sent' or 'failed'.
 */
async function deliver(
  deps: GoogleDeps,
  userId: string,
  email: string,
  sessionId: string,
  content: NotificationContent,
  attempt: number,
  sender: EmailConfig,
): Promise<'sent' | 'failed'> {
  const member = await getMember(deps.db(), userId);
  const recipients = recipientsFor(email, content, member.alsoNotify);
  // ADR-0077: email 2 says "Recording not uploaded" when its recording is still missing (24 hours).
  const recordingMissing = content.kind === 'recording' && !isComplete(content);
  const recordingPending = content.kind !== 'recording' && !isComplete(content);
  const marks = {
    recipients,
    ...(recordingPending ? { recordingPending: true } : {}),
    ...(recordingMissing ? { recordingMissing: true } : {}),
    lastTriedAt: deps.now(),
  };
  await writeRecord(deps.db(), deps.keys(), userId, sessionId, (current) => ({
    ...(current ?? content),
    ...marks,
  }));
  const outcome = await sendSavedEmail(
    deps.mailer,
    sender,
    { ...content, ...marks },
    emailMessageId(userId, sessionId, attempt, sender.from),
  );
  await finishNotification(
    deps.db(),
    userId,
    sessionId,
    outcome === 'sent' ? { status: 'sent' } : { status: 'failed', error: outcome },
    new Date(deps.now()),
  );
  console.info('drive: email', { outcome, recipients: recipients.length, recordingPending });
  return outcome === 'sent' ? 'sent' : 'failed';
}

/**
 * Sends a session's email if it is due: the record is still collecting and either complete or 24 hours
 * old. Only one request can take a record (store.claimCollecting), so restarts and devices reporting
 * together never send twice. Without SMTP settings it becomes "not-set-up" (sent by hand from Settings);
 * with the email switched off, "off".
 * @param deps      The dependencies.
 * @param userId    The account.
 * @param email     The person's address.
 * @param sessionId The session.
 * @param record    The record as just read or written.
 * @returns Its state afterwards.
 */
async function sendIfDue(
  deps: GoogleDeps,
  userId: string,
  email: string,
  sessionId: string,
  record: NotificationRecord,
): Promise<DriveNotificationStatus> {
  if (record.status !== 'collecting') return record.status;
  const due = emailDue(record.content, record.createdAt.getTime(), deps.now());
  if (!due) return 'collecting';
  const member = await getMember(deps.db(), userId);
  const sender = deps.email();
  const target = !sender ? 'not-set-up' : !member.emailEnabled ? 'off' : 'pending';
  const attempt = await claimCollecting(deps.db(), userId, sessionId, target);
  if (attempt === null) {
    return (await readRecord(deps.db(), deps.keys(), userId, sessionId))?.status ?? 'pending';
  }
  if (target !== 'pending' || !sender) {
    console.info('drive: email not sent', { status: target });
    return target;
  }
  // ADR-0077: email 1 goes without the recording, so its "Recording saved" record starts collecting now
  // (made first: if sending fails, email 2 still follows the recording).
  if (needsRecordingEmail(record.content)) {
    const call = splitNotificationKey(sessionId).sessionId;
    await writeRecord(
      deps.db(),
      deps.keys(),
      userId,
      recordingKey(call, record.content.callStartedAt),
      (current) => current ?? recordingContent(record.content),
    );
  }
  return deliver(deps, userId, email, sessionId, record.content, attempt, sender);
}

/**
 * ADR-0077: tries again, by itself, the failed emails of calls with the two-step rule (never an older
 * call's): each at most once an hour, for three days and AUTO_RETRY_MAX_ATTEMPTS attempts, so a mail
 * server that was refusing (a password being replaced) loses nothing once it works again. Only one
 * request can take each (store.claimRetry).
 * @param deps   The dependencies.
 * @param userId One account (on its requests), or null for every account (the scheduled job).
 * @returns How many were tried.
 */
async function retryFailed(deps: GoogleDeps, userId: string | null): Promise<number> {
  const sender = deps.email();
  if (!sender) return 0;
  const now = deps.now();
  const candidates = await listRetryCandidates(
    deps.db(),
    new Date(now - AUTO_RETRY_FOR_MS),
    userId,
  );
  let tried = 0;
  for (const item of candidates) {
    if (item.attempts >= AUTO_RETRY_MAX_ATTEMPTS) continue;
    try {
      const record = await readRecord(deps.db(), deps.keys(), item.userId, item.sessionId);
      if (!record || record.content.rule !== 'two-step') continue;
      const last = record.content.lastTriedAt ?? record.createdAt.getTime();
      if (now - last < AUTO_RETRY_EVERY_MS) continue;
      const member = await getMember(deps.db(), item.userId);
      if (!member.emailEnabled) continue;
      const taken = await claimRetry(deps.db(), deps.keys(), item.userId, item.sessionId);
      if (!taken) continue;
      await deliver(
        deps,
        item.userId,
        item.email,
        item.sessionId,
        taken.content,
        taken.attempt,
        sender,
      );
      tried += 1;
    } catch (error) {
      console.error('drive: email retry failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  return tried;
}

/**
 * Sends the emails of sessions that have waited 24 hours for a recording, without it. Failures are
 * logged by name and skipped, so one bad record never blocks the others.
 * @param deps   The dependencies.
 * @param userId One account (on its requests), or null for every account (the daily job).
 * @returns How many were looked at.
 * Called from: handleStatus(), handleNotifications(), handleFlushCron()
 */
export async function flushOverdue(deps: GoogleDeps, userId: string | null): Promise<number> {
  // ADR-0077: failed emails of new calls are tried again first (an hour apart).
  await retryFailed(deps, userId).catch(() => 0);
  const due = await listOverdue(deps.db(), new Date(deps.now() - REPORT_WAIT_MS), userId);
  for (const item of due) {
    try {
      const record = await readRecord(deps.db(), deps.keys(), item.userId, item.sessionId);
      if (record) await sendIfDue(deps, item.userId, item.email, item.sessionId, record);
    } catch (error) {
      console.error('drive: overdue email failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  return due.length;
}

/**
 * POST /api/drive/notify: a device's report of what it saved for one call of a session. ADR-0073: each
 * call has its own record and email (a session can be started again after it ended); the session's
 * first record keeps the session id, later calls get their own key (report.ts reportKey). Merged with
 * the call's other reports (other devices, retries, a later recording backfill); the call's one email
 * goes when every expected file is in, or 24 hours after the first report with "Recording upload
 * pending". A record already sent, switched off or waiting for "Send email" only gains the new files.
 * @param request The request (body: DriveNotifyRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveNotifyResponse; 400; 404 not connected.
 * Called from: app/api/drive/notify/route.ts
 */
export function handleNotify(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'notify', { post: true, limit: 'other' }, async ({ user }) => {
    const body = await readBody(request, notifySchema);
    if (!body) return failure(400, 'invalid_request', 'The notification is not valid.');
    const company = await companyToken(deps);
    if (company instanceof Response) return company;
    // ADR-0074: a Drive id is linked in the email only when the company token finds that file with the
    // tag this account and session give it; anything else keeps its name without a link.
    const files = await Promise.all(
      body.files.map(async (file) => {
        if (!file.fileId) return file;
        const facts = file.key ? await company.drive.file(file.fileId) : null;
        if (
          facts &&
          file.key &&
          fileMatches(facts, { tag: fileTag(user.id, body.sessionId, file.key).value })
        ) {
          return file;
        }
        const { fileId: _unverified, ...rest } = file;
        return rest;
      }),
    );
    const report = { ...body, files };
    // ADR-0077: calls ended from 13 Nov 2026 use the two-step rule ("manual only" does not apply).
    const twoStep = body.emailRule === 'two-step';
    // ADR-0073: the session's first record, or this call's own.
    const first = await readRecord(deps.db(), deps.keys(), user.id, body.sessionId);
    const key = reportKey(body.sessionId, body.callStartedAt, first?.content ?? null, twoStep);
    // A session saved before the combined email (or with "Upload to Drive") is never emailed by
    // itself: its new record waits for "Send email".
    const record = await writeRecord(
      deps.db(),
      deps.keys(),
      user.id,
      key,
      (current) => mergeReport(current, report),
      body.manualOnly && !twoStep ? 'not-set-up' : 'collecting',
    );
    const status = await sendIfDue(deps, user.id, user.email, key, record);
    if (twoStep) {
      // Email 2: once email 1 went without the recording, this call's recording record collects the
      // recording files, and goes when they are all in.
      const recording = recordingKey(body.sessionId, body.callStartedAt);
      const waiting = await readRecord(deps.db(), deps.keys(), user.id, recording);
      if (waiting && waiting.status === 'collecting') {
        const merged = await writeRecord(deps.db(), deps.keys(), user.id, recording, (current) =>
          mergeRecordingReport(current, report),
        );
        await sendIfDue(deps, user.id, user.email, recording, merged);
      }
    }
    console.info('drive: report', { status, files: record.content.files.length, twoStep });
    return reply({ status } satisfies DriveNotifyResponse);
  });
}

/**
 * GET /api/drive/notifications: the latest notifications, for Settings (overdue emails go first).
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveNotificationsResponse.
 * Called from: app/api/drive/notifications/route.ts
 */
export function handleNotifications(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(
    request,
    deps,
    'notifications',
    { post: false, limit: 'other' },
    async ({ user }) => {
      await flushOverdue(deps, user.id).catch(() => 0);
      const rows = await listNotifications(
        deps.db(),
        deps.keys(),
        user.id,
        DRIVE_NOTIFICATIONS_SHOWN,
      );
      const items: DriveNotificationItem[] = rows.map((row) => ({
        // The record key names the session and, for a later call, the call (ADR-0073).
        ...splitNotificationKey(row.sessionId),
        title: row.content.title,
        status: row.status,
        createdAt: row.createdAt.getTime(),
        sentAt: row.sentAt?.getTime() ?? null,
        folderUrl: row.content.folderUrl,
        recipients: row.content.recipients.length,
        files: row.content.files.length,
        recordingPending: row.content.recordingPending === true,
      }));
      return reply({ items } satisfies DriveNotificationsResponse);
    },
  );
}

/** POST /api/drive/notifications' body. */
const retrySchema = z
  .object({
    sessionId: z.uuid(),
    call: z.number().int().positive().nullable().optional(),
    // ADR-0077: the call's "Recording saved" email (needs the call).
    recording: z.boolean().optional(),
  })
  .strict();

/**
 * POST /api/drive/notifications: sends a failed email again, or by hand one that was complete before
 * email was set up ("Send email"), with every file saved so far and a new attempt's Message-ID. Only
 * one request can take it (store.claimRetry).
 * @param request The request (body: DriveRetryRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveNotifyResponse; 400; 404 nothing to send; 409 email not set up.
 * Called from: app/api/drive/notifications/route.ts
 */
export function handleRetry(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'retry', { post: true, limit: 'other' }, async ({ user }) => {
    const body = await readBody(request, retrySchema);
    if (!body) return failure(400, 'invalid_request', 'sessionId: invalid');
    const sender = deps.email();
    if (!sender) return failure(409, 'email_not_set_up', 'Email is not set up.');
    // ADR-0073: which of the session's emails (its first, or a later call's); ADR-0077: or a call's
    // "Recording saved" email.
    if (body.recording && !body.call) return failure(400, 'invalid_request', 'call: required');
    const key =
      body.recording && body.call
        ? recordingKey(body.sessionId, body.call)
        : notificationKey(body.sessionId, body.call ?? null);
    const taken = await claimRetry(deps.db(), deps.keys(), user.id, key);
    if (!taken) return failure(404, 'not_found', 'There is no email to send for this session.');
    const status = await deliver(
      deps,
      user.id,
      user.email,
      key,
      taken.content,
      taken.attempt,
      sender,
    );
    return reply({ status } satisfies DriveNotifyResponse);
  });
}

/**
 * GET /api/cron/drive-flush: Vercel's daily job sends the emails of sessions that have waited 24 hours
 * for a recording (accounts that did not open Paramount AI since). Only with the CRON_SECRET Vercel
 * sends as a Bearer token; without CRON_SECRET set it answers 404 and does nothing.
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 { checked }; 401 wrong secret; 404 not set up.
 * Called from: app/api/cron/drive-flush/route.ts (vercel.json crons)
 */
export async function handleFlushCron(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  const secret = deps.cronSecret();
  if (!secret) return failure(404, 'not_found', 'Not found');
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const wanted = Buffer.from(`Bearer ${secret}`);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return failure(401, 'unauthorized', 'Not allowed');
  }
  try {
    const checked = await flushOverdue(deps, null);
    console.info('drive: overdue check', { checked });
    return reply({ checked });
  } catch (error) {
    console.error('drive: daily overdue check failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return failure(500, 'failed', 'Failed');
  }
}

/**
 * POST /api/drive/test-email: sends a test email to the signed-in person's own address (never anyone
 * else), 3 in 10 minutes per account, so the SMTP settings can be checked from Settings.
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveTestEmailResponse; 409 email not set up; 429.
 * Called from: app/api/drive/test-email/route.ts
 */
export function handleTestEmail(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'test-email', { post: true, limit: 'test' }, async ({ user }) => {
    const sender = deps.email();
    if (!sender) return failure(409, 'email_not_set_up', 'Email is not set up.');
    const outcome = await sendTestEmail(deps.mailer, sender, user.email, deps.now());
    console.info('drive: test email', { outcome });
    return reply(
      (outcome === 'sent'
        ? { status: 'sent' }
        : { status: 'failed', reason: outcome }) satisfies DriveTestEmailResponse,
    );
  });
}

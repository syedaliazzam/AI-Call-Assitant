/**
 * File: apps/web/src/server/google/api.ts
 * Purpose: The /api/google/* and /api/drive/* handlers (ADR-0072): connect (OAuth with a signed,
 *          account-bound state and PKCE), the callback (stores the refresh token encrypted), status,
 *          a short-lived access token (rate-limited), the Picker's key and project number, the picked
 *          folder (checked with Drive), the person's switches and team list, disconnect (revoke, then
 *          delete), and the "saved" email (one per session) with its list and Retry. The account always
 *          comes from the signed-in session, read from the database, never from the request. POSTs must
 *          come from a Kite address (Origin check) on top of the SameSite session cookie.
 * Used by: app/api/google/{connect,callback,status,access-token,picker-config,folder,settings,disconnect}/route.ts,
 *          app/api/drive/{notify,notifications,test-email}/route.ts
 * Depends on: zod, @kite/shared, src/server/auth.ts, src/server/db.ts, src/server/env.ts,
 *             src/server/calldata/crypto.ts, src/server/google/{config,oauth,store,tokens,email,rateLimit}.ts
 * Architecture: ADR-0072; architecture §7.2, §8.1, §8.2
 *
 * Logs carry the route and a status or code only: never tokens, ids, addresses, titles or file names.
 */
import 'server-only';
import { z } from 'zod';
import {
  DRIVE_NOTIFICATIONS_SHOWN,
  MAX_ALSO_NOTIFY,
  MAX_EMAIL_CHARS,
  MAX_SAVED_FILES,
  MAX_SAVED_NAME_CHARS,
  driveFolderUrl,
  isDriveLink,
  type DriveAccessTokenResponse,
  type DriveNotificationItem,
  type DriveNotificationsResponse,
  type DriveNotifyResponse,
  type DrivePickerConfig,
  type DriveStatusResponse,
  type DriveTestEmailResponse,
} from '@kite/shared';
import { auth } from '../auth';
import { DataKeyError, dataKeys, type DataKeys } from '../calldata/crypto';
import type { CallDataDb } from '../calldata/store';
import { db } from '../db';
import { getAuthEnv } from '../env';
import { emailConfig, googleConfig, type EmailConfig, type GoogleConfig } from './config';
import { emailMessageId, sendSavedEmail, sendTestEmail, smtpMailer, type Mailer } from './email';
import {
  GoogleRefusedError,
  GoogleUnavailableError,
  STATE_COOKIE,
  checkOAuthState,
  exchangeCode,
  readDriveFolder,
  revokeToken,
  startOAuth,
  stateKey,
  type FetchLike,
} from './oauth';
import { createRateLimiter, type RateLimiter } from './rateLimit';
import {
  claimNotification,
  claimRetry,
  deleteConnection,
  finishNotification,
  getConnection,
  listNotifications,
  readRefreshToken,
  saveConnection,
  setFolder,
  updateSettings,
  type NotificationContent,
} from './store';
import { accessTokenFor, forgetAccessToken } from './tokens';

/** Where Settings shows the Google Drive section. */
const SETTINGS_PATH = '/settings';

/** The signed-in account, as the handlers need it. */
export interface DriveUser {
  /** The account's id. */
  id: string;
  /** Its login email (the "saved" email's first recipient). */
  email: string;
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
  /** The clock (Unix ms). */
  now(): number;
  /** Rate limits. */
  limits: {
    /** The access-token route. */
    token: RateLimiter;
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
    return { id: session.user.id, email: session.user.email };
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
  now: () => Date.now(),
  // 30 tokens a minute is far above what uploads need (one per file, cached an hour). Test emails:
  // 3 in 10 minutes per account.
  limits: {
    token: createRateLimiter(30, 60_000),
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
  options: { post: boolean; limit: 'token' | 'other' | 'test' },
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
 * GET /api/google/status.
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
    const row = deps.google() ? await getConnection(deps.db(), user.id) : null;
    const body: DriveStatusResponse = {
      configured: deps.google() !== null,
      status: row ? (row.status === 'reconnect' ? 'reconnect' : 'connected') : 'not-connected',
      folder:
        row?.folderId && row.folderName
          ? {
              id: row.folderId,
              name: row.folderName,
              driveId: row.driveId,
              url: driveFolderUrl(row.folderId),
            }
          : null,
      saveEnabled: row?.saveEnabled ?? true,
      email: {
        configured: deps.email() !== null,
        enabled: row?.emailEnabled ?? true,
        alsoNotify: row?.alsoNotify ?? [],
      },
    };
    return reply(body);
  });
}

/**
 * GET /api/google/connect: sends the signed-in person to Google's consent page.
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
  console.info('drive: connect started');
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
 * GET /api/google/callback: Google sends the person back here. Checks the state (signature, expiry,
 * this account, the cookie's nonce), exchanges the code, stores the refresh token encrypted, and goes
 * to Settings to pick the folder.
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
  // The person pressed Cancel on Google's page (or Google refused): nothing is stored.
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
    await saveConnection(deps.db(), deps.keys(), user.id, tokens.refreshToken);
    forgetAccessToken(user.id);
    console.info('drive: connected');
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
 * GET /api/google/access-token: a short-lived access token for Drive calls from this device.
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveAccessTokenResponse; 404 not_connected or not_configured; 409 reconnect; 429; 503.
 * Called from: app/api/google/access-token/route.ts
 */
export function handleAccessToken(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'token', { post: false, limit: 'token' }, async ({ user }) => {
    const config = deps.google();
    if (!config) return failure(404, 'not_configured', 'Google Drive is not set up.');
    const token = await accessTokenFor(
      { db: deps.db(), keys: deps.keys(), config, fetch: deps.fetch, now: deps.now },
      user.id,
    );
    if (token === 'not-connected')
      return failure(404, 'not_connected', 'Connect Google Drive first.');
    if (token === 'reconnect') return failure(409, 'reconnect', 'Reconnect Google Drive.');
    return reply(token satisfies DriveAccessTokenResponse);
  });
}

/**
 * GET /api/google/picker-config: the Picker's API key and project number (signed-in people only).
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DrivePickerConfig; 404 when the Picker is not set up.
 * Called from: app/api/google/picker-config/route.ts
 */
export function handlePickerConfig(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'picker', { post: false, limit: 'other' }, async () => {
    const config = deps.google();
    if (!config?.pickerApiKey || !config.appId) {
      return failure(404, 'not_configured', 'Google Picker is not set up.');
    }
    return reply({ apiKey: config.pickerApiKey, appId: config.appId } satisfies DrivePickerConfig);
  });
}

/** POST /api/google/folder's body. */
const folderSchema = z.object({ folderId: z.string().regex(/^[A-Za-z0-9_-]{5,200}$/) }).strict();

/**
 * POST /api/google/folder: stores the folder picked in Google Picker, as Drive describes it.
 * @param request The request (body: DriveFolderRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 { folder }; 400; 404 not connected or folder not found; 409 reconnect.
 * Called from: app/api/google/folder/route.ts
 */
export function handleFolder(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'folder', { post: true, limit: 'other' }, async ({ user }) => {
    const config = deps.google();
    if (!config) return failure(404, 'not_configured', 'Google Drive is not set up.');
    const body = await readBody(request, folderSchema);
    if (!body) return failure(400, 'invalid_request', 'folderId: invalid');
    const token = await accessTokenFor(
      { db: deps.db(), keys: deps.keys(), config, fetch: deps.fetch, now: deps.now },
      user.id,
    );
    if (token === 'not-connected')
      return failure(404, 'not_connected', 'Connect Google Drive first.');
    if (token === 'reconnect') return failure(409, 'reconnect', 'Reconnect Google Drive.');
    const folder = await readDriveFolder(deps.fetch, token.accessToken, body.folderId);
    if (!folder) {
      return failure(
        404,
        'folder_not_found',
        'That folder could not be opened. Choose another one.',
      );
    }
    await setFolder(deps.db(), user.id, folder);
    console.info('drive: folder chosen', { sharedDrive: folder.driveId !== null });
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
 * POST /api/google/settings: the person's switches and team list.
 * @param request The request (body: DriveSettingsRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 { ok: true }; 400 (an invalid address, too many); 404 not connected.
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
    const saved = await updateSettings(deps.db(), user.id, body);
    if (!saved) return failure(404, 'not_connected', 'Connect Google Drive first.');
    return reply({ ok: true });
  });
}

/**
 * POST /api/google/disconnect: revokes the refresh token at Google and deletes the connection. The row
 * goes even when Google cannot be reached (the token then expires unused); the reply says so.
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 { revoked }.
 * Called from: app/api/google/disconnect/route.ts
 */
export function handleDisconnect(
  request: Request,
  deps: GoogleDeps = realGoogleDeps,
): Promise<Response> {
  return withUser(request, deps, 'disconnect', { post: true, limit: 'other' }, async ({ user }) => {
    const row = await getConnection(deps.db(), user.id);
    let revoked = true;
    if (row) {
      let token: string | null = null;
      try {
        token = readRefreshToken(deps.keys(), row);
      } catch {
        // Unreadable (a removed key): nothing to revoke from here; the row still goes.
        revoked = false;
      }
      if (token) revoked = await revokeToken(deps.fetch, token);
      await deleteConnection(deps.db(), user.id);
    }
    forgetAccessToken(user.id);
    console.info('drive: disconnected', { revoked });
    return reply({ revoked });
  });
}

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
          })
          .strict(),
      )
      .min(1)
      .max(MAX_SAVED_FILES),
    folderUrl: z.string().max(400).refine(isDriveLink),
    timeZone: z.string().max(64),
    alsoNotify: addressList.nullable(),
  })
  .strict();

/**
 * POST /api/drive/notify: a session's uploads all finished. Records it once per session and, when the
 * email is set up and switched on, sends one email to the person and the team list. A repeat (a
 * retried upload, a second call, another device) sends nothing and answers the first one's state.
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
    const row = await getConnection(deps.db(), user.id);
    if (!row) return failure(404, 'not_connected', 'Connect Google Drive first.');
    const sender = deps.email();
    const recipients = [
      ...new Set([user.email.toLowerCase(), ...(body.alsoNotify ?? row.alsoNotify)]),
    ];
    const content: NotificationContent = {
      title: body.title,
      callStartedAt: body.callStartedAt,
      durationMs: body.durationMs,
      files: body.files,
      folderUrl: body.folderUrl,
      timeZone: body.timeZone,
      recipients,
    };
    const first = !sender ? 'not-set-up' : row.emailEnabled ? 'pending' : 'off';
    const claim = await claimNotification(
      deps.db(),
      deps.keys(),
      user.id,
      body.sessionId,
      content,
      first,
    );
    if (!claim.claimed) {
      console.info('drive: notify repeated', { status: claim.status });
      return reply({ status: claim.status } satisfies DriveNotifyResponse);
    }
    if (first !== 'pending' || !sender) {
      console.info('drive: notify recorded', { status: first });
      return reply({ status: first } satisfies DriveNotifyResponse);
    }
    const outcome = await sendSavedEmail(
      deps.mailer,
      sender,
      content,
      emailMessageId(user.id, body.sessionId, 1, sender.from),
    );
    await finishNotification(
      deps.db(),
      user.id,
      body.sessionId,
      outcome === 'sent' ? { status: 'sent' } : { status: 'failed', error: outcome },
      new Date(deps.now()),
    );
    console.info('drive: notify sent', { outcome, recipients: recipients.length });
    return reply({ status: outcome === 'sent' ? 'sent' : 'failed' } satisfies DriveNotifyResponse);
  });
}

/**
 * GET /api/drive/notifications: the latest notifications, for Settings.
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
      const rows = await listNotifications(
        deps.db(),
        deps.keys(),
        user.id,
        DRIVE_NOTIFICATIONS_SHOWN,
      );
      const items: DriveNotificationItem[] = rows.map((row) => ({
        sessionId: row.sessionId,
        title: row.content.title,
        status: row.status,
        createdAt: row.createdAt.getTime(),
        sentAt: row.sentAt?.getTime() ?? null,
        folderUrl: row.content.folderUrl,
        recipients: row.content.recipients.length,
      }));
      return reply({ items } satisfies DriveNotificationsResponse);
    },
  );
}

/** POST /api/drive/notifications' body. */
const retrySchema = z.object({ sessionId: z.uuid() }).strict();

/**
 * POST /api/drive/notifications: sends a failed (or then-unconfigured) email again, with a new
 * attempt's idempotency key. Only one request can take a failed email (store.claimRetry).
 * @param request The request (body: DriveRetryRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 DriveNotifyResponse; 400; 404 nothing to retry; 409 email not set up.
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
    const taken = await claimRetry(deps.db(), deps.keys(), user.id, body.sessionId);
    if (!taken) return failure(404, 'not_found', 'There is no failed email to send again.');
    const outcome = await sendSavedEmail(
      deps.mailer,
      sender,
      taken.content,
      emailMessageId(user.id, body.sessionId, taken.attempt, sender.from),
    );
    await finishNotification(
      deps.db(),
      user.id,
      body.sessionId,
      outcome === 'sent' ? { status: 'sent' } : { status: 'failed', error: outcome },
      new Date(deps.now()),
    );
    console.info('drive: notify retried', { outcome });
    return reply({ status: outcome === 'sent' ? 'sent' : 'failed' } satisfies DriveNotifyResponse);
  });
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

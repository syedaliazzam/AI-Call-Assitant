/**
 * File: apps/web/src/core/drive/api.ts
 * Purpose: The page's calls to Kite's own Google Drive routes (ADR-0072): status, a short-lived access
 *          token, the Picker's settings, the picked folder, the person's switches, disconnect, the
 *          "saved" notification, its list and Retry, and the test email. The refresh token never reaches the page; only an
 *          access token does, kept in memory until a minute before it expires.
 * Used by: src/core/drive/uploader.ts, src/core/drive/picker.ts, src/features/drive/*
 * Depends on: @kite/shared (the request and reply shapes)
 * Architecture: ADR-0072
 */
import type {
  DriveAccessTokenResponse,
  DriveFolder,
  DriveNotificationsResponse,
  DriveNotifyRequest,
  DriveNotifyResponse,
  DrivePickerConfig,
  DriveSettingsRequest,
  DriveStatusResponse,
  DriveTestEmailResponse,
} from '@kite/shared';

/** A refused or failed route call: code is the route's machine-readable code. */
export class DriveApiError extends Error {
  /**
   * @param status  The HTTP status (0 when the server could not be reached).
   * @param code    The route's code ('reconnect', 'not_connected', 'too_many', 'network', …).
   * @param message Words for the person (from the route; never call content).
   */
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DriveApiError';
  }
}

/** The fetch the calls use (tests pass a fake). */
export type DriveFetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Calls a route and reads its JSON.
 * @param fetchFn The fetch.
 * @param path    The route.
 * @param body    A JSON body for a POST, or undefined for a GET.
 * @returns The reply.
 * @throws DriveApiError.
 */
async function call<T>(fetchFn: DriveFetch, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(
      path,
      body === undefined
        ? { cache: 'no-store' }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            cache: 'no-store',
          },
    );
  } catch {
    throw new DriveApiError(
      0,
      'network',
      'Paramount AI could not be reached. Check the connection.',
    );
  }
  if (!response.ok) {
    let code = 'failed';
    let message = 'Something went wrong. Try again.';
    try {
      const failure = (await response.json()) as { code?: unknown; message?: unknown };
      if (typeof failure.code === 'string') code = failure.code;
      if (typeof failure.message === 'string') message = failure.message;
    } catch {
      // Not JSON (a proxy's page): the general words above.
    }
    throw new DriveApiError(response.status, code, message);
  }
  return (await response.json()) as T;
}

/** The calls, over one fetch. */
export interface DriveApi {
  /** GET /api/google/status. */
  status(): Promise<DriveStatusResponse>;
  /**
   * An access token, from memory while it is still good.
   * @param fresh True to ask the server again (Google refused the one held).
   */
  token(fresh?: boolean): Promise<DriveAccessTokenResponse>;
  /** GET /api/google/picker-config. */
  pickerConfig(): Promise<DrivePickerConfig>;
  /**
   * POST /api/google/folder.
   * @param folderId The picked folder.
   */
  setFolder(folderId: string): Promise<DriveFolder>;
  /**
   * POST /api/google/settings.
   * @param changes What changes.
   */
  saveSettings(changes: DriveSettingsRequest): Promise<void>;
  /** POST /api/google/disconnect. */
  disconnect(): Promise<{ revoked: boolean }>;
  /**
   * POST /api/drive/notify.
   * @param request The session's saved files.
   */
  notify(request: DriveNotifyRequest): Promise<DriveNotifyResponse>;
  /** GET /api/drive/notifications. */
  notifications(): Promise<DriveNotificationsResponse>;
  /**
   * POST /api/drive/notifications (Retry).
   * @param sessionId The session whose email failed.
   */
  retryNotification(sessionId: string): Promise<DriveNotifyResponse>;
  /** POST /api/drive/test-email (to the signed-in person only). */
  sendTestEmail(): Promise<DriveTestEmailResponse>;
}

/**
 * Creates the API client.
 *
 * @param fetchFn The fetch (default the page's).
 * @param now     The clock (tests pass their own).
 * @returns The client.
 * Called from: driveApi() below; tests
 */
export function createDriveApi(
  fetchFn: DriveFetch = (input, init) => fetch(input, init),
  now: () => number = Date.now,
): DriveApi {
  let held: DriveAccessTokenResponse | null = null;
  return {
    status: () => call(fetchFn, '/api/google/status'),
    async token(fresh = false) {
      // The server already took a margin off; one more minute here covers a slow upload's start.
      if (!fresh && held && held.expiresAt - 60_000 > now()) return held;
      held = null;
      try {
        held = await call<DriveAccessTokenResponse>(fetchFn, '/api/google/access-token');
      } catch (error) {
        held = null;
        throw error;
      }
      return held;
    },
    pickerConfig: () => call(fetchFn, '/api/google/picker-config'),
    async setFolder(folderId) {
      const out = await call<{ folder: DriveFolder }>(fetchFn, '/api/google/folder', { folderId });
      return out.folder;
    },
    async saveSettings(changes) {
      await call(fetchFn, '/api/google/settings', changes);
    },
    async disconnect() {
      held = null;
      return call(fetchFn, '/api/google/disconnect', {});
    },
    notify: (request) => call(fetchFn, '/api/drive/notify', request),
    notifications: () => call(fetchFn, '/api/drive/notifications'),
    retryNotification: (sessionId) => call(fetchFn, '/api/drive/notifications', { sessionId }),
    sendTestEmail: () => call(fetchFn, '/api/drive/test-email', {}),
  };
}

/** The page's one client (so the access token is shared by the uploader and the Picker). */
let shared: DriveApi | null = null;

/**
 * The page's API client.
 *
 * @returns The client.
 * Called from: features/drive/*, core/drive/picker.ts
 */
export function driveApi(): DriveApi {
  shared ??= createDriveApi();
  return shared;
}

/**
 * File: apps/web/src/core/drive/api.ts
 * Purpose: The page's calls to Kite's own Google Drive routes: status, the Picker's settings (admins),
 *          the company folder (admins), the person's switches, disconnect (admins), the "saved"
 *          notification, its list and Retry, and the test email. ADR-0074: the page never holds a Google
 *          token from Kite: the server makes a session's folders, starts each recording upload and gives
 *          back only that upload's session address and ticket, says where an upload got to, verifies a
 *          finished one, and uploads the page's own small files (transcript, notes) itself.
 * Used by: src/core/drive/uploader.ts, src/core/drive/runner.ts, src/core/drive/picker.ts,
 *          src/features/drive/*
 * Depends on: @kite/shared (the request and reply shapes, ACCOUNT_HEADER), src/core/storage/accountScope.ts
 *
 * Privacy fix of 14 Nov 2026: each call names the page's account (ACCOUNT_HEADER), so a window left open
 * from before a sign-out and a sign-in as someone else can never save its calls to the new account.
 * Architecture: ADR-0074 (ADR-0072 before it)
 */
import {
  ACCOUNT_HEADER,
  type DriveFolder,
  type DriveNotificationsResponse,
  type DriveNotifyRequest,
  type DriveNotifyResponse,
  type DrivePickerConfig,
  type DriveSessionFolderRequest,
  type DriveSessionFolderResponse,
  type DriveSettingsRequest,
  type DriveStatusResponse,
  type DriveTestEmailResponse,
  type DriveUploadCompleteRequest,
  type DriveUploadOffsetRequest,
  type DriveUploadOffsetResponse,
  type DriveUploadStartRequest,
  type DriveUploadStartResponse,
  type DriveVerifiedFile,
} from '@kite/shared';
import { currentAccountId } from '../storage/accountScope';

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
 * @param body    A JSON body (or a form) for a POST, or undefined for a GET.
 * @returns The reply.
 * @throws DriveApiError.
 */
async function call<T>(fetchFn: DriveFetch, path: string, body?: unknown): Promise<T> {
  // The page's account, so the server refuses the call once another account has signed in.
  const accountId = currentAccountId();
  const account: Record<string, string> = accountId ? { [ACCOUNT_HEADER]: accountId } : {};
  const named = accountId ? { headers: account } : {};
  let response: Response;
  try {
    response = await fetchFn(
      path,
      body === undefined
        ? { cache: 'no-store', ...named }
        : body instanceof FormData
          ? // The browser sets the multipart boundary itself.
            { method: 'POST', body, cache: 'no-store', ...named }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...account },
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
    // Another account signed in since this page opened: reported like an unreachable server (status 0),
    // so the uploader keeps the job to try again later for its own account, instead of marking files
    // failed or a call reported. The page reloads as soon as it hears of the sign-in (SyncScope).
    if (response.status === 409 && code === 'account_changed') {
      throw new DriveApiError(0, code, message);
    }
    throw new DriveApiError(response.status, code, message);
  }
  return (await response.json()) as T;
}

/** One of the page's own files, uploaded through the server. */
export interface DriveSmallFile {
  /** The session. */
  sessionId: string;
  /** The file's stable key ('call:<start>:transcript-txt', …). */
  key: string;
  /** Its name in Drive. */
  name: string;
  /** Its bytes. */
  blob: Blob;
}

/** The calls, over one fetch. */
export interface DriveApi {
  /** GET /api/google/status. */
  status(): Promise<DriveStatusResponse>;
  /** GET /api/google/picker-config (admins). */
  pickerConfig(): Promise<DrivePickerConfig>;
  /**
   * POST /api/google/folder (admins).
   * @param folderId The picked folder.
   */
  setFolder(folderId: string): Promise<DriveFolder>;
  /**
   * POST /api/google/settings.
   * @param changes What changes.
   */
  saveSettings(changes: DriveSettingsRequest): Promise<void>;
  /** POST /api/google/disconnect (admins). */
  disconnect(): Promise<{ revoked: boolean }>;
  /**
   * POST /api/drive/session-folder: the session's folders (made by the server).
   * @param request The session and its folder's name.
   */
  sessionFolder(request: DriveSessionFolderRequest): Promise<DriveSessionFolderResponse>;
  /**
   * POST /api/drive/uploads: one recording file: already there, or an upload's session address.
   * @param request The file.
   */
  startUpload(request: DriveUploadStartRequest): Promise<DriveUploadStartResponse>;
  /**
   * POST /api/drive/uploads/offset: where an upload got to.
   * @param request The upload's address and ticket.
   */
  uploadOffset(request: DriveUploadOffsetRequest): Promise<DriveUploadOffsetResponse>;
  /**
   * POST /api/drive/uploads/complete: the server verifies a finished upload.
   * @param request The upload, its Drive id and MD5.
   */
  completeUpload(request: DriveUploadCompleteRequest): Promise<DriveVerifiedFile>;
  /**
   * POST /api/drive/files: one of the page's own small files, uploaded by the server.
   * @param file The file.
   */
  uploadFile(file: DriveSmallFile): Promise<DriveVerifiedFile>;
  /**
   * POST /api/drive/notify.
   * @param request The call's saved files.
   */
  notify(request: DriveNotifyRequest): Promise<DriveNotifyResponse>;
  /** GET /api/drive/notifications. */
  notifications(): Promise<DriveNotificationsResponse>;
  /**
   * POST /api/drive/notifications (Retry).
   * @param sessionId The session whose email failed.
   * @param call      Which of its emails (ADR-0073: DriveNotificationItem.call); null for the first.
   * @param recording ADR-0077: true for the call's "Recording saved" email.
   */
  retryNotification(
    sessionId: string,
    call?: number | null,
    recording?: boolean,
  ): Promise<DriveNotifyResponse>;
  /** POST /api/drive/test-email (to the signed-in person only). */
  sendTestEmail(): Promise<DriveTestEmailResponse>;
}

/**
 * Creates the API client.
 *
 * @param fetchFn The fetch (default the page's).
 * @returns The client.
 * Called from: driveApi() below; tests
 */
export function createDriveApi(
  fetchFn: DriveFetch = (input, init) => fetch(input, init),
): DriveApi {
  return {
    status: () => call(fetchFn, '/api/google/status'),
    pickerConfig: () => call(fetchFn, '/api/google/picker-config'),
    async setFolder(folderId) {
      const out = await call<{ folder: DriveFolder }>(fetchFn, '/api/google/folder', { folderId });
      return out.folder;
    },
    async saveSettings(changes) {
      await call(fetchFn, '/api/google/settings', changes);
    },
    disconnect: () => call(fetchFn, '/api/google/disconnect', {}),
    sessionFolder: (request) => call(fetchFn, '/api/drive/session-folder', request),
    startUpload: (request) => call(fetchFn, '/api/drive/uploads', request),
    uploadOffset: (request) => call(fetchFn, '/api/drive/uploads/offset', request),
    completeUpload: (request) => call(fetchFn, '/api/drive/uploads/complete', request),
    uploadFile(file) {
      const form = new FormData();
      form.set('sessionId', file.sessionId);
      form.set('key', file.key);
      form.set('name', file.name);
      form.set('file', file.blob, file.name);
      return call(fetchFn, '/api/drive/files', form);
    },
    notify: (request) => call(fetchFn, '/api/drive/notify', request),
    notifications: () => call(fetchFn, '/api/drive/notifications'),
    retryNotification: (sessionId, callStart, recording) =>
      call(fetchFn, '/api/drive/notifications', {
        sessionId,
        ...(callStart ? { call: callStart } : {}),
        ...(recording ? { recording: true } : {}),
      }),
    sendTestEmail: () => call(fetchFn, '/api/drive/test-email', {}),
  };
}

/** The page's one client. */
let shared: DriveApi | null = null;

/**
 * The page's API client.
 *
 * @returns The client.
 * Called from: features/drive/*, core/drive/picker.ts, core/drive/runner.ts
 */
export function driveApi(): DriveApi {
  shared ??= createDriveApi();
  return shared;
}

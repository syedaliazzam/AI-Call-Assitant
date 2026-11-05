/**
 * File: apps/desktop/src/security.ts
 * Purpose: Everything that keeps the desktop window safe:
 *          - only the Kite origins can be shown (navigation, redirects and new windows locked);
 *          - only http/https links ever reach the system browser;
 *          - only the microphone and screen/system-audio capture are granted, and only to the
 *            Kite origins (what is captured is decided in media.ts);
 *          - the renderer runs sandboxed with context isolation and no Node.js.
 * Used by: src/main.ts; tests/unit/security.test.ts
 * Depends on: electron (shell, Session, WebContents types)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3, §8.3 ("Malicious page inside
 *               the desktop shell"); CLAUDE.md "Desktop security"
 *
 * Every other origin is blocked. A future payment page or SSO provider on
 * another origin will NOT work until it is added to the allowlist on purpose (with a review).
 */
import { shell, type Session, type WebContents, type WebPreferences } from 'electron';

/**
 * Environment variable used ONLY by the smoke test: when set to '1', links that would open in
 * the system browser are recorded in memory instead, so a test run never launches a real
 * browser. It can only take capability away (nothing opens), never add any.
 */
export const NO_EXTERNAL_OPEN_ENV = 'KITE_TEST_NO_EXTERNAL_OPEN';

/**
 * Where test mode records would-be external opens. Also published as
 * globalThis.__kiteExternalOpens so the smoke test can read it from the main process.
 */
export const recordedExternalOpens: string[] = [];

/**
 * Tells whether a URL belongs to an allowed origin (same scheme, host and port).
 *
 * @param url           The URL to check (any string; invalid URLs are not allowed).
 * @param allowedOrigins The Kite origins, for example ['https://call.paramountintelligence.co'].
 * @returns True only for URLs on exactly one of those origins.
 * Called from: lockNavigation(), isPermissionAllowed()
 */
export function isAllowedUrl(url: string, allowedOrigins: readonly string[]): boolean {
  try {
    return allowedOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * Tells whether a URL may be handed to the operating system to open. Only http: and https:
 * are allowed; file:, javascript:, custom app schemes (which could start other programs) and
 * anything unparsable are refused.
 *
 * @param url The URL to check.
 * @returns True only for http and https URLs.
 * Called from: openInSystemBrowser()
 */
export function isExternalOpenAllowed(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Returns just the origin of a URL for logging, so paths and query strings (which may
 * contain tokens) never reach the log.
 *
 * @param url Any URL text.
 * @returns Its origin, or '(invalid url)'.
 */
function originForLog(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '(invalid url)';
  }
}

/**
 * Opens a link in the user's default browser, if it is an http/https link.
 * In smoke-test mode (KITE_TEST_NO_EXTERNAL_OPEN=1) it only records the URL.
 *
 * @param url The link the page tried to open.
 * @returns True if the link was opened (or recorded in test mode), false if refused.
 * Called from: the window-open handler in lockNavigation()
 */
export function openInSystemBrowser(url: string): boolean {
  if (!isExternalOpenAllowed(url)) {
    console.warn('desktop: refused to open a non-http(s) link externally');
    return false;
  }
  if (process.env[NO_EXTERNAL_OPEN_ENV] === '1') {
    recordedExternalOpens.push(url);
    (globalThis as { __kiteExternalOpens?: string[] }).__kiteExternalOpens = recordedExternalOpens;
    return true;
  }
  void shell.openExternal(url);
  return true;
}

/**
 * Locks a web contents (window or frame host) to the allowed origins:
 * - navigation and server redirects to another origin are cancelled (not opened anywhere);
 * - window.open / target="_blank" never creates an Electron window: http(s) targets open in
 *   the system browser, everything else is dropped;
 * - <webview> tags are refused.
 *
 * @param contents      The web contents to lock.
 * @param allowedOrigins The Kite origins.
 * Called from: the app's 'web-contents-created' handler in src/main.ts (so every web contents,
 *              including ones created later, is covered)
 */
export function lockNavigation(contents: WebContents, allowedOrigins: readonly string[]): void {
  contents.on('will-navigate', (event) => {
    if (!isAllowedUrl(event.url, allowedOrigins)) {
      event.preventDefault();
      console.warn('desktop: blocked navigation to', originForLog(event.url));
    }
  });
  contents.on('will-redirect', (event) => {
    if (!isAllowedUrl(event.url, allowedOrigins)) {
      event.preventDefault();
      console.warn('desktop: blocked redirect to', originForLog(event.url));
    }
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    openInSystemBrowser(url);
    return { action: 'deny' };
  });
}

/** What isPermissionAllowed() looks at. */
export interface PermissionQuery {
  /** Electron's permission name, for example 'media' or 'notifications'. */
  permission: string;
  /** Address of the page asking. */
  requestingUrl: string;
  /** For 'media': which devices ('audio', 'video'); empty or missing when unknown. */
  mediaTypes?: readonly string[];
}

/**
 * Decides one permission request or check. Allowed, and only for the Kite origin:
 * - 'media' for audio (microphone) alone;
 * - 'display-capture' (getDisplayMedia). Electron asks the permission handler BEFORE it calls
 *   the display-media handler in media.ts; without a grant getDisplayMedia fails with
 *   NotAllowedError (measured on Day 2). What is captured (screen + system audio, no picker) is
 *   decided in media.ts; this only lets the request reach it. See permissionForRequest() for
 *   how Electron 44 names that request.
 * - 'persistent-storage' (navigator.storage.persist()): keeps Kite's local sessions and
 *   documents (IndexedDB) from being cleared when the disk is short of space. Electron routes
 *   persist() through these handlers (Electron session docs, checked 2026-10-28), so without
 *   this grant it always fails in the desktop app, while Chrome may grant it. Day 3, ADR-0024.
 * Camera, notifications, location and everything else is denied.
 *
 * @param query         The permission, requesting URL and media types.
 * @param allowedOrigins The Kite origins.
 * @returns True to grant, false to deny.
 * Called from: allowOnlyOurPermissions()
 */
export function isPermissionAllowed(
  query: PermissionQuery,
  allowedOrigins: readonly string[],
): boolean {
  if (!isAllowedUrl(query.requestingUrl, allowedOrigins)) return false;
  if (query.permission === 'display-capture' || query.permission === 'persistent-storage') {
    return true;
  }
  if (query.permission !== 'media') return false;
  const types = query.mediaTypes ?? [];
  return types.length > 0 && types.every((type) => type === 'audio');
}

/**
 * The permission name to decide a REQUEST under. Electron 44 sends a getDisplayMedia() request
 * as permission 'media' with an EMPTY mediaTypes list (measured on Day 2; not documented),
 * whereas getUserMedia always lists 'audio' and/or 'video'. That one case is decided as
 * 'display-capture'; everything else keeps its own name. Checks (permission queries) are not
 * mapped, so an unknown media type there stays denied.
 *
 * @param permission Electron's permission name.
 * @param mediaTypes For 'media': the requested device types.
 * @returns The name to pass to isPermissionAllowed().
 * Called from: the request handler in allowOnlyOurPermissions(); tests
 */
export function permissionForRequest(permission: string, mediaTypes?: readonly string[]): string {
  return permission === 'media' && mediaTypes !== undefined && mediaTypes.length === 0
    ? 'display-capture'
    : permission;
}

/**
 * Installs the permission rules on a session: request handler (a page asks for access) and
 * check handler (a page asks whether it has access, for example navigator.permissions.query).
 * USB, serial and HID device access is denied outright.
 *
 * @param session       The session the Kite window uses (the default session).
 * @param allowedOrigins The Kite origins.
 * Called from: start() in src/main.ts, once the app is ready
 */
export function allowOnlyOurPermissions(session: Session, allowedOrigins: readonly string[]): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    callback(
      isPermissionAllowed(
        {
          permission: permissionForRequest(permission, mediaTypes),
          requestingUrl: details.requestingUrl,
          mediaTypes,
        },
        allowedOrigins,
      ),
    );
  });
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    const mediaType = details.mediaType;
    return isPermissionAllowed(
      {
        permission,
        requestingUrl: requestingOrigin,
        mediaTypes: mediaType ? [mediaType] : [],
      },
      allowedOrigins,
    );
  });
  session.setDevicePermissionHandler(() => false);
}

/**
 * The web preferences every Kite window uses.
 * - contextIsolation: the page and the preload run in separate JavaScript worlds, so the page
 *   cannot reach Electron or Node objects through the preload.
 * - sandbox: the renderer runs in Chromium's OS-level sandbox.
 * - nodeIntegration off (also in sub-frames): the page has no `require` and no `process`.
 * - webSecurity on and insecure content off: normal browser same-origin rules apply.
 * - webviewTag off: pages cannot embed other sites with <webview>.
 * The app version is passed to the preload as an argument because a sandboxed preload cannot
 * call app.getVersion().
 *
 * @param preloadPath Absolute path to dist/preload.js.
 * @param appVersion  The shell version (app.getVersion()).
 * @returns WebPreferences for new BrowserWindow({ webPreferences }).
 * Called from: createMainWindow() in src/main.ts
 */
export function secureWebPreferences(preloadPath: string, appVersion: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    additionalArguments: [`--kite-version=${appVersion}`],
  };
}

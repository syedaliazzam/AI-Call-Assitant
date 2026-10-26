/**
 * File: apps/desktop/src/security.ts
 * Purpose: Everything that keeps the desktop window safe:
 *          - only the Kite origin can be shown (navigation, redirects and new windows locked);
 *          - only http/https links ever reach the system browser;
 *          - only the microphone permission is granted, and only to the Kite origin;
 *          - the renderer runs sandboxed with context isolation and no Node.js.
 * Used by: src/main.ts; tests/unit/security.test.ts
 * Depends on: electron (shell, Session, WebContents types)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3, §8.3 ("Malicious page inside
 *               the desktop shell"); CLAUDE.md "Desktop security"
 *
 * Every origin other than ALLOWED_ORIGIN is blocked. A future payment page or SSO provider on
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
 * Tells whether a URL belongs to the allowed origin (same scheme, host and port).
 *
 * @param url           The URL to check (any string; invalid URLs are not allowed).
 * @param allowedOrigin The Kite origin, for example 'https://kite-call-assistant.vercel.app'.
 * @returns True only for URLs on exactly that origin.
 * Called from: lockNavigation(), isPermissionAllowed()
 */
export function isAllowedUrl(url: string, allowedOrigin: string): boolean {
  try {
    return new URL(url).origin === allowedOrigin;
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
 * Locks a web contents (window or frame host) to the allowed origin:
 * - navigation and server redirects to another origin are cancelled (not opened anywhere);
 * - window.open / target="_blank" never creates an Electron window: http(s) targets open in
 *   the system browser, everything else is dropped;
 * - <webview> tags are refused.
 *
 * @param contents      The web contents to lock.
 * @param allowedOrigin The Kite origin.
 * Called from: the app's 'web-contents-created' handler in src/main.ts (so every web contents,
 *              including ones created later, is covered)
 */
export function lockNavigation(contents: WebContents, allowedOrigin: string): void {
  contents.on('will-navigate', (event) => {
    if (!isAllowedUrl(event.url, allowedOrigin)) {
      event.preventDefault();
      console.warn('desktop: blocked navigation to', originForLog(event.url));
    }
  });
  contents.on('will-redirect', (event) => {
    if (!isAllowedUrl(event.url, allowedOrigin)) {
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
 * Decides one permission request or check. Only 'media' for audio (microphone) alone, asked
 * by the Kite origin, is allowed. Camera, screen, notifications, location and everything else
 * is denied. (Screen and system-audio capture for the other side arrive on Day 2, media.ts.)
 *
 * @param query         The permission, requesting URL and media types.
 * @param allowedOrigin The Kite origin.
 * @returns True to grant, false to deny.
 * Called from: allowOnlyOurPermissions()
 */
export function isPermissionAllowed(query: PermissionQuery, allowedOrigin: string): boolean {
  if (query.permission !== 'media') return false;
  if (!isAllowedUrl(query.requestingUrl, allowedOrigin)) return false;
  const types = query.mediaTypes ?? [];
  return types.length > 0 && types.every((type) => type === 'audio');
}

/**
 * Installs the permission rules on a session: request handler (a page asks for access) and
 * check handler (a page asks whether it has access, for example navigator.permissions.query).
 * USB, serial and HID device access is denied outright.
 *
 * @param session       The session the Kite window uses (the default session).
 * @param allowedOrigin The Kite origin.
 * Called from: start() in src/main.ts, once the app is ready
 */
export function allowOnlyOurPermissions(session: Session, allowedOrigin: string): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    callback(
      isPermissionAllowed(
        { permission, requestingUrl: details.requestingUrl, mediaTypes },
        allowedOrigin,
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
      allowedOrigin,
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

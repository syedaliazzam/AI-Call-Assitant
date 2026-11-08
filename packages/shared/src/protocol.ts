/**
 * File: packages/shared/src/protocol.ts
 * Purpose: The paramountai:// links that open the desktop app from a browser (spec S9). A link carries
 *          at most a session id, checked to be a UUID, and (desktop 1.3.0, ADR-0052) a one-time sign-in
 *          code of exactly 43 base64url characters; nothing else in it is ever read, because any web
 *          page can send one. A link only brings a window forward: it never starts a call.
 * Used by: apps/web/src/features/shell/*, apps/web/src/features/handoff/*, apps/desktop/src/main.ts
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S9); ADR-0045, ADR-0052
 */

/** The scheme the desktop app registers. */
export const DESKTOP_PROTOCOL = 'paramountai';

/** A link that only opens the desktop app. */
export const DESKTOP_OPEN_LINK = `${DESKTOP_PROTOCOL}://open`;

/** A session id: the UUID crypto.randomUUID() makes. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A one-time sign-in code in a link (ADR-0052): 32 random bytes, base64url, so 43 characters. */
export const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The link that opens one session in the desktop app.
 *
 * @param sessionId The session's id.
 * @param code      A one-time sign-in code (ADR-0052), or none.
 * @returns The link.
 * Called from: apps/web/src/features/handoff/*; tests
 */
export function desktopSessionLink(sessionId: string, code?: string): string {
  return `${DESKTOP_PROTOCOL}://session/${sessionId}${code ? `/${code}` : ''}`;
}

/**
 * The name of the file a browser saves for the desktop app (spec S9).
 *
 * @param sessionId The session's id.
 * @returns For example "paramount-ai-session-86495cda.json".
 * Called from: apps/web/src/core/session/handoff.ts, the hand-off screens; tests
 */
export function handoffFileName(sessionId: string): string {
  return `paramount-ai-session-${sessionId.slice(0, 8)}.json`;
}

/** What a paramountai:// link asks for. */
export type DesktopLink =
  /** Bring the app forward. */
  | {
      /** Which kind of link. */
      kind: 'open';
    }
  /** Bring the app forward on this session. */
  | {
      /** Which kind of link. */
      kind: 'session';
      /** The session's id, already checked. */
      sessionId: string;
      /** A one-time sign-in code (ADR-0052), already checked; absent in a link without one. */
      code?: string;
    };

/**
 * Reads a paramountai:// link. Query strings, fragments, credentials and extra path parts make it
 * invalid: the link has exactly three shapes (open; session/<id>; session/<id>/<code>, ADR-0052).
 *
 * @param text The link, as the operating system passed it.
 * @returns What it asks for, or null when it is not a valid link.
 * Called from: apps/desktop/src/main.ts; tests
 */
export function parseDesktopLink(text: string): DesktopLink | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== `${DESKTOP_PROTOCOL}:`) return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;
  if (url.hostname === 'open' && (url.pathname === '' || url.pathname === '/')) {
    return { kind: 'open' };
  }
  if (url.hostname !== 'session') return null;
  const parts = url.pathname.replace(/^\//, '').split('/');
  const [sessionId = '', code] = parts;
  if (parts.length > 2 || !SESSION_ID.test(sessionId)) return null;
  if (code === undefined) return { kind: 'session', sessionId };
  return LINK_CODE_PATTERN.test(code) ? { kind: 'session', sessionId, code } : null;
}

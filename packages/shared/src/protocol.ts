/**
 * File: packages/shared/src/protocol.ts
 * Purpose: The paramountai:// links that open the desktop app from a browser (spec S9). A link carries
 *          at most a session id, checked to be a UUID; nothing else in it is ever read, because any web
 *          page can send one. A link only brings a window forward: it never starts a call.
 * Used by: apps/web/src/features/shell/*, apps/desktop/src/main.ts
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S9)
 */

/** The scheme the desktop app registers. */
export const DESKTOP_PROTOCOL = 'paramountai';

/** A link that only opens the desktop app. */
export const DESKTOP_OPEN_LINK = `${DESKTOP_PROTOCOL}://open`;

/** A session id: the UUID crypto.randomUUID() makes. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The link that opens one session in the desktop app.
 *
 * @param sessionId The session's id.
 * @returns The link.
 * Called from: apps/web/src/features/session-setup/*; tests
 */
export function desktopSessionLink(sessionId: string): string {
  return `${DESKTOP_PROTOCOL}://session/${sessionId}`;
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
    };

/**
 * Reads a paramountai:// link. Query strings, fragments, credentials and extra path parts make it
 * invalid: the link has exactly two shapes.
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
  const sessionId = url.pathname.replace(/^\//, '');
  return SESSION_ID.test(sessionId) ? { kind: 'session', sessionId } : null;
}

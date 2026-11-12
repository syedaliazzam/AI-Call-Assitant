/**
 * File: apps/desktop/src/links.ts
 * Purpose: paramountai:// links in the desktop app (spec S9): finds a link in the command line, decides
 *          what a link does (routeDesktopLink, 1.6.1), and when the app registers the protocol. Since 1.3.0 (ADR-0052) a link
 *          may carry a one-time sign-in code; the session file hand-off of 1.2.0 (ADR-0045) is gone.
 * Used by: src/main.ts; tests/unit/links.test.ts
 * Depends on: @kite/shared (the link)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S9); ADR-0045, ADR-0052
 */
import { DESKTOP_PROTOCOL, parseDesktopLink, type DesktopLink } from '@kite/shared';

/**
 * Finds a paramountai:// link among a process's arguments. Windows passes the link as an argument, both
 * on a first start and to a running copy.
 *
 * @param argv The arguments.
 * @returns What the link asks for, or null when there is no valid one.
 * Called from: main.ts; tests
 */
export function linkFromArgv(argv: readonly string[]): DesktopLink | null {
  const raw = argv.find((arg) => arg.startsWith(`${DESKTOP_PROTOCOL}://`));
  return raw ? parseDesktopLink(raw) : null;
}

/** What a link can make the app do (main.ts gives the real windows; tests give spies). */
export interface LinkRoutes {
  /**
   * Opens the panel on a session's Start card (through the link page when there is a sign-in code).
   * @param sessionId The session.
   * @param code      The link's one-time sign-in code, if any.
   */
  openSession: (sessionId: string, code?: string) => void;
  /**
   * Opens the player on a recording.
   * @param page The player's path, /player/<id>.
   */
  openPlayer: (page: string) => void;
  /** Brings up the first window a person should see (the overlay during a call, else the panel). */
  showFront: () => void;
}

/**
 * Acts on a paramountai:// link, the same way at a first start and in a running app (1.6.1: one decision
 * for both, tested). A session link opens its Start card unless a call is running (it never starts or
 * changes anything: a link can come from any web page); a recording link opens the player; anything
 * else brings the app forward.
 *
 * @param link       What the link asks for, or null for none or an invalid one.
 * @param callActive True while a call runs (a first start has none).
 * @param routes     What to do.
 * @returns Nothing.
 * Called from: followLink() and the first start in main.ts; tests
 */
export function routeDesktopLink(
  link: DesktopLink | null,
  callActive: boolean,
  routes: LinkRoutes,
): void {
  // 1.5.0 (ADR-0068): a recording link opens the player; the page says when the file is not here.
  if (link?.kind === 'recording') routes.openPlayer(`/player/${link.recordingId}`);
  else if (link?.kind === 'session' && !callActive) routes.openSession(link.sessionId, link.code);
  else routes.showFront();
}

/**
 * Whether this run should register the protocol with the system. Only an installed app, on its own
 * profile: a test run (--user-data-dir) must never change what the person's computer opens.
 *
 * @param context.isPackaged           True in an installed app.
 * @param context.hasUserDataDirSwitch True when --user-data-dir was passed.
 * @returns True to register.
 * Called from: start() in main.ts; tests
 */
export function shouldRegisterProtocol(context: {
  /** True in an installed app. */
  isPackaged: boolean;
  /** True when --user-data-dir was passed (every test run). */
  hasUserDataDirSwitch: boolean;
}): boolean {
  return context.isPackaged && !context.hasUserDataDirSwitch;
}

/**
 * File: apps/desktop/src/links.ts
 * Purpose: paramountai:// links in the desktop app (spec S9): finds a link in the command line, and
 *          decides when the app registers the protocol with the system. Since 1.3.0 (ADR-0052) a link
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

/**
 * File: apps/desktop/src/drive/notice.ts
 * Purpose: The native "saved to Google Drive" notification (desktop 1.6.0, ADR-0072): two short lines
 *          from the page, and a click that opens the session's Drive folder in the system browser. Only a
 *          https://drive.google.com address is ever opened; anything else is shown without a link.
 * Used by: src/drive/host.ts; tests/unit/drive.test.ts
 * Depends on: @kite/shared (DesktopNotice, isDriveLink)
 * Architecture: docs/decisions/ADR-0072-google-drive-saving.md
 */
import { isDriveLink, type DesktopNotice } from '@kite/shared';

/** The longest line kept, characters. */
export const NOTICE_MAX_CHARS = 200;

/** The part of an Electron Notification used here. */
export interface NoticeLike {
  /**
   * Listens for a click.
   * @param event    'click'.
   * @param listener The handler.
   */
  on(event: 'click', listener: () => void): void;
  /** Shows it. */
  show(): void;
}

/** What showNotice() needs (Electron's Notification and shell, or fakes). */
export interface NoticeDeps {
  /** Whether the system can show notifications. */
  supported(): boolean;
  /**
   * Makes a notification.
   * @param options Its title and body.
   */
  create(options: {
    /** The first line. */
    title: string;
    /** The second line. */
    body: string;
  }): NoticeLike;
  /**
   * Opens an address in the system browser.
   * @param url The address (a Drive link).
   */
  openExternal(url: string): void;
}

/**
 * Whether a value is a notice the shell accepts.
 * @param value What arrived over IPC.
 * @returns True for two non-empty strings and, when present, a Drive link.
 * Called from: showNotice(); tests
 */
export function isNotice(value: unknown): value is DesktopNotice {
  const n = value as Partial<DesktopNotice> | null;
  return (
    !!n &&
    typeof n.title === 'string' &&
    n.title.trim() !== '' &&
    typeof n.body === 'string' &&
    (n.url === undefined || (typeof n.url === 'string' && isDriveLink(n.url)))
  );
}

/**
 * Shows the notification.
 * @param deps   Electron's Notification and shell.
 * @param notice What arrived over IPC (checked here).
 * @returns False when it was refused or the system cannot show one.
 * Called from: the SHOW_NOTICE_CHANNEL handler in host.ts; tests
 */
export function showNotice(deps: NoticeDeps, notice: unknown): boolean {
  if (!isNotice(notice) || !deps.supported()) return false;
  const shown = deps.create({
    title: notice.title.slice(0, NOTICE_MAX_CHARS),
    body: notice.body.slice(0, NOTICE_MAX_CHARS),
  });
  const url = notice.url;
  if (url) shown.on('click', () => deps.openExternal(url));
  shown.show();
  return true;
}

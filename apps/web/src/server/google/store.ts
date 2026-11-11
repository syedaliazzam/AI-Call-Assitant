/**
 * File: apps/web/src/server/google/store.ts
 * Purpose: The google_drive and drive_notification rows (ADR-0072): saving the encrypted refresh
 *          token, the picked folder and the person's switches; marking a connection "reconnect";
 *          deleting it; and the one-email-per-session record (claimed by an INSERT that only one
 *          request can win, so a retried upload never sends a second email). Every statement is
 *          limited to one account.
 * Used by: src/server/google/api.ts, src/server/google/tokens.ts
 * Depends on: drizzle-orm, src/server/schema.ts, src/server/calldata/crypto.ts (seal, open),
 *             src/server/calldata/store.ts (CallDataDb type)
 * Architecture: ADR-0072 (encryption as ADR-0049; migrations additive only, ADR-0050)
 *
 * Nothing here logs. Tokens, addresses, titles and file names are only ever held encrypted or in memory.
 */
import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DriveNotificationStatus, DriveSavedFile } from '@kite/shared';
import { open, seal, type DataKeys } from '../calldata/crypto';
import type { CallDataDb } from '../calldata/store';
import { driveNotification, googleDrive } from '../schema';

/** The GCM binding kind of a refresh token (never a call_record kind). */
const TOKEN_KIND = 'google-refresh-token';

/** The GCM binding kind of a notification's content. */
const NOTIFICATION_KIND = 'drive-notification';

/** A connection as the handlers use it (the token still encrypted). */
export type DriveConnectionRow = typeof googleDrive.$inferSelect;

/**
 * The account's connection.
 *
 * @param db     The database.
 * @param userId The account.
 * @returns The row, or null when not connected.
 * Called from: api.ts, tokens.ts; tests
 */
export async function getConnection(
  db: CallDataDb,
  userId: string,
): Promise<DriveConnectionRow | null> {
  const rows = await db.select().from(googleDrive).where(eq(googleDrive.userId, userId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Stores a new refresh token (connect or reconnect). A reconnect keeps the folder, the switches and
 * the team list, so queued uploads carry on where they were.
 *
 * @param db           The database.
 * @param keys         The data keys.
 * @param userId       The account.
 * @param refreshToken The token from Google (encrypted here, never stored readable).
 * @returns When stored.
 * Called from: handleCallback() in api.ts; tests
 */
export async function saveConnection(
  db: CallDataDb,
  keys: DataKeys,
  userId: string,
  refreshToken: string,
): Promise<void> {
  const sealed = seal(keys, { userId, kind: TOKEN_KIND, id: userId }, refreshToken);
  const now = new Date();
  await db
    .insert(googleDrive)
    .values({
      userId,
      keyVersion: sealed.keyVersion,
      refreshToken: sealed.content,
      status: 'connected',
      connectedAt: now,
    })
    .onConflictDoUpdate({
      target: googleDrive.userId,
      set: {
        keyVersion: sealed.keyVersion,
        refreshToken: sealed.content,
        status: 'connected',
        connectedAt: now,
        updatedAt: now,
      },
    });
}

/**
 * Decrypts a connection's refresh token (in memory only, for one refresh or the revoke).
 *
 * @param keys The data keys.
 * @param row  The connection.
 * @returns The token.
 * @throws DataKeyError when its key version is not set; Error when the ciphertext does not belong to
 *         this account.
 * Called from: tokens.ts, api.ts (disconnect); tests
 */
export function readRefreshToken(keys: DataKeys, row: DriveConnectionRow): string {
  return open(
    keys,
    { userId: row.userId, kind: TOKEN_KIND, id: row.userId },
    row.keyVersion,
    row.refreshToken,
  );
}

/**
 * Stores the picked folder.
 *
 * @param db     The database.
 * @param userId The account.
 * @param folder The folder as Drive describes it.
 * @returns False when the account is not connected.
 * Called from: handleFolder() in api.ts; tests
 */
export async function setFolder(
  db: CallDataDb,
  userId: string,
  folder: { id: string; name: string; driveId: string | null },
): Promise<boolean> {
  const rows = await db
    .update(googleDrive)
    .set({ folderId: folder.id, folderName: folder.name, driveId: folder.driveId })
    .where(eq(googleDrive.userId, userId))
    .returning({ userId: googleDrive.userId });
  return rows.length > 0;
}

/** The switches and team list Settings changes. */
export interface DriveSettingsPatch {
  /** "Save calls to Google Drive". */
  saveEnabled?: boolean;
  /** "Email me when a call is saved". */
  emailEnabled?: boolean;
  /** The team list, already checked and lower-cased. */
  alsoNotify?: string[];
}

/**
 * Changes the person's switches or team list.
 *
 * @param db     The database.
 * @param userId The account.
 * @param patch  What changes.
 * @returns False when the account is not connected.
 * Called from: handleSettings() in api.ts; tests
 */
export async function updateSettings(
  db: CallDataDb,
  userId: string,
  patch: DriveSettingsPatch,
): Promise<boolean> {
  if (Object.keys(patch).length === 0) return (await getConnection(db, userId)) !== null;
  const rows = await db
    .update(googleDrive)
    .set(patch)
    .where(eq(googleDrive.userId, userId))
    .returning({ userId: googleDrive.userId });
  return rows.length > 0;
}

/**
 * Marks a connection "reconnect": Google refused its token. The row (folder, switches) stays.
 *
 * @param db     The database.
 * @param userId The account.
 * @returns When done.
 * Called from: tokens.ts; tests
 */
export async function markReconnect(db: CallDataDb, userId: string): Promise<void> {
  await db.update(googleDrive).set({ status: 'reconnect' }).where(eq(googleDrive.userId, userId));
}

/**
 * Deletes the connection (Disconnect, after the token was revoked).
 *
 * @param db     The database.
 * @param userId The account.
 * @returns When done.
 * Called from: handleDisconnect() in api.ts; tests
 */
export async function deleteConnection(db: CallDataDb, userId: string): Promise<void> {
  await db.delete(googleDrive).where(eq(googleDrive.userId, userId));
}

/** What a "saved" email says, stored encrypted so a failed one can be sent again. */
export interface NotificationContent {
  /** The session's title. */
  title: string;
  /** When the call started (Unix ms). */
  callStartedAt: number;
  /** The call's length, ms. */
  durationMs: number;
  /** The files saved. */
  files: DriveSavedFile[];
  /** The session folder's address. */
  folderUrl: string;
  /** The person's time zone, for the date. */
  timeZone: string;
  /** Every address the email goes to (the person first). */
  recipients: string[];
}

/**
 * The GCM binding of a notification: the account and the session.
 * @param userId    The account.
 * @param sessionId The session.
 * @returns The binding.
 */
function notificationBinding(userId: string, sessionId: string) {
  return { userId, kind: NOTIFICATION_KIND, id: sessionId };
}

/**
 * Records that a session's uploads finished, once: the first request inserts the row and may send;
 * any later one (a retried upload, a second call, another device) finds it and sends nothing.
 *
 * @param db        The database.
 * @param keys      The data keys.
 * @param userId    The account.
 * @param sessionId The session.
 * @param content   What the email says.
 * @param status    The row's first state: 'pending' (about to send), 'off' or 'not-set-up'.
 * @returns claimed: true when this request inserted the row; otherwise the existing state.
 * Called from: handleNotify() in api.ts; tests
 */
export async function claimNotification(
  db: CallDataDb,
  keys: DataKeys,
  userId: string,
  sessionId: string,
  content: NotificationContent,
  status: Extract<DriveNotificationStatus, 'pending' | 'off' | 'not-set-up'>,
): Promise<{ claimed: true } | { claimed: false; status: DriveNotificationStatus }> {
  const sealed = seal(keys, notificationBinding(userId, sessionId), JSON.stringify(content));
  const inserted = await db
    .insert(driveNotification)
    .values({
      userId,
      sessionId,
      status,
      keyVersion: sealed.keyVersion,
      content: sealed.content,
      attempts: status === 'pending' ? 1 : 0,
    })
    // The primary key (account, session) makes this the one-email-per-session guarantee.
    .onConflictDoNothing()
    .returning({ sessionId: driveNotification.sessionId });
  if (inserted.length > 0) return { claimed: true };
  const existing = await db
    .select({ status: driveNotification.status })
    .from(driveNotification)
    .where(and(eq(driveNotification.userId, userId), eq(driveNotification.sessionId, sessionId)))
    .limit(1);
  return { claimed: false, status: (existing[0]?.status ?? 'pending') as DriveNotificationStatus };
}

/**
 * Takes a failed (or not-set-up) email for sending again: only one request can take it, because the
 * update only matches while it is still in one of those states.
 *
 * @param db        The database.
 * @param keys      The data keys.
 * @param userId    The account.
 * @param sessionId The session.
 * @returns Its content, or null when there is nothing to retry (sent, pending, off, or unknown).
 * Called from: handleRetry() in api.ts; tests
 */
export async function claimRetry(
  db: CallDataDb,
  keys: DataKeys,
  userId: string,
  sessionId: string,
): Promise<{ content: NotificationContent; attempt: number } | null> {
  const rows = await db
    .update(driveNotification)
    // One statement: the state check and the attempt count change together.
    .set({ status: 'pending', error: null, attempts: sql`${driveNotification.attempts} + 1` })
    .where(
      and(
        eq(driveNotification.userId, userId),
        eq(driveNotification.sessionId, sessionId),
        inArray(driveNotification.status, ['failed', 'not-set-up']),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) return null;
  return {
    content: JSON.parse(
      open(keys, notificationBinding(userId, sessionId), row.keyVersion, row.content),
    ) as NotificationContent,
    attempt: row.attempts,
  };
}

/**
 * Records how sending went.
 *
 * @param db        The database.
 * @param userId    The account.
 * @param sessionId The session.
 * @param outcome   'sent', or 'failed' with a short code.
 * @param now       The clock.
 * @returns When done.
 * Called from: api.ts (notify, retry); tests
 */
export async function finishNotification(
  db: CallDataDb,
  userId: string,
  sessionId: string,
  outcome: { status: 'sent' } | { status: 'failed'; error: string },
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(driveNotification)
    .set(
      outcome.status === 'sent'
        ? { status: 'sent', sentAt: now, error: null }
        : { status: 'failed', error: outcome.error },
    )
    .where(and(eq(driveNotification.userId, userId), eq(driveNotification.sessionId, sessionId)));
}

/** One notification, decrypted for its owner. */
export interface NotificationRow {
  /** The session. */
  sessionId: string;
  /** Its state. */
  status: DriveNotificationStatus;
  /** What it says. */
  content: NotificationContent;
  /** When the uploads finished. */
  createdAt: Date;
  /** When it was sent, or null. */
  sentAt: Date | null;
}

/**
 * The account's latest notifications. A row whose content cannot be decrypted (a key was removed) is
 * left out rather than failing the list.
 *
 * @param db     The database.
 * @param keys   The data keys.
 * @param userId The account.
 * @param limit  How many.
 * @returns Newest first.
 * Called from: handleNotifications() in api.ts; tests
 */
export async function listNotifications(
  db: CallDataDb,
  keys: DataKeys,
  userId: string,
  limit: number,
): Promise<NotificationRow[]> {
  const rows = await db
    .select()
    .from(driveNotification)
    .where(eq(driveNotification.userId, userId))
    .orderBy(desc(driveNotification.createdAt))
    .limit(limit);
  const out: NotificationRow[] = [];
  for (const row of rows) {
    try {
      out.push({
        sessionId: row.sessionId,
        status: row.status as DriveNotificationStatus,
        content: JSON.parse(
          open(keys, notificationBinding(userId, row.sessionId), row.keyVersion, row.content),
        ) as NotificationContent,
        createdAt: row.createdAt,
        sentAt: row.sentAt,
      });
    } catch {
      // Unreadable (a removed key): skipped; nothing about it is logged.
    }
  }
  return out;
}

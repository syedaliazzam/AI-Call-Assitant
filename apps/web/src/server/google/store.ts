/**
 * File: apps/web/src/server/google/store.ts
 * Purpose: The drive_notification rows (ADR-0072; the company connection and each person's choices are
 *          in company.ts since ADR-0074): the one-email-per-call record (ADR-0073: per call, keyed by report.ts
 *          notificationKey, which the functions below take as `sessionId`): the devices' reports merged into it
 *          (compare-and-swap, as the driver has no transactions), "collecting" until every file is in,
 *          then taken for its one email by an update only one request can win. Every statement is
 *          limited to one account, except the daily overdue list. ADR-0096: one session's records of one
 *          account, for the Meetings library's file links.
 * Used by: src/server/google/api.ts
 * Depends on: drizzle-orm, src/server/schema.ts, src/server/calldata/crypto.ts (seal, open),
 *             src/server/calldata/store.ts (CallDataDb type)
 * Architecture: ADR-0072, ADR-0073 (encryption as ADR-0049; migrations additive only, ADR-0050)
 *
 * Nothing here logs. Tokens, addresses, titles and file names are only ever held encrypted or in memory.
 */
import 'server-only';
import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { DriveExpectedRecording, DriveNotificationStatus, DriveSavedFile } from '@kite/shared';
import { open, seal, type DataKeys } from '../calldata/crypto';
import type { CallDataDb } from '../calldata/store';
import { driveNotification, user } from '../schema';

/** The GCM binding kind of a notification's content. */
const NOTIFICATION_KIND = 'drive-notification';

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
  /** Every address the email goes (or went) to, the person first; worked out when it is sent. */
  recipients: string[];
  /** The session's own Also notify list (null: the Settings list). Absent in older records. */
  alsoNotify?: string[] | null;
  /** The recording parts the account knows the session has (the email waits for them). */
  expected?: DriveExpectedRecording[];
  /** Recordings whose files were deleted: not waited for. */
  gone?: string[];
  /** True when the email went without the recording, whose upload had not finished (24 hours). */
  recordingPending?: boolean;
  /**
   * ADR-0077: 'two-step' for calls ended from 13 Nov 2026 on (email 1 "Call saved", email 2 "Recording
   * saved"); absent for the older single email.
   */
  rule?: 'two-step';
  /** ADR-0077: 'recording' for a call's "Recording saved" record (email 2); absent for email 1. */
  kind?: 'recording';
  /** ADR-0077: true once the call's transcript and notes are in Drive (email 1 may go). */
  callFilesSaved?: boolean;
  /** ADR-0077: the session's Recordings subfolder, linked in both emails. */
  recordingsFolderUrl?: string;
  /**
   * ADR-0093: the other person's name for the call (cleanPersonName()), shown as "With" in the call's
   * emails. Absent when no name is known (the "Them" / "Interviewer" fallbacks are never sent).
   */
  withName?: string;
  /** ADR-0077: email 2 went after 24 hours without the recording ("Recording not uploaded"). */
  recordingMissing?: boolean;
  /** ADR-0077: when sending was last tried (Unix ms); a failed email is tried again an hour later. */
  lastTriedAt?: number;
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

/** A session's record as read: its state, when its first report came, and its content. */
export interface NotificationRecord {
  /** Its state. */
  status: DriveNotificationStatus;
  /** When the first report came. */
  createdAt: Date;
  /** The content, decrypted. */
  content: NotificationContent;
  /** The stored ciphertext, as the compare-and-swap "version" (a new IV every write). */
  version: string;
}

/**
 * Reads one session's record.
 *
 * @param db        The database.
 * @param keys      The data keys.
 * @param userId    The account.
 * @param sessionId The session.
 * @returns The record, or null.
 * @throws DataKeyError or a decryption error when the content cannot be read.
 * Called from: writeRecord(), api.ts; tests
 */
export async function readRecord(
  db: CallDataDb,
  keys: DataKeys,
  userId: string,
  sessionId: string,
): Promise<NotificationRecord | null> {
  const rows = await db
    .select()
    .from(driveNotification)
    .where(and(eq(driveNotification.userId, userId), eq(driveNotification.sessionId, sessionId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status as DriveNotificationStatus,
    createdAt: row.createdAt,
    content: JSON.parse(
      open(keys, notificationBinding(userId, sessionId), row.keyVersion, row.content),
    ) as NotificationContent,
    version: row.content,
  };
}

/**
 * Changes one session's record safely when several devices report at once (the database driver has no
 * transactions): the change is computed from what was read and written only if nobody wrote in
 * between (the ciphertext, new on every write, is the version); otherwise it is read and computed again.
 * A missing record is created with state 'collecting' (the primary key lets only one creation win).
 *
 * @param db        The database.
 * @param keys      The data keys.
 * @param userId    The account.
 * @param sessionId The session.
 * @param change    Makes the new content from the current one (null when there is no record yet).
 * @param createAs  A new record's state: 'collecting' (emailed when complete), or 'not-set-up' (a session
 *                  that is only emailed by hand, with "Send email" in Settings).
 * @returns The record as written.
 * @throws Error('BUSY') after five lost races (practically never).
 * Called from: api.ts (reports, the pending flag); tests
 */
export async function writeRecord(
  db: CallDataDb,
  keys: DataKeys,
  userId: string,
  sessionId: string,
  change: (current: NotificationContent | null) => NotificationContent,
  createAs: 'collecting' | 'not-set-up' = 'collecting',
): Promise<NotificationRecord> {
  for (let tries = 0; tries < 5; tries += 1) {
    const current = await readRecord(db, keys, userId, sessionId);
    const content = change(current?.content ?? null);
    const sealed = seal(keys, notificationBinding(userId, sessionId), JSON.stringify(content));
    if (!current) {
      const inserted = await db
        .insert(driveNotification)
        .values({
          userId,
          sessionId,
          status: createAs,
          keyVersion: sealed.keyVersion,
          content: sealed.content,
        })
        // The primary key (account, session): one record, so one email, per session.
        .onConflictDoNothing()
        .returning({ createdAt: driveNotification.createdAt });
      if (inserted[0]) {
        return {
          status: createAs,
          createdAt: inserted[0].createdAt,
          content,
          version: sealed.content,
        };
      }
      continue;
    }
    const updated = await db
      .update(driveNotification)
      .set({ keyVersion: sealed.keyVersion, content: sealed.content })
      .where(
        and(
          eq(driveNotification.userId, userId),
          eq(driveNotification.sessionId, sessionId),
          eq(driveNotification.content, current.version),
        ),
      )
      .returning({ status: driveNotification.status });
    if (updated[0]) {
      return {
        status: updated[0].status as DriveNotificationStatus,
        createdAt: current.createdAt,
        content,
        version: sealed.content,
      };
    }
  }
  throw new Error('BUSY');
}

/**
 * Takes a collecting record for its one email: only one request can, because the update only matches
 * while it is still 'collecting'.
 *
 * @param db        The database.
 * @param userId    The account.
 * @param sessionId The session.
 * @param status    What it becomes: 'pending' (sending now), 'off' or 'not-set-up'.
 * @returns The attempt number (1) when taken, or null when another request took it.
 * Called from: api.ts (sendIfDue); tests
 */
export async function claimCollecting(
  db: CallDataDb,
  userId: string,
  sessionId: string,
  status: Extract<DriveNotificationStatus, 'pending' | 'off' | 'not-set-up'>,
): Promise<number | null> {
  const rows = await db
    .update(driveNotification)
    .set({
      status,
      ...(status === 'pending' ? { attempts: sql`${driveNotification.attempts} + 1` } : {}),
    })
    .where(
      and(
        eq(driveNotification.userId, userId),
        eq(driveNotification.sessionId, sessionId),
        eq(driveNotification.status, 'collecting'),
      ),
    )
    .returning({ attempts: driveNotification.attempts });
  return rows[0] ? Math.max(1, rows[0].attempts) : null;
}

/**
 * The sessions still collecting files whose first report is older than a time: their email is due
 * without the recording. For one account, or (the daily job) for every account, with the address.
 *
 * @param db     The database.
 * @param before Reports older than this.
 * @param userId Only this account, or null for all.
 * @returns Each session's account, address and id.
 * Called from: api.ts (flushOverdue); tests
 */
export async function listOverdue(
  db: CallDataDb,
  before: Date,
  userId: string | null,
): Promise<{ userId: string; email: string; sessionId: string }[]> {
  return db
    .select({
      userId: driveNotification.userId,
      email: user.email,
      sessionId: driveNotification.sessionId,
    })
    .from(driveNotification)
    .innerJoin(user, eq(user.id, driveNotification.userId))
    .where(
      and(
        eq(driveNotification.status, 'collecting'),
        lt(driveNotification.createdAt, before),
        ...(userId ? [eq(driveNotification.userId, userId)] : []),
      ),
    )
    .limit(100);
}

/**
 * ADR-0077: records whose email failed (or found email not set up) since a time, for trying again by
 * itself: for one account, or (the scheduled job) for every account, with the address and the attempts so
 * far. The caller reads each record and tries only two-step ones (never older calls by themselves).
 *
 * @param db     The database.
 * @param since  Records first reported after this.
 * @param userId Only this account, or null for all.
 * @returns Each record's account, address, key and attempts (at most 100).
 * Called from: api.ts (retryFailed); tests
 */
export async function listRetryCandidates(
  db: CallDataDb,
  since: Date,
  userId: string | null,
): Promise<{ userId: string; email: string; sessionId: string; attempts: number }[]> {
  return db
    .select({
      userId: driveNotification.userId,
      email: user.email,
      sessionId: driveNotification.sessionId,
      attempts: driveNotification.attempts,
    })
    .from(driveNotification)
    .innerJoin(user, eq(user.id, driveNotification.userId))
    .where(
      and(
        inArray(driveNotification.status, ['failed', 'not-set-up']),
        gt(driveNotification.createdAt, since),
        ...(userId ? [eq(driveNotification.userId, userId)] : []),
      ),
    )
    .limit(100);
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

/**
 * ADR-0096 (the Meetings library): every record of ONE session of ONE account: the session's first record
 * (its plain id) and each later call's ("<session>~…", report.ts notificationKey and recordingKey). Only
 * the signed-in account's rows are read, so a person never sees another person's files. A row that cannot
 * be decrypted (a removed key) is left out.
 *
 * @param db        The database.
 * @param keys      The data keys.
 * @param userId    The account (the signed-in person).
 * @param sessionId The session (a UUID, checked by the caller, so it is safe in LIKE).
 * @returns The decrypted contents, in no particular order.
 * Called from: handleCallAccess() in api.ts; tests
 */
export async function listSessionRecords(
  db: CallDataDb,
  keys: DataKeys,
  userId: string,
  sessionId: string,
): Promise<NotificationContent[]> {
  const rows = await db
    .select()
    .from(driveNotification)
    .where(
      and(
        eq(driveNotification.userId, userId),
        sql`(${driveNotification.sessionId} = ${sessionId} OR ${driveNotification.sessionId} LIKE ${`${sessionId}~%`})`,
      ),
    );
  const out: NotificationContent[] = [];
  for (const row of rows) {
    try {
      out.push(
        JSON.parse(
          open(keys, notificationBinding(userId, row.sessionId), row.keyVersion, row.content),
        ) as NotificationContent,
      );
    } catch {
      // Unreadable (a removed key): skipped; nothing about it is logged.
    }
  }
  return out;
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

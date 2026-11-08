/**
 * File: apps/web/src/server/desktopLink.ts
 * Purpose: One-time desktop sign-in codes (ADR-0052). The browser's "Desktop app" asks for a code for
 *          one of the account's sessions; the code rides in the paramountai:// link to the desktop
 *          app, which redeems it once to sign in as the same account and open that session.
 *          - A code is 32 random bytes (base64url, 43 characters), valid for 60 seconds.
 *          - Only its SHA-256 is stored, in Better Auth's verification table (made for short-lived
 *            one-time values), with the account and session it is bound to. No new table.
 *          - Redeeming deletes the row in the same statement that checks it (DELETE … RETURNING), so
 *            a code works at most once, even when two requests race.
 *          - At most 10 codes per account per minute; expired codes are removed as new ones are made.
 *          Codes are never logged, stored readable or put in an address the server sees.
 * Used by: app/api/desktop/link-code/route.ts (issue), src/server/desktopLinkPlugin.ts (peek, redeem)
 * Depends on: node:crypto, drizzle-orm, src/server/schema.ts (verification, callRecord),
 *             @kite/shared (LINK_CODE_PATTERN)
 * Architecture: ADR-0052
 */
import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { LINK_CODE_PATTERN } from '@kite/shared';
import { and, count, eq, gt, like, lt, sql } from 'drizzle-orm';
import type { CallDataDb } from './calldata/store';
import { callRecord, verification } from './schema';

/** How long a code is valid, in ms. */
export const LINK_CODE_TTL_MS = 60_000;

/** Codes one account may make per minute. */
export const LINK_CODES_PER_MINUTE = 10;

/** The verification identifiers of desktop link codes start with this. */
const PREFIX = 'desktop-link:';

/** What a code is bound to. */
export interface LinkCodeBinding {
  /** The account it signs in. */
  userId: string;
  /** The call session it opens. */
  sessionId: string;
}

/**
 * The stored identifier of a code: its SHA-256, never the code itself.
 *
 * @param code The code.
 * @returns 'desktop-link:<hex>'.
 */
function identifierOf(code: string): string {
  return `${PREFIX}${createHash('sha256').update(code).digest('hex')}`;
}

/**
 * Escapes LIKE's wildcards in a value used as a prefix.
 *
 * @param text The text.
 * @returns It, with % _ and \ escaped.
 */
function likePrefix(text: string): string {
  return `${text.replace(/[\\%_]/g, (character) => `\\${character}`)}|%`;
}

/**
 * Reads a stored binding ('<userId>|<sessionId>').
 *
 * @param value The stored value.
 * @returns The binding, or null when it is not one of ours.
 */
function bindingOf(value: string): LinkCodeBinding | null {
  const at = value.lastIndexOf('|');
  if (at <= 0) return null;
  return { userId: value.slice(0, at), sessionId: value.slice(at + 1) };
}

/** Why a code could not be made. */
export type IssueRefusal = 'not_found' | 'too_many';

/**
 * Makes a code for one of an account's sessions.
 *
 * @param db        The database.
 * @param userId    The signed-in account (from its session, never the request).
 * @param sessionId The call session the link opens; it must be this account's (synced) session.
 * @param now       The time (tests pass one).
 * @returns The code and when it stops working, or why not.
 * Called from: app/api/desktop/link-code/route.ts; tests
 */
export async function issueLinkCode(
  db: CallDataDb,
  userId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<{ code: string; expiresAt: number } | IssueRefusal> {
  const owned = await db
    .select({ id: callRecord.id })
    .from(callRecord)
    .where(
      and(
        eq(callRecord.userId, userId),
        eq(callRecord.kind, 'session'),
        eq(callRecord.id, sessionId),
        eq(callRecord.deleted, false),
      ),
    );
  if (owned.length === 0) return 'not_found';

  // Expired codes of any account go as new ones are made, so the table never fills up.
  await db
    .delete(verification)
    .where(and(like(verification.identifier, `${PREFIX}%`), lt(verification.expiresAt, now)));
  const [recent] = await db
    .select({ made: count() })
    .from(verification)
    .where(
      and(
        like(verification.identifier, `${PREFIX}%`),
        sql`${verification.value} LIKE ${likePrefix(userId)} ESCAPE '\\'`,
        gt(verification.createdAt, new Date(now.getTime() - 60_000)),
      ),
    );
  if ((recent?.made ?? 0) >= LINK_CODES_PER_MINUTE) return 'too_many';

  const code = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  await db.insert(verification).values({
    id: randomUUID(),
    identifier: identifierOf(code),
    value: `${userId}|${sessionId}`,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  return { code, expiresAt: expiresAt.getTime() };
}

/**
 * Looks at a code without using it (the desktop app shows whose it is before switching accounts).
 *
 * @param db   The database.
 * @param code The code.
 * @param now  The time (tests pass one).
 * @returns What it is bound to, or null when it is unknown, used or expired.
 * Called from: desktopLinkPlugin.ts (/desktop-link/peek); tests
 */
export async function peekLinkCode(
  db: CallDataDb,
  code: string,
  now: Date = new Date(),
): Promise<LinkCodeBinding | null> {
  if (!LINK_CODE_PATTERN.test(code)) return null;
  const rows = await db
    .select({ value: verification.value })
    .from(verification)
    .where(and(eq(verification.identifier, identifierOf(code)), gt(verification.expiresAt, now)));
  return rows[0] ? bindingOf(rows[0].value) : null;
}

/**
 * Uses a code: removes it and returns what it was bound to, in one statement, so it works once.
 *
 * @param db   The database.
 * @param code The code.
 * @param now  The time (tests pass one).
 * @returns What it was bound to, or null when it is unknown, already used or expired.
 * Called from: desktopLinkPlugin.ts (/desktop-link/redeem); tests
 */
export async function takeLinkCode(
  db: CallDataDb,
  code: string,
  now: Date = new Date(),
): Promise<LinkCodeBinding | null> {
  if (!LINK_CODE_PATTERN.test(code)) return null;
  const rows = await db
    .delete(verification)
    .where(and(eq(verification.identifier, identifierOf(code)), gt(verification.expiresAt, now)))
    .returning({ value: verification.value });
  return rows[0] ? bindingOf(rows[0].value) : null;
}

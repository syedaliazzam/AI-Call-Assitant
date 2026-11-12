/**
 * File: apps/web/src/server/google/company.ts
 * Purpose: The company's Google Drive connection and each person's Drive choices (ADR-0074): the one
 *          drive_company row (the encrypted refresh token of the company account an admin connected,
 *          the account's address, the company folder, "reconnect"), and the drive_member rows (saving
 *          and email switches, the "Also notify" list; defaults when a person has no row). Nothing here
 *          logs; the token is only ever held encrypted or in memory.
 * Used by: src/server/google/api.ts, src/server/google/tokens.ts, src/server/google/uploads.ts
 * Depends on: drizzle-orm, src/server/schema.ts (driveCompany, driveMember), src/server/calldata/crypto.ts
 *             (seal, open), src/server/calldata/store.ts (CallDataDb type)
 * Architecture: ADR-0074 (encryption as ADR-0049; migrations additive only, ADR-0050)
 */
import 'server-only';
import { eq } from 'drizzle-orm';
import { open, seal, type DataKeys } from '../calldata/crypto';
import type { CallDataDb } from '../calldata/store';
import { DRIVE_COMPANY_ID, driveCompany, driveMember } from '../schema';

/** The GCM binding of the company refresh token (never a call_record kind). */
const COMPANY_TOKEN_BINDING = {
  userId: DRIVE_COMPANY_ID,
  kind: 'google-company-refresh-token',
  id: DRIVE_COMPANY_ID,
} as const;

/** The company connection as the handlers use it (the token still encrypted). */
export type CompanyConnectionRow = typeof driveCompany.$inferSelect;

/**
 * The company connection.
 *
 * @param db The database.
 * @returns The row, or null when no admin has connected one.
 * Called from: api.ts, tokens.ts, uploads.ts; tests
 */
export async function getCompany(db: CallDataDb): Promise<CompanyConnectionRow | null> {
  const rows = await db
    .select()
    .from(driveCompany)
    .where(eq(driveCompany.id, DRIVE_COMPANY_ID))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Stores the company account's refresh token (connect or reconnect). A reconnect keeps the folder, so
 * waiting uploads carry on where they were.
 *
 * @param db           The database.
 * @param keys         The data keys.
 * @param refreshToken The token from Google (encrypted here, never stored readable).
 * @param accountEmail The account's address from Drive, or null when Drive did not say.
 * @param adminId      The admin who connected it.
 * @returns When stored.
 * Called from: handleCallback() in api.ts; tests
 */
export async function saveCompany(
  db: CallDataDb,
  keys: DataKeys,
  refreshToken: string,
  accountEmail: string | null,
  adminId: string,
): Promise<void> {
  const sealed = seal(keys, COMPANY_TOKEN_BINDING, refreshToken);
  const now = new Date();
  const values = {
    keyVersion: sealed.keyVersion,
    refreshToken: sealed.content,
    accountEmail,
    status: 'connected',
    connectedBy: adminId,
    connectedAt: now,
  };
  await db
    .insert(driveCompany)
    .values({ id: DRIVE_COMPANY_ID, ...values })
    .onConflictDoUpdate({ target: driveCompany.id, set: { ...values, updatedAt: now } });
}

/**
 * Decrypts the company refresh token (in memory only, for one refresh or the revoke).
 *
 * @param keys The data keys.
 * @param row  The connection.
 * @returns The token.
 * @throws DataKeyError when its key version is not set; Error when the ciphertext does not fit.
 * Called from: tokens.ts, api.ts (disconnect); tests
 */
export function readCompanyToken(keys: DataKeys, row: CompanyConnectionRow): string {
  return open(keys, COMPANY_TOKEN_BINDING, row.keyVersion, row.refreshToken);
}

/**
 * Stores the company folder.
 *
 * @param db     The database.
 * @param folder The folder as Drive describes it.
 * @returns False when no company account is connected.
 * Called from: handleFolder() in api.ts; tests
 */
export async function setCompanyFolder(
  db: CallDataDb,
  folder: { id: string; name: string; driveId: string | null },
): Promise<boolean> {
  const rows = await db
    .update(driveCompany)
    .set({ folderId: folder.id, folderName: folder.name, driveId: folder.driveId })
    .where(eq(driveCompany.id, DRIVE_COMPANY_ID))
    .returning({ id: driveCompany.id });
  return rows.length > 0;
}

/**
 * Marks the company connection "reconnect": Google refused its token. The row (folder) stays.
 *
 * @param db The database.
 * @returns When done.
 * Called from: tokens.ts; tests
 */
export async function markCompanyReconnect(db: CallDataDb): Promise<void> {
  await db
    .update(driveCompany)
    .set({ status: 'reconnect' })
    .where(eq(driveCompany.id, DRIVE_COMPANY_ID));
}

/**
 * Deletes the company connection (Disconnect, after the token was revoked).
 *
 * @param db The database.
 * @returns When done.
 * Called from: handleDisconnect() in api.ts; tests
 */
export async function deleteCompany(db: CallDataDb): Promise<void> {
  await db.delete(driveCompany).where(eq(driveCompany.id, DRIVE_COMPANY_ID));
}

/** A person's Drive choices. */
export interface MemberChoices {
  /** "Save calls to Google Drive". */
  saveEnabled: boolean;
  /** "Email me when a call is saved". */
  emailEnabled: boolean;
  /** The team list, lower-case addresses. */
  alsoNotify: string[];
}

/** A person's choices when they never changed them. */
export const DEFAULT_MEMBER: Readonly<MemberChoices> = {
  saveEnabled: true,
  emailEnabled: true,
  alsoNotify: [],
};

/**
 * A person's Drive choices.
 *
 * @param db     The database.
 * @param userId The account.
 * @returns Their choices, or the defaults when they have no row.
 * Called from: api.ts (status, email); tests
 */
export async function getMember(db: CallDataDb, userId: string): Promise<MemberChoices> {
  const rows = await db.select().from(driveMember).where(eq(driveMember.userId, userId)).limit(1);
  const row = rows[0];
  return row
    ? { saveEnabled: row.saveEnabled, emailEnabled: row.emailEnabled, alsoNotify: row.alsoNotify }
    : { ...DEFAULT_MEMBER, alsoNotify: [] };
}

/**
 * Changes a person's choices (making their row the first time).
 *
 * @param db     The database.
 * @param userId The account.
 * @param patch  What changes (addresses already checked and lower-cased).
 * @returns When done.
 * Called from: handleSettings() in api.ts; tests
 */
export async function updateMember(
  db: CallDataDb,
  userId: string,
  patch: Partial<MemberChoices>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db
    .insert(driveMember)
    .values({ userId, ...DEFAULT_MEMBER, alsoNotify: [], ...patch })
    .onConflictDoUpdate({ target: driveMember.userId, set: patch });
}

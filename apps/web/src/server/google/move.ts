/**
 * File: apps/web/src/server/google/move.ts
 * Purpose: ADR-0097's one-time move: every session folder still in the company Drive folder itself goes
 *          into its owner's own folder (made and shared with that owner only, as Viewer, when missing).
 *          The owner of a folder is proven by its tag: the folder's kiteSession value is a hash of the
 *          account and the session, so it is matched against the hashes of every (account, session) pair
 *          the database knows (synced sessions and their records, "saved" email records). A folder that
 *          matches no pair is left where it is. Folders are MOVED (one Drive call each), never copied or
 *          uploaded again, so their ids and every link stay the same. The per-session share of the
 *          owner (ADR-0096) is removed, once their own folder is shared with them, just before the move;
 *          if the move then fails the share is put back, so nobody loses access.
 *          A dry run (the default) only counts. The route is open only with KITE_DRIVE_MOVE_SECRET (set
 *          for the move, removed afterwards); without it the route answers 404.
 *          Replies and logs carry counts only: never a name, email, account, session or Drive id.
 * Used by: app/api/cron/drive-user-folders/route.ts; tests
 * Depends on: drizzle-orm, src/server/schema.ts (user, callRecord, driveNotification),
 *             src/server/google/{api,report,uploads}.ts
 * Architecture: docs/decisions/ADR-0097-one-drive-folder-per-person.md
 */
import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { CallDataDb } from '../calldata/store';
import { callRecord, driveNotification, user } from '../schema';
import { companyDrive, realGoogleDeps, type GoogleDeps } from './api';
import { GoogleRefusedError, GoogleUnavailableError } from './oauth';
import { splitNotificationKey } from './report';
import {
  ensureUserFolder,
  findUserFolder,
  tagValue,
  type CompanyPlace,
  type DriveServer,
  type FolderOwner,
} from './uploads';

/** The shortest secret the route accepts (a placeholder never opens it). */
const MIN_SECRET_CHARS = 32;

/** How many folders one request moves at most by default (each takes about three Drive calls). */
export const DEFAULT_MOVE_LIMIT = 40;

/** What the route needs from outside (tests replace it). */
export interface MoveDeps {
  /** The Drive and database dependencies the other Drive routes use. */
  google: GoogleDeps;
  /** KITE_DRIVE_MOVE_SECRET, or null when not set (the route is then closed). */
  secret(): string | null;
}

/** The real dependencies. */
export const realMoveDeps: MoveDeps = {
  google: realGoogleDeps,
  secret: () => {
    const value = process.env.KITE_DRIVE_MOVE_SECRET?.trim();
    return value && value.length >= MIN_SECRET_CHARS ? value : null;
  },
};

/** One person in the reply: an ordinal, never a name or id. */
export interface MovePersonCount {
  /** 1, 2, 3, … (most folders first). */
  user: number;
  /** Their session folders still in the company folder itself. */
  folders: number;
  /** True when their own folder already exists. */
  hasOwnFolder: boolean;
}

/** The reply: counts only. */
export interface MoveReport {
  /** 'dry-run' (nothing changed) or 'apply'. */
  mode: 'dry-run' | 'apply';
  /** Session folders found in the company folder itself. */
  sessionFolders: number;
  /** Of them, those whose owner was proven by their tag. */
  matched: number;
  /** Those that match no known account and session (left where they are). */
  unmatched: number;
  /** Per person, most folders first. */
  users: MovePersonCount[];
  /** Apply only: what happened in this request. */
  applied?: {
    /** Folders moved into their owner's folder. */
    moved: number;
    /** Folders whose move failed (left where they were, the share put back). */
    failed: number;
    /** Per-session shares removed. */
    sharesRemoved: number;
    /** Per-session shares kept (the owner's folder could not be shared, or Drive refused removing). */
    sharesKept: number;
    /** Own folders made now. */
    userFoldersMade: number;
    /** People whose own folder Google would not share with (not a Google account). */
    shareRefused: number;
    /** Matched folders left for the next request (the limit). */
    remaining: number;
  };
}

/** A person the move works for, from the database. */
interface Owner extends FolderOwner {
  /** Their session folders still in the company folder. */
  folders: string[];
}

/**
 * Every (account, session) pair the database knows, as the tag value their session folder carries, to
 * the account: synced sessions, the records that name a session, and the "saved" email records.
 *
 * @param db The database.
 * @returns kiteSession tag value → account id.
 * Called from: planMove()
 */
async function knownSessionTags(db: CallDataDb): Promise<Map<string, string>> {
  const pairs = new Set<string>();
  const add = (userId: string, sessionId: string) => pairs.add(`${userId}\n${sessionId}`);
  // Ids and account ids only: these columns are never encrypted and hold no call text.
  for (const row of await db
    .selectDistinct({ userId: callRecord.userId, id: callRecord.id })
    .from(callRecord)
    .where(eq(callRecord.kind, 'session'))) {
    add(row.userId, row.id);
  }
  for (const row of await db
    .selectDistinct({ userId: callRecord.userId, sessionId: callRecord.sessionId })
    .from(callRecord)
    .where(isNotNull(callRecord.sessionId))) {
    if (row.sessionId) add(row.userId, row.sessionId);
  }
  for (const row of await db
    .selectDistinct({ userId: driveNotification.userId, sessionId: driveNotification.sessionId })
    .from(driveNotification)) {
    add(row.userId, splitNotificationKey(row.sessionId).sessionId);
  }
  const out = new Map<string, string>();
  for (const pair of pairs) {
    const [userId, sessionId] = pair.split('\n') as [string, string];
    // The same value folderTags(userId, sessionId, 'session') gives the folder.
    out.set(tagValue(userId, sessionId), userId);
  }
  return out;
}

/** The plan: who owns which folder still in the company folder. */
interface MovePlan {
  /** Session folders in the company folder itself. */
  total: number;
  /** Those with no proven owner. */
  unmatched: number;
  /** The owners, most folders first. */
  owners: Owner[];
}

/**
 * Finds every session folder in the company folder itself and its owner (by tag).
 *
 * @param db      The database.
 * @param drive   Drive calls with the company token.
 * @param company The company folder.
 * @returns The plan.
 * Called from: handleMoveToUserFolders()
 */
async function planMove(
  db: CallDataDb,
  drive: DriveServer,
  company: CompanyPlace,
): Promise<MovePlan> {
  const folders = await drive.list(
    company.folderId,
    [{ key: 'kiteFolder', value: 'session' }],
    company.driveId,
  );
  const tags = await knownSessionTags(db);
  const byUser = new Map<string, string[]>();
  let unmatched = 0;
  for (const folder of folders) {
    const owner = tags.get(folder.appProperties.kiteSession ?? '');
    if (!owner) {
      unmatched += 1;
      continue;
    }
    byUser.set(owner, [...(byUser.get(owner) ?? []), folder.id]);
  }
  const people = byUser.size
    ? await db.select({ id: user.id, name: user.name, email: user.email }).from(user)
    : [];
  const owners: Owner[] = [];
  for (const person of people) {
    const list = byUser.get(person.id);
    if (list) owners.push({ ...person, email: person.email.toLowerCase(), folders: list });
  }
  owners.sort((a, b) => b.folders.length - a.folders.length);
  // A tag can match only an account that exists (rows go with the account), so nothing is lost here.
  return { total: folders.length, unmatched, owners };
}

/**
 * Moves one person's folders (up to a budget) into their own folder.
 *
 * @param drive   Drive calls with the company token.
 * @param company The company folder.
 * @param owner   The person and their folders.
 * @param budget  How many folders this request may still move.
 * @param counts  The counts to add to.
 * @returns How many folders were attempted.
 * Called from: handleMoveToUserFolders()
 */
async function moveOwner(
  drive: DriveServer,
  company: CompanyPlace,
  owner: Owner,
  budget: number,
  counts: NonNullable<MoveReport['applied']>,
): Promise<number> {
  const own = await ensureUserFolder(drive, company, owner);
  if (own.created) counts.userFoldersMade += 1;
  // Their own folder shared with them (asking again for an existing one changes nothing).
  const access = own.access ?? (await drive.grantReader(own.folderId, owner.email));
  if (access === 'refused') counts.shareRefused += 1;
  const batch = owner.folders.slice(0, budget);
  for (const folderId of batch) {
    // The owner's own per-session share (ADR-0096), removed only when their folder is shared with
    // them, so they never lose access; removed before the move, while it is the folder's own share only.
    const removed: boolean[] = [];
    if (access === 'granted') {
      const theirs = (await drive.shares(folderId)).filter(
        (share) =>
          share.type === 'user' &&
          share.role === 'reader' &&
          share.email === owner.email &&
          !share.inheritedOnly,
      );
      for (const share of theirs) removed.push(await drive.removeShare(folderId, share.id));
    }
    try {
      await drive.move(folderId, company.folderId, own.folderId);
      counts.moved += 1;
      counts.sharesRemoved += removed.filter(Boolean).length;
      counts.sharesKept += removed.filter((ok) => !ok).length;
    } catch (error) {
      if (error instanceof GoogleRefusedError) throw error;
      counts.failed += 1;
      // Put the share back, so the folder (still where it was) stays open to its owner.
      if (removed.some(Boolean)) await drive.grantReader(folderId, owner.email);
    }
  }
  return batch.length;
}

/** The request body. */
const moveSchema = z
  .object({
    apply: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

/**
 * A JSON reply, never cached.
 * @param status HTTP status.
 * @param body   The body.
 * @returns The response.
 */
function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * POST /api/cron/drive-user-folders (ADR-0097, one-time): with `Authorization: Bearer
 * KITE_DRIVE_MOVE_SECRET`. Body { apply?: boolean, limit?: number }. Without apply it only counts (the
 * dry run). With apply it moves up to `limit` folders and says how many remain; run it again until
 * none do. Safe to repeat: it only ever looks at folders still in the company folder itself.
 *
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 MoveReport; 400 bad body; 401 wrong secret; 404 when the secret is not set; the Drive
 *          routes' 404/409 when Drive is not connected or has no folder; 503 when Google did not answer.
 * Called from: app/api/cron/drive-user-folders/route.ts
 */
export async function handleMoveToUserFolders(
  request: Request,
  deps: MoveDeps = realMoveDeps,
): Promise<Response> {
  const secret = deps.secret();
  if (!secret) return json(404, { code: 'not_found', message: 'Not found' });
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const wanted = Buffer.from(`Bearer ${secret}`);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return json(401, { code: 'unauthorized', message: 'Not allowed' });
  }
  let body: z.infer<typeof moveSchema>;
  try {
    const parsed = moveSchema.safeParse(await request.json());
    if (!parsed.success) throw new Error('invalid');
    body = parsed.data;
  } catch {
    return json(400, {
      code: 'invalid_request',
      message: 'Body: { apply?: boolean, limit?: 1-200 }',
    });
  }
  try {
    const company = await companyDrive(deps.google);
    if (company instanceof Response) return company;
    const db = deps.google.db();
    const plan = await planMove(db, company.drive, company.folder);
    const users: MovePersonCount[] = [];
    for (const [index, owner] of plan.owners.entries()) {
      users.push({
        user: index + 1,
        folders: owner.folders.length,
        hasOwnFolder: (await findUserFolder(company.drive, company.folder, owner.id)) !== null,
      });
    }
    const report: MoveReport = {
      mode: body.apply ? 'apply' : 'dry-run',
      sessionFolders: plan.total,
      matched: plan.total - plan.unmatched,
      unmatched: plan.unmatched,
      users,
    };
    if (body.apply) {
      const counts: NonNullable<MoveReport['applied']> = {
        moved: 0,
        failed: 0,
        sharesRemoved: 0,
        sharesKept: 0,
        userFoldersMade: 0,
        shareRefused: 0,
        remaining: 0,
      };
      let budget = body.limit ?? DEFAULT_MOVE_LIMIT;
      for (const owner of plan.owners) {
        if (budget <= 0) break;
        budget -= await moveOwner(company.drive, company.folder, owner, budget, counts);
      }
      counts.remaining = report.matched - counts.moved - counts.failed;
      report.applied = counts;
    }
    // Counts only.
    console.info('drive: move to user folders', {
      mode: report.mode,
      matched: report.matched,
      unmatched: report.unmatched,
      ...(report.applied
        ? {
            moved: report.applied.moved,
            failed: report.applied.failed,
            remaining: report.applied.remaining,
          }
        : {}),
    });
    return json(200, report);
  } catch (error) {
    if (error instanceof GoogleRefusedError || error instanceof GoogleUnavailableError) {
      console.warn('drive: move to user folders, google unavailable');
      return json(503, { code: 'google_unavailable', message: 'Google did not answer.' });
    }
    console.error('drive: move to user folders failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return json(500, { code: 'failed', message: 'Failed' });
  }
}

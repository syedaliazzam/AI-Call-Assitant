/**
 * File: apps/web/src/server/usage.ts
 * Purpose: The per-user daily limit on Claude requests and the counts behind Admin → Usage
 *          (v1.0.2, ADR-0036). Each Claude request a user makes is counted in usage_day (one row per
 *          user and UTC day); over the limit (default 300 a day, set by an admin) the request is
 *          refused before anything is sent to Claude. Counts only: no text is stored or logged.
 * Used by: app/api/answer/route.ts, app/api/notes/route.ts, app/api/ask/route.ts,
 *          app/api/prepare/route.ts, app/api/job-import/route.ts, app/api/preview/route.ts,
 *          app/(app)/admin/usage/page.tsx, app/(app)/admin/usage/actions.ts
 * Depends on: drizzle-orm, src/server/db.ts, src/server/schema.ts (usageDay, appSetting, user)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.1; ADR-0036
 *
 * A refused request still counts: the counter is increased first (one atomic statement) and the
 * request is refused when the new count is above the limit. So the hot path is one database round
 * trip, and the count shows how often a user hit the limit.
 */
import 'server-only';
import { eq, gte, sql } from 'drizzle-orm';
import { db } from './db';
import { appSetting, usageDay, user } from './schema';

/** Claude requests per user per day when an admin has not set a limit. */
export const DEFAULT_DAILY_LIMIT = 300;

/** The smallest and largest limit an admin may set. */
export const DAILY_LIMIT_RANGE = { min: 1, max: 100_000 } as const;

/** The app_setting key that holds the limit. */
const DAILY_LIMIT_KEY = 'daily_limit';

/** How long the limit is kept in memory before it is read again, in ms. */
const LIMIT_CACHE_MS = 60_000;

/** The limit read last, and when (per server instance; an admin's change applies within 60 s). */
let cachedLimit: { value: number; at: number } | null = null;

/**
 * The UTC day of a time, as stored in usage_day.
 *
 * @param now The time.
 * @returns 'YYYY-MM-DD'.
 * Called from: countRequest(), usageReport(); tests
 */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Reads a stored limit's text as a number.
 *
 * @param value The stored text, or undefined when none is stored.
 * @returns The limit, or DEFAULT_DAILY_LIMIT when it is missing or not a valid limit.
 * Called from: getDailyLimit(); tests
 */
export function parseDailyLimit(value: string | undefined): number {
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= DAILY_LIMIT_RANGE.min && limit <= DAILY_LIMIT_RANGE.max
    ? limit
    : DEFAULT_DAILY_LIMIT;
}

/**
 * The daily limit (from memory when read in the last 60 s).
 *
 * @param now Clock in ms (tests pass one).
 * @returns Claude requests allowed per user per day.
 * Called from: countRequest(); app/(app)/admin/usage/page.tsx
 */
export async function getDailyLimit(now: number = Date.now()): Promise<number> {
  if (cachedLimit && now - cachedLimit.at < LIMIT_CACHE_MS) return cachedLimit.value;
  const rows = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, DAILY_LIMIT_KEY));
  const value = parseDailyLimit(rows[0]?.value);
  cachedLimit = { value, at: now };
  return value;
}

/**
 * Sets the daily limit (admins only: the caller checks).
 *
 * @param limit The new limit.
 * @returns Nothing.
 * @throws Error('INVALID_LIMIT') when it is not a whole number in DAILY_LIMIT_RANGE.
 * Called from: setDailyLimitAction() in app/(app)/admin/usage/actions.ts
 */
export async function setDailyLimit(limit: number): Promise<void> {
  if (!Number.isInteger(limit) || limit < DAILY_LIMIT_RANGE.min || limit > DAILY_LIMIT_RANGE.max) {
    throw new Error('INVALID_LIMIT');
  }
  await db
    .insert(appSetting)
    .values({ key: DAILY_LIMIT_KEY, value: String(limit) })
    .onConflictDoUpdate({
      target: appSetting.key,
      set: { value: String(limit), updatedAt: new Date() },
    });
  // This instance applies it at once; others within LIMIT_CACHE_MS.
  cachedLimit = { value: limit, at: Date.now() };
}

/** What countRequest() decided. */
export interface RequestCount {
  /** True when the request may go to Claude. */
  allowed: boolean;
  /** The user's requests today, this one included (0 when counting failed). */
  count: number;
  /** The daily limit applied. */
  limit: number;
  /** How long the check took, in ms (logged with the request). */
  ms: number;
}

/**
 * Counts one Claude request for a user and decides whether it may go ahead: one atomic
 * INSERT … ON CONFLICT DO UPDATE … RETURNING, so two requests at the same moment both count.
 * When the database cannot be reached the request is allowed (fail open): the limit guards the
 * team's spend, and stopping every answer because a counter failed would be worse.
 *
 * @param userId The signed-in user's id.
 * @param now    The time (tests pass one).
 * @returns See RequestCount.
 * Called from: the Claude routes (app/api/answer, notes, ask, prepare, job-import, preview)
 */
export async function countRequest(userId: string, now: Date = new Date()): Promise<RequestCount> {
  const startedAt = performance.now();
  const ms = () => Math.round(performance.now() - startedAt);
  try {
    // The limit usually comes from memory; when it does not, both reads go out together.
    const [limit, rows] = await Promise.all([
      getDailyLimit(now.getTime()),
      db
        .insert(usageDay)
        .values({ userId, day: utcDay(now), requests: 1 })
        .onConflictDoUpdate({
          target: [usageDay.userId, usageDay.day],
          set: { requests: sql`${usageDay.requests} + 1` },
        })
        .returning({ requests: usageDay.requests }),
    ]);
    const count = rows[0]?.requests ?? 1;
    return { allowed: count <= limit, count, limit, ms: ms() };
  } catch (error) {
    // Ids and the error's name only: nothing about the request.
    console.error('usage: count failed', {
      userId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return { allowed: true, count: 0, limit: cachedLimit?.value ?? DEFAULT_DAILY_LIMIT, ms: ms() };
  }
}

/** One user's row on Admin → Usage. */
export interface UsageRow {
  /** The account's id. */
  userId: string;
  /** Display name. */
  name: string;
  /** Login email. */
  email: string;
  /** Claude requests today (UTC). */
  today: number;
  /** Claude requests over the report's days, today included. */
  lastDays: number;
}

/**
 * Builds the usage report from the accounts and their counted days (pure, for tests).
 *
 * @param users  Every account.
 * @param counts usage_day rows from the report's first day on.
 * @param today  Today, 'YYYY-MM-DD' (UTC).
 * @returns One row per account, most requests over the period first, then by name.
 * Called from: usageReport(); tests
 */
export function buildUsageReport(
  users: readonly { id: string; name: string; email: string }[],
  counts: readonly { userId: string; day: string; requests: number }[],
  today: string,
): UsageRow[] {
  const rows = users.map((account) => {
    const mine = counts.filter((count) => count.userId === account.id);
    return {
      userId: account.id,
      name: account.name,
      email: account.email,
      today: mine.filter((count) => count.day === today).reduce((sum, c) => sum + c.requests, 0),
      lastDays: mine.reduce((sum, count) => sum + count.requests, 0),
    };
  });
  return rows.sort((a, b) => b.lastDays - a.lastDays || a.name.localeCompare(b.name));
}

/**
 * Per-user request counts for Admin → Usage: today and the last `days` days (today included).
 *
 * @param days How many days the period covers (default 7).
 * @param now  The time (tests pass one).
 * @returns See buildUsageReport().
 * Called from: app/(app)/admin/usage/page.tsx
 */
export async function usageReport(days = 7, now: Date = new Date()): Promise<UsageRow[]> {
  const first = new Date(now.getTime() - (days - 1) * 86_400_000);
  // 'YYYY-MM-DD' strings sort in date order, so >= the first day selects the period.
  const [accounts, counts] = await Promise.all([
    db.select({ id: user.id, name: user.name, email: user.email }).from(user),
    db
      .select({ userId: usageDay.userId, day: usageDay.day, requests: usageDay.requests })
      .from(usageDay)
      .where(gte(usageDay.day, utcDay(first))),
  ]);
  return buildUsageReport(accounts, counts, utcDay(now));
}

/**
 * Forgets the limit kept in memory (tests).
 *
 * @returns Nothing.
 * Called from: tests
 */
export function resetUsageCache(): void {
  cachedLimit = null;
}

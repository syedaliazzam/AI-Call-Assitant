/**
 * File: apps/web/src/server/modelAccess.ts
 * Purpose: Whether sessions may answer with the deeper model (Sonnet, stored as 'smart'). It costs far
 *          more per answer, so an admin can turn it off in Admin → Usage (spec §6). A session set to it
 *          then falls back to Haiku, so its calls keep working (the developer's decision, Phase 0).
 * Used by: app/api/answer/route.ts, app/api/models/route.ts, app/(app)/admin/usage/page.tsx,
 *          app/(app)/admin/usage/actions.ts
 * Depends on: drizzle-orm, src/server/db.ts, src/server/schema.ts (appSetting)
 * Architecture: docs/design/paramount-ai-ui-spec.md §6; ADR-0036 (app_setting)
 */
import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { appSetting } from './schema';

/** The app_setting key that holds the switch. */
const DEEP_MODEL_KEY = 'deep_model_enabled';

/** How long the switch is kept in memory before it is read again, in ms. */
const CACHE_MS = 60_000;

/** The switch read last, and when (per server instance; an admin's change applies within 60 s). */
let cached: { value: boolean; at: number } | null = null;

/**
 * Reads the stored switch. On unless an admin turned it off.
 *
 * @param value The stored text, or undefined when none is stored.
 * @returns True unless it says 'false'.
 * Called from: getDeepModelEnabled(); tests
 */
export function parseDeepModelEnabled(value: string | undefined): boolean {
  return value !== 'false';
}

/**
 * Whether sessions may use the deeper model (from memory when read in the last 60 s). When the
 * database cannot be reached it answers true, as the daily limit does: stopping or changing answers
 * because a setting could not be read would be worse.
 *
 * @param now Clock in ms (tests pass one).
 * @returns True when allowed.
 * Called from: POST in app/api/answer/route.ts, GET in app/api/models/route.ts, the Usage page
 */
export async function getDeepModelEnabled(now: number = Date.now()): Promise<boolean> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  try {
    const rows = await db
      .select({ value: appSetting.value })
      .from(appSetting)
      .where(eq(appSetting.key, DEEP_MODEL_KEY));
    const value = parseDeepModelEnabled(rows[0]?.value);
    cached = { value, at: now };
    return value;
  } catch (error) {
    console.error('model access: read failed', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return cached?.value ?? true;
  }
}

/**
 * Turns the deeper model on or off (admins only: the caller checks).
 *
 * @param enabled The new state.
 * @returns Nothing.
 * Called from: setDeepModelAction() in app/(app)/admin/usage/actions.ts
 */
export async function setDeepModelEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(appSetting)
    .values({ key: DEEP_MODEL_KEY, value: String(enabled) })
    .onConflictDoUpdate({
      target: appSetting.key,
      set: { value: String(enabled), updatedAt: new Date() },
    });
  // This instance applies it at once; others within CACHE_MS.
  cached = { value: enabled, at: Date.now() };
}

/**
 * The model a session's request really uses: the deeper one falls back to the fast one when it is off.
 * The Ask AI page does not choose a model per session, so this does not apply to it.
 *
 * @param requested The tier the session asked for.
 * @param enabled   Whether the deeper model is on.
 * @returns The tier to use.
 * Called from: POST in app/api/answer/route.ts; tests
 */
export function allowedTier(requested: 'fast' | 'smart', enabled: boolean): 'fast' | 'smart' {
  return requested === 'smart' && !enabled ? 'fast' : requested;
}

/**
 * Forgets the switch kept in memory (tests).
 *
 * @returns Nothing.
 * Called from: tests
 */
export function resetModelAccessCache(): void {
  cached = null;
}

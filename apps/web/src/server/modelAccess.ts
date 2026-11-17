/**
 * File: apps/web/src/server/modelAccess.ts
 * Purpose: Which answer models sessions may use. The deeper model (Sonnet, stored as 'smart') costs far more
 *          per answer, and Groq ('groq', ADR-0095) is a third-party model, so an admin can turn either off in
 *          Admin → Usage (spec §6). A session set to one that is off then answers with Haiku, so its calls keep
 *          working (the developer's decision, Phase 0). Groq is also off when the server has no Groq key.
 * Used by: app/api/answer/route.ts, app/api/models/route.ts, app/(app)/admin/usage/page.tsx,
 *          app/(app)/admin/usage/actions.ts
 * Depends on: drizzle-orm, src/server/db.ts, src/server/schema.ts (appSetting), src/server/env.ts (getGroqEnv)
 * Architecture: docs/design/paramount-ai-ui-spec.md §6; ADR-0036 (app_setting); ADR-0095 (Groq)
 */
import 'server-only';
import type { AnswerModel } from '@kite/shared';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { getGroqEnv } from './env';
import { appSetting } from './schema';

/** The app_setting key that holds the deeper model's switch. */
const DEEP_MODEL_KEY = 'deep_model_enabled';

/** ADR-0095: the app_setting key that holds Groq's switch. */
const GROQ_MODEL_KEY = 'groq_model_enabled';

/** How long a switch is kept in memory before it is read again, in ms. */
const CACHE_MS = 60_000;

/** Each switch read last, and when (per server instance; an admin's change applies within 60 s). */
const cached = new Map<string, { value: boolean; at: number }>();

/**
 * Reads a stored switch. On unless an admin turned it off.
 *
 * @param value The stored text, or undefined when none is stored.
 * @returns True unless it says 'false'.
 * Called from: readSwitch(); tests
 */
export function parseDeepModelEnabled(value: string | undefined): boolean {
  return value !== 'false';
}

/**
 * Reads one switch (from memory when read in the last 60 s). When the database cannot be reached it answers
 * the last known value, else true, as the daily limit does: stopping or changing answers because a setting
 * could not be read would be worse.
 *
 * @param key The app_setting key.
 * @param now Clock in ms.
 * @returns True when on.
 * Called from: getDeepModelEnabled(), getGroqSwitch()
 */
async function readSwitch(key: string, now: number): Promise<boolean> {
  const known = cached.get(key);
  if (known && now - known.at < CACHE_MS) return known.value;
  try {
    const rows = await db
      .select({ value: appSetting.value })
      .from(appSetting)
      .where(eq(appSetting.key, key));
    const value = parseDeepModelEnabled(rows[0]?.value);
    cached.set(key, { value, at: now });
    return value;
  } catch (error) {
    console.error('model access: read failed', {
      key,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return known?.value ?? true;
  }
}

/**
 * Saves one switch (admins only: the caller checks) and applies it on this instance at once.
 *
 * @param key     The app_setting key.
 * @param enabled The new state.
 * @returns Nothing.
 * Called from: setDeepModelEnabled(), setGroqEnabled()
 */
async function writeSwitch(key: string, enabled: boolean): Promise<void> {
  await db
    .insert(appSetting)
    .values({ key, value: String(enabled) })
    .onConflictDoUpdate({
      target: appSetting.key,
      set: { value: String(enabled), updatedAt: new Date() },
    });
  // This instance applies it at once; others within CACHE_MS.
  cached.set(key, { value: enabled, at: Date.now() });
}

/**
 * Whether sessions may use the deeper model.
 *
 * @param now Clock in ms (tests pass one).
 * @returns True when allowed.
 * Called from: POST in app/api/answer/route.ts, GET in app/api/models/route.ts, the Usage page
 */
export async function getDeepModelEnabled(now: number = Date.now()): Promise<boolean> {
  return readSwitch(DEEP_MODEL_KEY, now);
}

/**
 * Turns the deeper model on or off (admins only: the caller checks).
 *
 * @param enabled The new state.
 * @returns Nothing.
 * Called from: setDeepModelAction() in app/(app)/admin/usage/actions.ts
 */
export async function setDeepModelEnabled(enabled: boolean): Promise<void> {
  await writeSwitch(DEEP_MODEL_KEY, enabled);
}

/**
 * ADR-0095: the admin's Groq switch as stored (on unless turned off), whether or not a key is configured.
 * The Usage page shows this.
 *
 * @param now Clock in ms (tests pass one).
 * @returns True unless an admin turned Groq off.
 * Called from: getGroqEnabled(); app/(app)/admin/usage/page.tsx
 */
export async function getGroqSwitch(now: number = Date.now()): Promise<boolean> {
  return readSwitch(GROQ_MODEL_KEY, now);
}

/**
 * ADR-0095: whether sessions may answer with Groq: the server has a Groq key and the admin's switch is on.
 * The switch is not read at all when there is no key.
 *
 * @param now Clock in ms (tests pass one).
 * @returns True when allowed.
 * Called from: POST in app/api/answer/route.ts, GET in app/api/models/route.ts
 */
export async function getGroqEnabled(now: number = Date.now()): Promise<boolean> {
  if (!getGroqEnv()) return false;
  return readSwitch(GROQ_MODEL_KEY, now);
}

/**
 * ADR-0095: turns Groq on or off for sessions (admins only: the caller checks).
 *
 * @param enabled The new state.
 * @returns Nothing.
 * Called from: setGroqModelAction() in app/(app)/admin/usage/actions.ts
 */
export async function setGroqEnabled(enabled: boolean): Promise<void> {
  await writeSwitch(GROQ_MODEL_KEY, enabled);
}

/**
 * The model a session's request really uses: the deeper one, or Groq, falls back to the fast one when it is
 * off. The Ask AI page does not choose a model per session, so this does not apply to it.
 *
 * @param requested The model the session asked for.
 * @param enabled   Whether the deeper model is on.
 * @param groq      Whether Groq is on (ADR-0095; default false, so an older caller never gets Groq).
 * @returns The model to use.
 * Called from: POST in app/api/answer/route.ts; tests
 */
export function allowedTier(requested: AnswerModel, enabled: boolean, groq = false): AnswerModel {
  if (requested === 'smart' && !enabled) return 'fast';
  if (requested === 'groq' && !groq) return 'fast';
  return requested;
}

/**
 * Forgets the switches kept in memory (tests).
 *
 * @returns Nothing.
 * Called from: tests
 */
export function resetModelAccessCache(): void {
  cached.clear();
}

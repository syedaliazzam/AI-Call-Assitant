/**
 * File: apps/web/src/server/modelAccess.ts
 * Purpose: Which answer models sessions may use. The deeper model (Sonnet, stored as 'smart') costs far more
 *          per answer, and Groq ('groq', ADR-0095) is a third-party model, so an admin can turn either off in
 *          Admin → Usage (spec §6). A session set to one that is off then answers with Haiku, so its calls keep
 *          working (the developer's decision, Phase 0). Groq is also off when the server has no Groq key.
 *          ADR-0099: Gemini and OpenAI (the GPT models) get a switch each too, and are offered only when the
 *          server has that provider's key. ADR-0102: the GPT models are offered to every account; Gemini only to
 *          the accounts in the rollout list KITE_ANSWER_MODELS_USERS (account ids, or `*` for everyone) until
 *          its key is on a paid tier.
 * Used by: app/api/answer/route.ts, app/api/models/route.ts, app/(app)/admin/usage/page.tsx,
 *          app/(app)/admin/usage/actions.ts
 * Depends on: drizzle-orm, src/server/db.ts, src/server/schema.ts (appSetting), src/server/env.ts (the provider
 *             keys), src/server/userList.ts (the rollout list)
 * Architecture: docs/design/paramount-ai-ui-spec.md §6; ADR-0036 (app_setting); ADR-0095 (Groq); ADR-0099
 *               (Gemini and OpenAI); ADR-0102 (GPT models for every account); ADR-0104 (Gemini 3.6 Flash retired)
 */
import 'server-only';
import { isRetiredModel, providerOf, type AnswerModel } from '@kite/shared';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { getGeminiEnv, getGroqEnv, getOpenAIEnv } from './env';
import { appSetting } from './schema';
import { parseUserList } from './userList';

/** The app_setting key that holds the deeper model's switch. */
const DEEP_MODEL_KEY = 'deep_model_enabled';

/** ADR-0095: the app_setting key that holds Groq's switch. */
const GROQ_MODEL_KEY = 'groq_model_enabled';

/** ADR-0099: the app_setting key that holds Gemini's switch. */
const GEMINI_MODEL_KEY = 'gemini_model_enabled';

/** ADR-0099: the app_setting key that holds OpenAI's switch. */
const OPENAI_MODEL_KEY = 'openai_model_enabled';

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

/** ADR-0099: the third-party providers with a switch of their own and a rollout (Groq has no rollout). */
export type RolloutProvider = 'gemini' | 'openai';

/**
 * ADR-0099: the admin's switch for Gemini or OpenAI as stored (on unless turned off), whether or not a key is
 * configured. The Usage page shows this.
 *
 * @param provider Which provider.
 * @param now      Clock in ms (tests pass one).
 * @returns True unless an admin turned it off.
 * Called from: getProviderEnabled(); app/(app)/admin/usage/page.tsx
 */
export async function getProviderSwitch(
  provider: RolloutProvider,
  now: number = Date.now(),
): Promise<boolean> {
  return readSwitch(provider === 'gemini' ? GEMINI_MODEL_KEY : OPENAI_MODEL_KEY, now);
}

/**
 * ADR-0099: turns Gemini or OpenAI on or off for sessions (admins only: the caller checks).
 *
 * @param provider Which provider.
 * @param enabled  The new state.
 * @returns Nothing.
 * Called from: setGeminiModelAction(), setOpenAIModelAction() in app/(app)/admin/usage/actions.ts
 */
export async function setProviderEnabled(
  provider: RolloutProvider,
  enabled: boolean,
): Promise<void> {
  await writeSwitch(provider === 'gemini' ? GEMINI_MODEL_KEY : OPENAI_MODEL_KEY, enabled);
}

/**
 * ADR-0099: whether an account is in the Gemini rollout (KITE_ANSWER_MODELS_USERS: account ids, or `*` for
 * everyone; unset means no one). ADR-0102: the list no longer limits the GPT models, only Gemini.
 *
 * @param userId The signed-in account's id.
 * @param env    The environment (default process.env; tests pass their own).
 * @returns True when listed.
 * Called from: getProviderEnabled(); GET in app/api/models/route.ts; tests
 */
export function moreModelsFor(
  userId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const users = parseUserList(env.KITE_ANSWER_MODELS_USERS);
  return users === 'everyone' || users.has(userId);
}

/**
 * ADR-0099: whether an account may answer with Gemini or OpenAI: the server has the provider's key and the
 * admin's switch is on; for Gemini the account must also be in the rollout (ADR-0102: OpenAI is for every
 * account). The switch is not read at all otherwise.
 *
 * @param provider Which provider.
 * @param userId   The signed-in account's id.
 * @param now      Clock in ms (tests pass one).
 * @returns True when allowed.
 * Called from: POST in app/api/answer/route.ts, GET in app/api/models/route.ts
 */
export async function getProviderEnabled(
  provider: RolloutProvider,
  userId: string,
  now: number = Date.now(),
): Promise<boolean> {
  // ADR-0102: only Gemini is still limited to the rollout's accounts (its key is on a free tier).
  if (provider === 'gemini' && !moreModelsFor(userId)) return false;
  const configured = provider === 'gemini' ? getGeminiEnv() : getOpenAIEnv();
  if (!configured) return false;
  return getProviderSwitch(provider, now);
}

/** ADR-0099: which models a session's request may use now. */
export interface ModelAllowance {
  /** The deeper model (Sonnet). */
  smart: boolean;
  /** Groq. */
  groq: boolean;
  /** The Gemini models. */
  gemini: boolean;
  /** The GPT models. */
  openai: boolean;
}

/**
 * ADR-0099: the model a session's request really uses: any model that is off (an admin's switch, no key, or,
 * for Gemini, not in the rollout) falls back to the fast one (Claude Haiku), so the call keeps working. ADR-0104: a
 * retired model (Gemini 3.6 Flash) always does.
 *
 * @param requested The model the session asked for.
 * @param allowed   Which models are on.
 * @returns The model to use.
 * Called from: POST in app/api/answer/route.ts; tests
 */
export function allowedModel(requested: AnswerModel, allowed: ModelAllowance): AnswerModel {
  const provider = providerOf(requested);
  // ADR-0104: no longer offered; an older session or page may still ask for it.
  if (isRetiredModel(requested)) return 'fast';
  if (requested === 'smart' && !allowed.smart) return 'fast';
  if (provider === 'groq' && !allowed.groq) return 'fast';
  if (provider === 'gemini' && !allowed.gemini) return 'fast';
  if (provider === 'openai' && !allowed.openai) return 'fast';
  return requested;
}

/**
 * The model a session's request really uses: the deeper one, or Groq, falls back to the fast one when it is
 * off. The Ask AI page does not choose a model per session, so this does not apply to it.
 *
 * @param requested The model the session asked for.
 * @param enabled   Whether the deeper model is on.
 * @param groq      Whether Groq is on (ADR-0095; default false, so an older caller never gets Groq).
 * @returns The model to use.
 * Called from: tests (the answer route uses allowedModel(), ADR-0099)
 */
export function allowedTier(requested: AnswerModel, enabled: boolean, groq = false): AnswerModel {
  // ADR-0099: the Gemini and GPT models are never on through this older form.
  return allowedModel(requested, { smart: enabled, groq, gemini: false, openai: false });
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

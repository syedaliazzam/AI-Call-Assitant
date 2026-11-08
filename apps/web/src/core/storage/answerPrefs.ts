/**
 * File: apps/web/src/core/storage/answerPrefs.ts
 * Purpose: Remembers small answer settings on this device: the preferred coding language, what to do
 *          when the documents have no real example, the chat box's Auto / For the call / Ask Kite
 *          switch for each session, and the review page's transcript order. Kept in localStorage:
 *          they are per-device preferences, not session data.
 * Used by: src/core/answer/warm.ts, src/features/settings/AnswerPrefsSetting.tsx,
 *          src/features/live/LiveAnswers.tsx, src/features/review/ConversationSection.tsx
 * Depends on: @kite/shared (types and defaults), localStorage, src/core/sync/prefsSignal.ts (the coding
 *             language follows the account with account sync, ADR-0049)
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 *
 * Every read and write survives blocked storage (private window, policy): reads give the default,
 * and writes simply do not stick.
 */
import {
  CODING_LANGUAGES,
  DEFAULT_CODING_LANGUAGE,
  type AnswerStyleVersion,
  type MissingInfoMode,
  type TargetChoice,
} from '@kite/shared';
import { accountPrefChanged } from '../sync/prefsSignal';

/** The localStorage key of the preferred coding language. */
export const CODING_LANGUAGE_KEY = 'kite.codingLanguage';

/** The localStorage key of what to do when information is missing. */
export const MISSING_INFO_KEY = 'kite.missingInfo';

/** The localStorage key of the answer rules' version (admins only; ADR-0032). */
export const STYLE_VERSION_KEY = 'kite.answerStyleVersion';

/** The localStorage key of the review page's order. */
export const REVIEW_OLDEST_FIRST_KEY = 'kite.reviewOldestFirst';

/** The start of the localStorage key of a session's chat switch (the session id follows). */
export const CHAT_TARGET_KEY_PREFIX = 'kite.chatTarget.';

/**
 * Reads a value from localStorage.
 *
 * @param key The key.
 * @returns The value, or null when it is not set or storage is blocked.
 * Called from: the getters below
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes a value to localStorage; null removes it.
 *
 * @param key   The key.
 * @param value The value, or null.
 * @returns Nothing.
 * Called from: the setters below
 */
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the setting simply does not stick.
  }
}

/**
 * The preferred coding language.
 *
 * @returns One of CODING_LANGUAGES (Python by default).
 * Called from: warm.ts (toSessionContext), AnswerPrefsSetting.tsx
 */
export function getCodingLanguage(): string {
  const stored = read(CODING_LANGUAGE_KEY);
  return stored && CODING_LANGUAGES.includes(stored) ? stored : DEFAULT_CODING_LANGUAGE;
}

/**
 * Saves the preferred coding language.
 *
 * @param language The language.
 * @returns Nothing.
 * Called from: AnswerPrefsSetting.tsx
 */
export function setCodingLanguage(language: string): void {
  write(CODING_LANGUAGE_KEY, language === DEFAULT_CODING_LANGUAGE ? null : language);
  // ADR-0049: with account sync, the choice follows the account to every device.
  accountPrefChanged();
}

/**
 * What to do when the documents have no real example.
 *
 * @returns 'approach' (the default) or 'story'.
 * Called from: warm.ts (toSessionContext), AnswerPrefsSetting.tsx
 */
export function getMissingInfoMode(): MissingInfoMode {
  return read(MISSING_INFO_KEY) === 'story' ? 'story' : 'approach';
}

/**
 * Saves what to do when the documents have no real example.
 *
 * @param mode The choice.
 * @returns Nothing.
 * Called from: AnswerPrefsSetting.tsx
 */
export function setMissingInfoMode(mode: MissingInfoMode): void {
  write(MISSING_INFO_KEY, mode === 'story' ? 'story' : null);
}

/**
 * Which answer rules this device asks for. Only an admin can change it, and the server ignores
 * the choice for anyone else (ADR-0032).
 *
 * @returns 'current' (the default) or 'previous'.
 * Called from: warm.ts, context.ts, AnswerPrefsSetting.tsx
 */
export function getAnswerStyleVersion(): AnswerStyleVersion {
  return read(STYLE_VERSION_KEY) === 'previous' ? 'previous' : 'current';
}

/**
 * Saves which answer rules this device asks for.
 *
 * @param version The choice.
 * @returns Nothing.
 * Called from: AnswerPrefsSetting.tsx
 */
export function setAnswerStyleVersion(version: AnswerStyleVersion): void {
  write(STYLE_VERSION_KEY, version === 'previous' ? 'previous' : null);
}

/**
 * The chat switch of a session.
 *
 * @param sessionId The session.
 * @returns 'auto' (the default), 'call' or 'kite'.
 * Called from: LiveAnswers.tsx
 */
export function getChatTarget(sessionId: string): TargetChoice {
  const stored = read(`${CHAT_TARGET_KEY_PREFIX}${sessionId}`);
  return stored === 'call' || stored === 'kite' ? stored : 'auto';
}

/**
 * Saves the chat switch of a session.
 *
 * @param sessionId The session.
 * @param choice    The choice.
 * @returns Nothing.
 * Called from: LiveAnswers.tsx
 */
export function setChatTarget(sessionId: string, choice: TargetChoice): void {
  write(`${CHAT_TARGET_KEY_PREFIX}${sessionId}`, choice === 'auto' ? null : choice);
}

/**
 * Whether the review page shows the oldest lines first.
 *
 * @returns False only when the user chose newest first (v1.1.0: oldest first by default, as live).
 * Called from: ConversationSection.tsx
 */
export function getReviewOldestFirst(): boolean {
  return read(REVIEW_OLDEST_FIRST_KEY) !== 'off';
}

/**
 * Saves the review page's order.
 *
 * @param on True for oldest first.
 * @returns Nothing.
 * Called from: ConversationSection.tsx
 */
export function setReviewOldestFirst(on: boolean): void {
  write(REVIEW_OLDEST_FIRST_KEY, on ? 'on' : 'off');
}

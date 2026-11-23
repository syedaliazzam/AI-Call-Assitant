/**
 * File: apps/web/src/core/storage/settings.ts
 * Purpose: Read and save the default preferences for new sessions on this device (the
 *          Settings page); the Create session wizard starts from them.
 * Used by: src/features/settings/Settings.tsx, src/features/session-setup/SessionWizard.tsx
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Settings: default preferences),
 *               §7.4; day-03-sessions.md Stage 3
 *
 * Default instructions are the user's own text and are never logged.
 */
import { getDb } from './db';
import type { SessionDefaults } from './types';

/**
 * The defaults before the user saves any: the fast model, headline-and-bullets answers of
 * Balanced length ('medium') in simple language, no extra instructions, transcript saved.
 * Only a device with no saved defaults uses these: once the user saves defaults (Settings, or
 * "Set as default" in Answer preferences) their saved choice is used instead, and each existing
 * session keeps the length stored on it.
 */
export const BUILT_IN_DEFAULTS: SessionDefaults = {
  model: 'fast',
  // Balanced ('medium') by default; Short was the default before (developer's decision, Nov 2026).
  style: { format: 'headline+bullets', length: 'medium', tone: 'simple' },
  instructions: '',
  saveTranscript: true,
};

/**
 * Reads the default preferences for new sessions.
 *
 * @returns The saved defaults, or BUILT_IN_DEFAULTS when none were saved (or after "Delete all
 *          local data").
 * Called from: the Settings page and the Create session wizard (Day 3 Stage 3); tests
 */
export async function getSessionDefaults(): Promise<SessionDefaults> {
  const row = await getDb().settings.get('defaults');
  return row?.defaults ?? BUILT_IN_DEFAULTS;
}

/**
 * Saves the default preferences for new sessions. Existing sessions keep their own preferences.
 *
 * @param defaults The new defaults.
 * @param now      Time saved, in Unix ms (tests pass a fixed time).
 * Called from: the Settings page's Save button (Day 3 Stage 3); tests
 */
export async function saveSessionDefaults(
  defaults: SessionDefaults,
  now = Date.now(),
): Promise<void> {
  await getDb().settings.put({ id: 'defaults', defaults, updatedAt: now });
}

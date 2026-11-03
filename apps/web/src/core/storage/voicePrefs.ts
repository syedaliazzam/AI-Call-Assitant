/**
 * File: apps/web/src/core/storage/voicePrefs.ts
 * Purpose: The Ask Kite page's voice preferences on this device (item 8, ADR-0038): "Read replies
 *          aloud" and "Hands-free" (listen again after each reply). Both are off by default. Kept
 *          in localStorage: per-device conveniences, not session data.
 * Used by: src/features/ask-kite/AskKitePage.tsx
 * Depends on: nothing (localStorage)
 * Architecture: docs/decisions/ADR-0038-voice-for-ask-kite.md
 */

/** The localStorage key for "Read replies aloud". */
export const READ_ALOUD_KEY = 'kite.readAloud';

/** The localStorage key for "Hands-free". */
export const HANDS_FREE_KEY = 'kite.handsFree';

/**
 * Reads a stored switch.
 *
 * @param key The key.
 * @returns True only when it was turned on; false when unset or storage is blocked.
 * Called from: getReadAloud(), getHandsFree()
 */
function readOn(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'on';
  } catch {
    // Storage blocked (private window, policy): the default (off) applies.
    return false;
  }
}

/**
 * Stores a switch.
 *
 * @param key The key.
 * @param on  The value.
 * @returns Nothing.
 * Called from: setReadAloud(), setHandsFree()
 */
function writeOn(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the setting simply does not stick.
  }
}

/**
 * Whether replies are read aloud.
 *
 * @returns True when the user turned it on.
 * Called from: AskKitePage.tsx
 */
export function getReadAloud(): boolean {
  return readOn(READ_ALOUD_KEY);
}

/**
 * Sets "Read replies aloud".
 *
 * @param on True to read replies aloud.
 * @returns Nothing.
 * Called from: AskKitePage.tsx
 */
export function setReadAloud(on: boolean): void {
  writeOn(READ_ALOUD_KEY, on);
}

/**
 * Whether Kite listens again after each reply.
 *
 * @returns True when the user turned it on.
 * Called from: AskKitePage.tsx
 */
export function getHandsFree(): boolean {
  return readOn(HANDS_FREE_KEY);
}

/**
 * Sets "Hands-free".
 *
 * @param on True to listen again after each reply.
 * @returns Nothing.
 * Called from: AskKitePage.tsx
 */
export function setHandsFree(on: boolean): void {
  writeOn(HANDS_FREE_KEY, on);
}

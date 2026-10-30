/**
 * File: apps/desktop/src/channels.ts
 * Purpose: Names of the IPC channels between the main process and the preload script. Kept in
 *          their own file so the preload bundle does not include main-process code.
 * Used by: src/hotkeys.ts (main process), src/preload.ts
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3 (hotkeys.ts, preload.ts);
 *               day-04-answers.md Stage 8
 */

/** The page turns the global shortcuts on or off (invoke; answers with the statuses). */
export const SET_HOTKEYS_CHANNEL = 'kite:set-hotkeys';

/** The shell tells the page a global shortcut was pressed (send; carries the action). */
export const HOTKEY_CHANNEL = 'kite:hotkey';

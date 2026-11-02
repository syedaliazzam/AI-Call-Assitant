/**
 * File: apps/desktop/src/channels.ts
 * Purpose: Names of the IPC channels between the main process and the preload script. Kept in
 *          their own file so the preload bundle does not include main-process code.
 * Used by: src/hotkeys.ts and src/screenshot.ts (main process), src/preload.ts
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3 (hotkeys.ts, preload.ts);
 *               day-04-answers.md Stage 8
 */

/** The page turns the global shortcuts on or off (invoke; answers with the statuses). */
export const SET_HOTKEYS_CHANNEL = 'kite:set-hotkeys';

/** The shell tells the page a global shortcut was pressed (send; carries the action). */
export const HOTKEY_CHANNEL = 'kite:hotkey';

/** The page asks for a screenshot (invoke; answers with a DesktopScreenshot). */
export const CAPTURE_SCREENSHOT_CHANNEL = 'kite:capture-screenshot';

/** The page opens the compact live window (invoke; carries the session id). */
export const OPEN_COMPACT_CHANNEL = 'kite:open-compact';

/** The page closes the compact live window (invoke). */
export const CLOSE_COMPACT_CHANNEL = 'kite:close-compact';

/** The page changes screen-share protection (invoke; carries a boolean, answers the state). */
export const SET_PROTECTION_CHANNEL = 'kite:set-protection';

/** The page reads screen-share protection (invoke; answers the state). */
export const GET_PROTECTION_CHANNEL = 'kite:get-protection';

/** Settings asks which global shortcuts another app already uses (invoke; answers statuses). */
export const CHECK_HOTKEYS_CHANNEL = 'kite:check-hotkeys';

/** The overlay sets its window's opacity (invoke; carries a number, kept to a readable range). */
export const OVERLAY_OPACITY_CHANNEL = 'kite:overlay-opacity';

/** The overlay collapses to its controls bar, or opens again (invoke; carries a boolean). */
export const OVERLAY_COLLAPSE_CHANNEL = 'kite:overlay-collapse';

/** The live page minimises the main window when a call starts in the overlay (invoke). */
export const MINIMIZE_MAIN_CHANNEL = 'kite:minimize-main';

/** The page says whether a live call is going on (send; a boolean). Updates wait for it. */
export const CALL_ACTIVE_CHANNEL = 'kite:call-active';

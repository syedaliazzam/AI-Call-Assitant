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

/** v1.0.2 (ADR-0035): put the overlay at a preset place and remember it (invoke; an OverlayPreset). */
export const OVERLAY_PLACE_CHANNEL = 'kite:overlay-place';

/** v1.0.2: read the remembered overlay preset (invoke; answers an OverlayPreset). */
export const OVERLAY_PRESET_CHANNEL = 'kite:overlay-preset';

/** v1.0.2: one step of a page-driven overlay resize (invoke; an OverlayResizeStep). */
export const OVERLAY_RESIZE_CHANNEL = 'kite:overlay-resize';

/** v1.0.2: switch the overlay between full, collapsed and the script bar (invoke; an OverlayMode). */
export const OVERLAY_MODE_CHANNEL = 'kite:overlay-mode';

/** The live page minimises the main window when a call starts in the overlay (invoke). */
export const MINIMIZE_MAIN_CHANNEL = 'kite:minimize-main';

/** v1.0.4: the live page brings the full call window forward and hides the overlay (invoke). */
export const SHOW_CALL_WINDOW_CHANNEL = 'kite:show-call-window';

/** v1.1.0: open a Kite page in a normal window (invoke; a path). See KiteDesktopApi. */
export const OPEN_PAGES_CHANNEL = 'kite:open-pages';

/** v1.1.0: minimise or close the sender's own window (invoke; a WindowControlAction). */
export const WINDOW_CONTROL_CHANNEL = 'kite:window-control';

/** v1.1.0: which of the overlay's panels are open (invoke; an OverlayLayout). */
export const OVERLAY_LAYOUT_CHANNEL = 'kite:overlay-layout';

/** v1.1.0: the snap zone under the pointer during a drag (send; an OverlayPreset, or null). */
export const SNAP_ZONE_CHANNEL = 'kite:snap-zone';

/**
 * v1.3.0 (ADR-0052): the one-time sign-in code a paramountai:// link brought, given once to the home
 * panel's link page (invoke; no arguments, answers the code or null). Replaces 1.2.0's session file
 * channels (kite:handoff-pick, kite:handoff-delete), which are gone.
 */
export const LINK_CODE_CHANNEL = 'kite:link-code';

/** The page says whether a live call is going on (send; a boolean). Updates wait for it. */
export const CALL_ACTIVE_CHANNEL = 'kite:call-active';

/** v1.0.1 (ADR-0034): the accurate-transcription engine's state (invoke; returns AccurateStatus). */
export const ACCURATE_STATUS_CHANNEL = 'kite:accurate-status';

/** v1.0.1: start or resume the model download (invoke; returns AccurateStatus at once). */
export const ACCURATE_DOWNLOAD_CHANNEL = 'kite:accurate-download';

/** v1.0.1: delete the downloaded model (invoke; returns AccurateStatus). */
export const ACCURATE_REMOVE_CHANNEL = 'kite:accurate-remove';

/** v1.0.1: transcribe one utterance (invoke; carries a Float32Array, returns AccurateResult). */
export const ACCURATE_TRANSCRIBE_CHANNEL = 'kite:accurate-transcribe';

/** v1.2.0 (spec S13): moves the overlay by a distance (dragging the icon). */
export const OVERLAY_MOVE_CHANNEL = 'kite:overlay-move';

/** v1.2.0 (spec S14): holds or releases the chat bar's screenshot shortcut. */
export const CHAT_HOTKEY_CHANNEL = 'kite:chat-hotkey';

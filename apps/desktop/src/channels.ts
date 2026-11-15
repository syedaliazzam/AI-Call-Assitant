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

/**
 * v1.3.0 (ADR-0055): opens the main window on a session's live page, minimised, for a call started from
 * the home panel's Connect card (invoke; a session id, checked to be a UUID).
 */
export const OPEN_CALL_WINDOW_CHANNEL = 'kite:open-call-window';

/**
 * v1.3.0 (ADR-0055): the overlay's page lets clicks pass through its transparent gaps, or takes them again
 * (invoke; a boolean). Only the overlay window's own page.
 */
export const OVERLAY_CLICK_THROUGH_CHANNEL = 'kite:overlay-click-through';

/**
 * v1.3.2: the overlay's page gives the keyboard back to the app that had it, after a click on a panel
 * control (invoke; no argument). Only the overlay window's own page, and only while it has focus.
 */
export const OVERLAY_RELEASE_FOCUS_CHANNEL = 'kite:overlay-release-focus';

/**
 * v1.3.0 (ADR-0056): the open overlay's position (invoke; no argument reads it, an OverlayPreset puts the
 * overlay there at its current size; answers the position or null).
 */
export const OVERLAY_POSITION_CHANNEL = 'kite:overlay-position';

/** v1.3.0 (ADR-0056): the overlay's position changed (send, to the overlay's page; an OverlayPreset). */
export const OVERLAY_POSITION_EVENT = 'kite:overlay-position-changed';

/** v1.3.0 (ADR-0055): the home panel asks for its size (invoke; { width, height } in DIPs). */
export const SIZE_PANEL_CHANNEL = 'kite:size-panel';

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

/** 1.6.4 (ADR-0082): holds or releases Escape while a voice question listens. */
export const VOICE_CANCEL_HOTKEY_CHANNEL = 'kite:voice-cancel-hotkey';

/** 1.5.0 (ADR-0068): open a recording's files (invoke; a RecordingOpenRequest, answers RecordingOpenResult). */
export const RECORDING_OPEN_CHANNEL = 'kite:recording-open';

/** 1.5.0: append one piece to a recording (invoke; id, track, bytes; answers RecordingWriteResult). */
export const RECORDING_WRITE_CHANNEL = 'kite:recording-write';

/** 1.5.0: close and finalise a recording (invoke; an id; answers RecordingCloseResult). */
export const RECORDING_CLOSE_CHANNEL = 'kite:recording-close';

/** 1.5.0: the recordings on this computer (invoke; answers LocalRecording[]). */
export const RECORDING_LIST_CHANNEL = 'kite:recording-list';

/** 1.5.0: open the player window on a recording (invoke; an id; answers a boolean). */
export const RECORDING_PLAY_CHANNEL = 'kite:recording-play';

/** 1.5.0: Save as… a copy of a recording (invoke; an id; answers RecordingSaveResult). */
export const RECORDING_SAVE_AS_CHANNEL = 'kite:recording-save-as';

/** 1.5.0: show a recording in the file manager (invoke; an id; answers a boolean). */
export const RECORDING_SHOW_CHANNEL = 'kite:recording-show';

/** 1.5.0: move a recording to the Recycle Bin (invoke; an id; answers a boolean). */
export const RECORDING_DELETE_CHANNEL = 'kite:recording-delete';

/** 1.5.0: the displays a screen recording can capture (invoke; answers RecordingDisplay[]). */
export const LIST_DISPLAYS_CHANNEL = 'kite:list-displays';

/** 1.5.0: the display the next screen recording captures (invoke; a display id or null). */
export const RECORDING_DISPLAY_CHANNEL = 'kite:recording-display';

/** 1.5.0: this computer's id and name for recordings (invoke; answers DeviceIdentity). */
export const DEVICE_IDENTITY_CHANNEL = 'kite:device-identity';

/** 1.5.0: rename this computer for recordings (invoke; a string; answers DeviceIdentity). */
export const RENAME_DEVICE_CHANNEL = 'kite:rename-device';

/** 1.6.0 (ADR-0072): upload a recording file to Google Drive (invoke; a DriveUploadRequest). */
export const DRIVE_UPLOAD_CHANNEL = 'kite:drive-upload';

/** 1.6.2 (ADR-0074): one recording file's size (invoke; { recordingId, track }; a number or null). */
export const DRIVE_FILE_SIZE_CHANNEL = 'kite:drive-file-size';

/** 1.6.0: a Drive upload's progress, to the page that started it (send; a DriveUploadProgress). */
export const DRIVE_PROGRESS_EVENT = 'kite:drive-progress';

/** 1.6.0: show the native "saved to Google Drive" notification (invoke; a DesktopNotice). */
export const SHOW_NOTICE_CHANNEL = 'kite:show-notice';

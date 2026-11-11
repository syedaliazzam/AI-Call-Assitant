/**
 * File: apps/web/src/core/drive/reasons.ts
 * Purpose: The words for why a Google Drive upload waits or stopped (ADR-0072), from the reason codes
 *          the uploader stores, and whether the person must act in Settings.
 * Used by: src/features/drive/*, tests
 * Depends on: nothing
 * Architecture: ADR-0072
 */

/** Every reason code the uploader stores. */
export type DriveReason =
  | 'reconnect'
  | 'not-connected'
  | 'no-folder'
  | 'save-off'
  | 'folder-gone'
  | 'network'
  | 'refused'
  | 'failed';

/** The words for each code. */
const WORDS: Readonly<Record<DriveReason, string>> = {
  reconnect:
    'Google Drive needs to be reconnected. Reconnect it in Settings; uploads will continue.',
  'not-connected': 'Google Drive is not connected. Connect it in Settings to save this call.',
  'no-folder': 'Choose a Google Drive folder in Settings to save this call.',
  'save-off': '"Save calls to Google Drive" is off in Settings.',
  'folder-gone': 'The Drive folder could not be opened. Choose a folder in Settings, then Retry.',
  network: 'Lost the connection to Google Drive. It will try again shortly.',
  refused: 'Google Drive refused the upload (the Drive may be full, or access changed).',
  failed: 'The upload to Google Drive stopped. Retry to continue.',
};

/**
 * The words for a reason.
 *
 * @param reason The stored code (unknown codes get the general words).
 * @returns The words.
 * Called from: features/drive/DriveStatus.tsx; tests
 */
export function driveReasonText(reason: string | undefined): string {
  return WORDS[(reason ?? 'failed') as DriveReason] ?? WORDS.failed;
}

/**
 * Whether the person must act in Settings for this reason (connect, reconnect, pick a folder, switch on).
 *
 * @param reason The stored code.
 * @returns True when Settings is where it is fixed.
 * Called from: features/drive/*; tests
 */
export function driveReasonNeedsSettings(reason: string | undefined): boolean {
  return (
    reason === 'reconnect' ||
    reason === 'not-connected' ||
    reason === 'no-folder' ||
    reason === 'save-off' ||
    reason === 'folder-gone'
  );
}

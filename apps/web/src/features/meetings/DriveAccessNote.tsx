/**
 * File: apps/web/src/features/meetings/DriveAccessNote.tsx
 * Purpose: The Meetings library's note when Google refused to give the person Viewer access to their own
 *          folder (ADR-0096; ADR-0097: their one folder holding their session folders), for example because their sign-in email is not a Google account:
 *          "Ask an admin for Drive access". Nothing is shown when access was granted or not needed.
 * Used by: WatchTab.tsx, FilesTab.tsx
 * Depends on: @kite/shared (DriveFolderAccess)
 * Architecture: docs/decisions/ADR-0096-meetings-library.md
 */
import type { DriveFolderAccess } from '@kite/shared';

/**
 * The note.
 *
 * @param props.access The person's access to their session folder.
 * @returns The note, or nothing.
 * Rendered by: WatchTab.tsx, FilesTab.tsx
 */
export function DriveAccessNote({ access }: { access: DriveFolderAccess }) {
  if (access !== 'refused') return null;
  return (
    // Body colour: it sits on both the surface and the subtle fill (warning text is not 4.5:1 on both).
    <p role="note" className="text-[12px] text-ui-text">
      <span className="font-semibold">Ask an admin for Drive access.</span> Google could not share
      your folder with your sign-in email.
    </p>
  );
}

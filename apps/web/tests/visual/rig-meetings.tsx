/**
 * File: apps/web/tests/visual/rig-meetings.tsx
 * Purpose: The overlay rig's recording pages (desktop 1.5.0, ADR-0068): the real Meetings page at
 *          /meetings and the real player at /player/<id>, over this browser profile's own data (the rig's
 *          call page saves its recording records there), so the desktop shell's Play, the parts and the
 *          transcript can be checked in the real windows.
 * Used by: tests/visual/overlay-rig.ts (bundled); apps/desktop/tests/manual/recording.spec.ts
 * Depends on: src/features/meetings (MeetingsPage, RecordingPlayer), react-dom
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md
 * Invented data only; nothing is saved but this rig's own browser storage.
 */
import { createRoot } from 'react-dom/client';
import { MeetingsPage } from '@/features/meetings/MeetingsPage';
import { RecordingPlayer } from '@/features/meetings/RecordingPlayer';

/** The page's path. */
const pathname = window.location.pathname;

createRoot(document.getElementById('root')!).render(
  pathname.startsWith('/player/') ? (
    <RecordingPlayer recordingId={pathname.split('/').pop() ?? ''} />
  ) : (
    <MeetingsPage />
  ),
);

/**
 * File: apps/web/app/(app)/meetings/page.tsx
 * Purpose: The /meetings route (desktop 1.5.0, ADR-0068): the recorded meetings. Kept thin: it only
 *          renders the feature.
 * Used by: Next.js App Router (the sidebar's "Meetings" link; the desktop app's "Open in Meetings")
 * Depends on: src/features/meetings/MeetingsPage.tsx
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md; architecture §9.2 (thin routes)
 */
import { MeetingsPage } from '@/features/meetings/MeetingsPage';

/**
 * Meetings page.
 * @returns The feature.
 */
export default function MeetingsRoute() {
  return <MeetingsPage />;
}

/**
 * File: apps/web/app/player/[id]/page.tsx
 * Purpose: The /player/[id] route (desktop 1.5.0, ADR-0068): the desktop app's player window for one
 *          recording part. Signed-in users only. Outside the (app) group on purpose, so it has no sidebar:
 *          it is a window of its own.
 * Used by: Next.js App Router; opened by apps/desktop/src/main.ts (openPlayer) for Play and for
 *          paramountai://recording/<id> links
 * Depends on: src/server/guard.ts (requireUser), src/features/meetings/RecordingPlayer.tsx,
 *             src/features/shell/AccountName.tsx, src/features/sync/SyncScope.tsx (ADR-0049)
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md; architecture §9.2 (thin routes)
 */
import { RecordingPlayer } from '@/features/meetings/RecordingPlayer';
import { AccountNameProvider } from '@/features/shell/AccountName';
import { SyncScope } from '@/features/sync/SyncScope';
import { requireUser } from '@/server/guard';

/** Props Next.js passes to this page (route parameters arrive as a promise in Next.js 16). */
interface PlayerRouteProps {
  /** The route parameters. */
  params: Promise<{
    /** The [id] segment: the recording part's id. */
    id: string;
  }>;
}

/**
 * Player page.
 * @param props.params The route parameters.
 * @returns The player.
 */
export default async function PlayerRoute({ params }: PlayerRouteProps) {
  // Same sign-in rules as every app page (temporary passwords go to /change-password).
  const { user } = await requireUser();
  const { id } = await params;
  return (
    // ADR-0049: the recording records sync like the rest of the call data (Delete reaches the account);
    // they live in the account's own database on this device (accountId).
    <SyncScope accountId={user.id} email={user.email}>
      <AccountNameProvider name={user.name}>
        <RecordingPlayer recordingId={id} />
      </AccountNameProvider>
    </SyncScope>
  );
}

/**
 * File: apps/web/app/(app)/live/[id]/page.tsx
 * Purpose: The /live/[id] route: a session's live screen (Connect view, then the transcript).
 *          Signed-in users only (the (app) layout's guard). Kept thin: the session lives in
 *          IndexedDB on this computer, so LiveSession loads it in the browser (an unknown id
 *          shows "Session not found" there, not a server 404). ADR-0076: it also tells the page
 *          whether this account uses cloud transcription (the KITE_STT_DEEPGRAM_USERS rollout).
 * Used by: Next.js App Router; opened from the dashboard (Open, then Choose platform)
 * Depends on: src/features/live/LiveSession.tsx, src/server/guard.ts, src/server/deepgram.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect, Live session), §8.1,
 *               §9.2 (thin routes); day-03-sessions.md Stage 4; ADR-0076
 */
import { LiveSession } from '@/features/live/LiveSession';
import { deepgramEnabledFor } from '@/server/deepgram';
import { requireUser } from '@/server/guard';

/** Props Next.js passes to this page (route parameters arrive as a promise in Next.js 16). */
interface LiveRouteProps {
  /** The route parameters. */
  params: Promise<{
    /** The [id] segment: the session id. */
    id: string;
  }>;
}

/**
 * Live session page.
 *
 * @param props.params The route parameters.
 * @returns The live screen for the session.
 */
export default async function LiveRoute({ params }: LiveRouteProps) {
  const { id } = await params;
  // The layout has already checked sign-in; this reads the same (cached) session for the rollout switch.
  const { user } = await requireUser();
  return <LiveSession sessionId={id} cloudStt={deepgramEnabledFor(user.id)} />;
}

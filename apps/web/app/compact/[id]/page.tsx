/**
 * File: apps/web/app/compact/[id]/page.tsx
 * Purpose: The /compact/[id] route: the compact live view of a session, shown in the desktop
 *          app's frameless, always-on-top window (Day 5). Signed-in users only. Outside the
 *          (app) group on purpose, so it has no sidebar: the window is small. (The Day 5 plan
 *          named /live/[id]?view=compact; a nested route cannot drop the (app) layout's sidebar.)
 * Used by: Next.js App Router; loaded by apps/desktop/src/windows.ts (compactUrl)
 * Depends on: src/server/guard.ts (requireUser), src/features/live/CompactLive.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view), §9.2 (thin
 *               routes); day-05-overlay-screenshots-notes.md Stage 3
 */
import { CompactLive } from '@/features/live/CompactLive';
import { requireUser } from '@/server/guard';

/** Props Next.js passes to this page (route parameters arrive as a promise in Next.js 16). */
interface CompactRouteProps {
  /** The route parameters. */
  params: Promise<{
    /** The [id] segment: the session id. */
    id: string;
  }>;
}

/**
 * Compact view page.
 *
 * @param props.params The route parameters.
 * @returns The compact view for the session.
 */
export default async function CompactRoute({ params }: CompactRouteProps) {
  // Same sign-in rules as every app page (temporary passwords go to /change-password).
  await requireUser();
  const { id } = await params;
  return <CompactLive sessionId={id} />;
}

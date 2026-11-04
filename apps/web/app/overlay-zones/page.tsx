/**
 * File: apps/web/app/overlay-zones/page.tsx
 * Purpose: The /overlay-zones route: the ghost layouts shown while the overlay is dragged (v1.1.0,
 *          ADR-0041), in a see-through window the shell puts over the display. Signed-in users only,
 *          like every page; it holds no call content.
 * Used by: Next.js App Router; loaded by apps/desktop/src/snapZones.ts
 * Depends on: src/server/guard.ts (requireUser), src/features/live/overlay/SnapZones.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §9.2 (thin routes); ADR-0041
 */
import { SnapZones } from '@/features/live/overlay/SnapZones';
import { requireUser } from '@/server/guard';

/**
 * Snap zones page.
 *
 * @param props.searchParams The address's parameters: zones, as the shell wrote them.
 * @returns The zones.
 */
export default async function OverlayZonesRoute(props: {
  searchParams: Promise<{ zones?: string | string[] }>;
}) {
  await requireUser();
  const { zones } = await props.searchParams;
  return <SnapZones zones={typeof zones === 'string' ? zones : null} />;
}

/**
 * File: apps/web/src/features/live/overlay/SnapZones.tsx
 * Purpose: The ghost layouts shown while the overlay is dragged (v1.1.0, ADR-0041): three translucent
 *          shapes along the top of the display, each a slim bar over a larger panel, with the one under
 *          the pointer outlined. The shell says where they go (in the URL) and which is under the
 *          pointer (window.kiteDesktop.onSnapZone); the window takes no clicks.
 * Used by: app/overlay-zones/page.tsx
 * Depends on: @kite/shared (OVERLAY_PRESETS types), window.kiteDesktop (through src/platform)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0041
 */
'use client';

import type { OverlayPreset } from '@kite/shared';
import { useEffect, useMemo, useState } from 'react';
import { getPlatform } from '@/platform';

/** One ghost, in the window's own coordinates. */
export interface Ghost {
  /** Where it would put the overlay. */
  preset: OverlayPreset;
  /** Left edge. */
  x: number;
  /** Top edge. */
  y: number;
  /** Width. */
  width: number;
  /** Height. */
  height: number;
}

/**
 * Reads the ghosts from the URL's value ("top-left,24,24,680,320;…"). Anything unreadable is left out,
 * so a bad value draws nothing.
 *
 * @param value The 'zones' value, or null.
 * @returns The ghosts.
 * Called from: SnapZones; tests
 */
export function parseGhosts(value: string | null): Ghost[] {
  if (!value) return [];
  return value.split(';').flatMap((part) => {
    const [preset, ...numbers] = part.split(',');
    const [x, y, width, height] = numbers.map(Number);
    if (
      !preset ||
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined ||
      ![x, y, width, height].every(Number.isFinite)
    ) {
      return [];
    }
    return [{ preset: preset as OverlayPreset, x, y, width, height }];
  });
}

/**
 * The zones.
 *
 * @param props.zones The zones as the shell wrote them in the address, or null.
 * @returns The ghosts on a clear page.
 * Rendered by: app/overlay-zones/page.tsx
 */
export function SnapZones(props: { zones: string | null }) {
  const ghosts = useMemo(() => parseGhosts(props.zones), [props.zones]);
  const [hover, setHover] = useState<OverlayPreset | null>(null);

  useEffect(() => getPlatform().onSnapZone(setHover), []);

  return (
    // k-glass: the page's background is clear, so only the ghosts show over the display.
    <div className="k-glass k-snap-zones fixed inset-0 overflow-hidden" aria-hidden="true">
      {ghosts.map((ghost) => (
        <div
          key={ghost.preset}
          data-zone={ghost.preset}
          data-active={hover === ghost.preset}
          className="k-snap-zone absolute flex flex-col gap-1.5 rounded-card p-1.5"
          style={{ left: ghost.x, top: ghost.y, width: ghost.width, height: ghost.height }}
        >
          <span className="k-snap-ghost h-10 shrink-0 rounded-control" />
          <span className="k-snap-ghost min-h-0 flex-1 rounded-control" />
        </div>
      ))}
    </div>
  );
}

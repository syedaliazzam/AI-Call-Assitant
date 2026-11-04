/**
 * File: apps/web/src/features/live/overlay/ResizeGrips.tsx
 * Purpose: The see-through window's resize grips (desktop 1.0.2+, ADR-0035): invisible strips on its
 *          edges and corners. A pointer drag sends the distance moved since the drag started; the shell
 *          applies it to the bounds it had then.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (overlay types), React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0035
 */
'use client';

import type { OverlayEdge, OverlayResizeStep } from '@kite/shared';
import { useRef, type PointerEvent } from 'react';

/** The grips: each edge and corner, with where it sits and its cursor. */
const GRIPS: readonly { edge: OverlayEdge; className: string }[] = [
  { edge: 'n', className: 'left-3 right-3 top-0 h-1.5 cursor-ns-resize' },
  { edge: 's', className: 'bottom-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { edge: 'e', className: 'bottom-3 right-0 top-3 w-1.5 cursor-ew-resize' },
  { edge: 'w', className: 'bottom-3 left-0 top-3 w-1.5 cursor-ew-resize' },
  { edge: 'ne', className: 'right-0 top-0 h-3 w-3 cursor-nesw-resize' },
  { edge: 'nw', className: 'left-0 top-0 h-3 w-3 cursor-nwse-resize' },
  { edge: 'se', className: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize' },
  { edge: 'sw', className: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize' },
];

/**
 * The grips.
 *
 * @param props.onResize Sends each step to the shell.
 * @returns The grips (invisible, over the window's edges).
 * Rendered by: CompactView.tsx
 */
export function ResizeGrips({
  onResize,
}: {
  /** Sends each step to the shell. */
  onResize: (step: OverlayResizeStep) => void;
}) {
  const start = useRef<{ x: number; y: number; edge: OverlayEdge } | null>(null);
  /**
   * One step of a drag.
   *
   * @param event The pointer event.
   * @param phase 'start', 'move' or 'end'.
   */
  const step = (event: PointerEvent<HTMLSpanElement>, phase: OverlayResizeStep['phase']) => {
    const from = start.current;
    if (!from) return;
    // Screen coordinates: the window moves under the pointer while it resizes.
    onResize({ phase, edge: from.edge, dx: event.screenX - from.x, dy: event.screenY - from.y });
    if (phase === 'end') start.current = null;
  };
  return (
    <>
      {GRIPS.map(({ edge, className }) => (
        <span
          key={edge}
          aria-hidden="true"
          data-grip={edge}
          className={`absolute z-20 [-webkit-app-region:no-drag] ${className}`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = { x: event.screenX, y: event.screenY, edge };
            step(event, 'start');
          }}
          onPointerMove={(event) => step(event, 'move')}
          onPointerUp={(event) => step(event, 'end')}
          onPointerCancel={(event) => step(event, 'end')}
        />
      ))}
    </>
  );
}

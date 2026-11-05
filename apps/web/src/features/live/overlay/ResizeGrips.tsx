/**
 * File: apps/web/src/features/live/overlay/ResizeGrips.tsx
 * Purpose: The see-through window's resize grips (desktop 1.0.2+, ADR-0035): invisible strips on its
 *          edges and corners, and the visible grip at the answer panel's corner (spec S15). A pointer
 *          drag sends the distance moved since the drag started; the shell applies it to the bounds it
 *          had then.
 * Used by: src/features/live/CompactView.tsx, src/features/live/overlay/OverlayAnswer.tsx
 * Depends on: @kite/shared (overlay types), lucide-react, React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0035
 */
'use client';

import type { OverlayEdge, OverlayResizeStep } from '@kite/shared';
import { MoveDiagonal2 } from 'lucide-react';
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
 * The pointer handlers of a grip.
 *
 * @param onResize Sends each step to the shell.
 * @returns A function giving the handlers for one edge.
 * Called from: ResizeGrips, ResizeCorner
 */
function useGripDrag(onResize: (step: OverlayResizeStep) => void) {
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
  return (edge: OverlayEdge) => ({
    onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { x: event.screenX, y: event.screenY, edge };
      step(event, 'start');
    },
    onPointerMove: (event: PointerEvent<HTMLSpanElement>) => step(event, 'move'),
    onPointerUp: (event: PointerEvent<HTMLSpanElement>) => step(event, 'end'),
    onPointerCancel: (event: PointerEvent<HTMLSpanElement>) => step(event, 'end'),
  });
}

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
  const handlers = useGripDrag(onResize);
  return (
    <>
      {GRIPS.map(({ edge, className }) => (
        <span
          key={edge}
          aria-hidden="true"
          data-grip={edge}
          className={`absolute z-20 [-webkit-app-region:no-drag] ${className}`}
          {...handlers(edge)}
        />
      ))}
    </>
  );
}

/**
 * The visible grip at the answer panel's bottom right. For the pointer only, like the edges.
 *
 * @param props.onResize Sends each step to the shell.
 * @returns The grip.
 * Rendered by: OverlayAnswer.tsx
 */
export function ResizeCorner({
  onResize,
}: {
  /** Sends each step to the shell. */
  onResize: (step: OverlayResizeStep) => void;
}) {
  const handlers = useGripDrag(onResize);
  return (
    <span
      aria-hidden="true"
      data-grip="corner"
      className="absolute bottom-2.5 right-2.5 z-20 inline-flex size-6 cursor-nwse-resize items-center justify-center rounded-[6px] bg-ui-pill text-ui-text [-webkit-app-region:no-drag]"
      {...handlers('se')}
    >
      <MoveDiagonal2 size={14} />
    </span>
  );
}

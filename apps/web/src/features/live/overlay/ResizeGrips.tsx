/**
 * File: apps/web/src/features/live/overlay/ResizeGrips.tsx
 * Purpose: The see-through window's resize grips (desktop 1.0.2+, ADR-0035): invisible strips on its
 *          edges and corners, and the visible grip at the answer panel's corner (spec S15). A pointer
 *          drag sends the distance moved since the drag started; the shell applies it to the bounds it
 *          had then. ADR-0113: the answer panel's grip changes the panels' own width sideways (in the
 *          page) and the window's height up and down; on a right position it sits in the bottom left.
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
 * ADR-0113: one step of a sideways drag of the answer panel's corner grip, in the page's client
 * coordinates (the page changes the panels' own width; the window's width never changes).
 */
export type WidthDrag = (phase: OverlayResizeStep['phase'], clientX: number) => void;

/**
 * ADR-0113: the pointer handlers of the answer panel's corner grip when the page owns the width: the
 * vertical part goes to the shell (the window's bottom edge, screen coordinates, as the window resizes under
 * the pointer) and the sideways part to the page (client coordinates: the window never moves sideways here).
 *
 * @param onResize    Sends each step to the shell.
 * @param onWidthDrag Changes the panels' own width.
 * @returns A function giving the handlers (called while rendering, like useGripDrag's).
 * Called from: ResizeCorner
 */
function useWidthAndHeightDrag(
  onResize: (step: OverlayResizeStep) => void,
  onWidthDrag: WidthDrag,
) {
  // The screen y where the drag started.
  const startY = useRef<number | null>(null);
  /**
   * One step of the drag: the height to the shell, the width to the page.
   *
   * @param event The pointer event.
   * @param phase 'start', 'move' or 'end'.
   */
  const step = (event: PointerEvent<HTMLSpanElement>, phase: OverlayResizeStep['phase']) => {
    const from = startY.current;
    if (from === null) return;
    onResize({ phase, edge: 's', dx: 0, dy: event.screenY - from });
    onWidthDrag(phase, event.clientX);
    if (phase === 'end') startY.current = null;
  };
  return () => ({
    onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      startY.current = event.screenY;
      step(event, 'start');
    },
    onPointerMove: (event: PointerEvent<HTMLSpanElement>) => step(event, 'move'),
    onPointerUp: (event: PointerEvent<HTMLSpanElement>) => step(event, 'end'),
    onPointerCancel: (event: PointerEvent<HTMLSpanElement>) => step(event, 'end'),
  });
}

/**
 * The visible grip at the answer panel's bottom corner. For the pointer only, like the edges.
 *
 * ADR-0113: with onWidthDrag, a drag sideways changes only the panels' own width (the page does it; the bars
 * stay as they are) and a drag up or down still changes the window's height (the shell's bottom edge, as
 * before). Without it, the whole drag resizes the window from its bottom-right corner (before ADR-0113).
 *
 * @param props.onResize    Sends each step to the shell.
 * @param props.onWidthDrag Changes the panels' width (ADR-0113).
 * @param props.side        Which bottom corner it sits in: 'left' on a right position (ADR-0113).
 * @returns The grip.
 * Rendered by: OverlayAnswer.tsx
 */
export function ResizeCorner({
  onResize,
  onWidthDrag,
  side = 'right',
}: {
  /** Sends each step to the shell. */
  onResize: (step: OverlayResizeStep) => void;
  /** ADR-0113: changes the panels' own width with the sideways part of the drag. */
  onWidthDrag?: WidthDrag | undefined;
  /** ADR-0113: the bottom corner it sits in. */
  side?: 'left' | 'right';
}) {
  const handlers = useGripDrag(onResize);
  // ADR-0113: without onWidthDrag the sideways part has nowhere to go: it is ignored (never sent as width).
  const split = useWidthAndHeightDrag(onResize, onWidthDrag ?? (() => undefined));
  return (
    <span
      aria-hidden="true"
      data-grip="corner"
      data-grip-side={side}
      className={`absolute bottom-2.5 z-20 inline-flex size-6 items-center justify-center rounded-[6px] bg-ui-pill text-ui-text [-webkit-app-region:no-drag] ${side === 'left' ? 'left-2.5 cursor-nesw-resize' : 'right-2.5 cursor-nwse-resize'}`}
      {...(onWidthDrag ? split() : handlers('se'))}
    >
      {/* The arrow points along the drag: up-left to down-right, mirrored on the left. */}
      <MoveDiagonal2 size={14} className={side === 'left' ? '-scale-x-100' : undefined} />
    </span>
  );
}

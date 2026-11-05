/**
 * File: apps/web/src/features/live/overlay/IconMode.tsx
 * Purpose: The overlay shrunk to an icon (spec S13): a 48 px dark rounded square with moving accent
 *          level bars. Dragging moves the window; a click, or Enter, restores the overlay. The call and
 *          its shortcuts carry on.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: ./parts.tsx (LevelBars)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S13); ADR-0045
 *
 * The drag is done here rather than with the window's drag region: a drag region swallows the click
 * that restores the overlay.
 */
'use client';

import { useRef } from 'react';
import { LevelBars, type LevelStore } from './parts';

/** How far the pointer may move, in px, and still count as a click. */
const CLICK_SLOP = 4;

/** Props for IconMode. */
export interface IconModeProps {
  /** The classes of one overlay piece. */
  piece: string;
  /** True while the other side's audio is connected. */
  on: boolean;
  /** Where the live levels come from. */
  levels?: LevelStore | undefined;
  /** Moves the window by this distance. */
  onMove: (dx: number, dy: number) => void;
  /** Restores the overlay. */
  onRestore: () => void;
}

/**
 * The icon.
 *
 * @param props See IconModeProps.
 * @returns The icon.
 * Rendered by: CompactView.tsx
 */
export function IconMode({ piece, on, levels, onMove, onRestore }: IconModeProps) {
  // Where the pointer was last, in screen coordinates: the window moves under it.
  const last = useRef<{ x: number; y: number } | null>(null);
  const travelled = useRef(0);
  return (
    <button
      type="button"
      aria-label="Restore the overlay"
      className={`${piece} flex size-12 cursor-grab touch-none items-center justify-center focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        last.current = { x: event.screenX, y: event.screenY };
        travelled.current = 0;
      }}
      onPointerMove={(event) => {
        if (!last.current) return;
        const dx = event.screenX - last.current.x;
        const dy = event.screenY - last.current.y;
        if (dx === 0 && dy === 0) return;
        last.current = { x: event.screenX, y: event.screenY };
        travelled.current += Math.abs(dx) + Math.abs(dy);
        onMove(dx, dy);
      }}
      onPointerUp={() => {
        last.current = null;
      }}
      onPointerCancel={() => {
        last.current = null;
      }}
      onClick={() => {
        // The end of a drag also arrives as a click. Enter and Space arrive with no travel.
        if (travelled.current <= CLICK_SLOP) onRestore();
        travelled.current = 0;
      }}
    >
      <LevelBars on={on} levels={levels} />
    </button>
  );
}

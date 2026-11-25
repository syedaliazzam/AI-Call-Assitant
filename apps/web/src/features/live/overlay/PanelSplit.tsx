/**
 * File: apps/web/src/features/live/overlay/PanelSplit.tsx
 * Purpose: The divider between the overlay's transcript (left) and answer (right) panels when they sit
 *          side by side (ADR-0085): drag it to share the width, arrow keys move it while it has focus, a
 *          double-click puts it back to the default (40 % transcript). Each panel keeps its minimum width
 *          (CompactView.tsx: 240 and 340 CSS px). The split is remembered on this device (overlayPrefs.ts).
 *          Shown only side by side (from 600 CSS px of the window, ADR-0119); stacked panels have no divider.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: src/core/storage/overlayPrefs.ts (OVERLAY_SPLIT, clampSplit), React
 * Architecture: ADR-0085, ADR-0119
 *
 * It is not one of the bars (data-bars): in Click-through mode it passes clicks on like the panels do, and
 * the window's height is never measured from it. It is not a gap (data-gap) either, so in normal mode it
 * takes its clicks. It is outside every drag region, so a drag here moves the divider, never the window.
 */
'use client';

import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { clampSplit, OVERLAY_SPLIT } from '@/core/storage/overlayPrefs';

/** How far one arrow key press moves the divider (a share of the width). */
export const SPLIT_KEY_STEP = 0.02;

/** Props for PanelSplit. */
export interface PanelSplitProps {
  /** The transcript's share of the width now. */
  ratio: number;
  /** The panels' area (the divider's position is measured against it). */
  area: RefObject<HTMLDivElement | null>;
  /** Shows a new share while it moves (not stored yet). */
  onMove: (ratio: number) => void;
  /** Stores the share once the move ends (pointer up, a key, a double-click). */
  onCommit: (ratio: number) => void;
  /** True on the bottom row (ADR-0056): the grip sits near the bars, at the bottom. */
  up: boolean;
}

/**
 * The share of the width at a point across the area.
 *
 * @param clientX The pointer's x (the page's client coordinates).
 * @param left    The area's left edge, in the same coordinates.
 * @param width   The area's width, in the same coordinates.
 * @returns The transcript's share (clamped), or null when the area has no width.
 * Called from: PanelSplit; tests
 */
export function ratioAt(clientX: number, left: number, width: number): number | null {
  if (!(width > 0)) return null;
  return clampSplit((clientX - left) / width);
}

/**
 * The divider.
 *
 * @param props See PanelSplitProps.
 * @returns The divider (hidden below 600 CSS px, where the panels stack).
 * Rendered by: CompactView.tsx
 */
export function PanelSplit({ ratio, area, onMove, onCommit, up }: PanelSplitProps) {
  // The share while a drag runs (a ref: the pointer events fire faster than renders).
  const dragging = useRef<number | null>(null);

  /**
   * The share at the pointer, from the area's box (getBoundingClientRect and clientX are in the same
   * coordinates at any UI zoom, so the ratio needs no zoom correction).
   *
   * @param event The pointer event.
   * @returns The share, or null.
   */
  const at = (event: PointerEvent<HTMLDivElement>) => {
    const box = area.current?.getBoundingClientRect();
    return box ? ratioAt(event.clientX, box.left, box.width) : null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowLeft' ? -SPLIT_KEY_STEP : event.key === 'ArrowRight' ? SPLIT_KEY_STEP : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = clampSplit(ratio + step);
    onMove(next);
    onCommit(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the transcript and answer panels"
      aria-valuemin={Math.round(OVERLAY_SPLIT.min * 100)}
      aria-valuemax={Math.round(OVERLAY_SPLIT.max * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      // Double-click: back to the default split.
      // ADR-0085: words for screen readers (no title: its tooltip is an unprotected window). A spread,
      // as jsx-a11y's role list predates ARIA 1.3's aria-description (Chromium reads it).
      {...{ 'aria-description': 'Drag, or use the arrow keys. Double-click to reset.' }}
      tabIndex={0}
      data-panel-split=""
      // 12 px to grab, sitting in the 6 px gap between the panels (its margins take back 18 px: the two
      // flex gaps, 12, and 6 of its own), so the panels stay 6 px apart as before.
      className={`group relative z-10 -mx-[9px] hidden w-3 shrink-0 cursor-col-resize self-stretch touch-none @min-[600px]/overlay:flex ${up ? 'items-end pb-3' : 'items-start pt-3'} justify-center rounded-control focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = ratio;
      }}
      onPointerMove={(event) => {
        if (dragging.current === null) return;
        const next = at(event);
        if (next === null) return;
        dragging.current = next;
        onMove(next);
      }}
      onPointerUp={(event) => {
        if (dragging.current === null) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        const done = dragging.current;
        dragging.current = null;
        onCommit(done);
      }}
      onPointerCancel={() => {
        if (dragging.current === null) return;
        const done = dragging.current;
        dragging.current = null;
        onCommit(done);
      }}
      onDoubleClick={() => {
        onMove(OVERLAY_SPLIT.default);
        onCommit(OVERLAY_SPLIT.default);
      }}
      onKeyDown={onKeyDown}
    >
      {/* The grip: a short bar near the bars, brighter under the pointer or while focused. */}
      <span
        aria-hidden="true"
        className="h-8 w-1 rounded-full bg-ui-border opacity-70 transition-opacity duration-(--k-dur) group-hover:bg-ui-muted group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </div>
  );
}

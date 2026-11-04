/**
 * File: apps/web/src/features/live/useStickToBottom.ts
 * Purpose: A transcript's scroll area that follows its newest line (v1.1.0, ADR-0041): at the bottom it
 *          stays at the bottom as lines arrive; scrolled up it stays put and reports that newer lines
 *          are waiting, for the "Jump to latest" chip.
 * Used by: src/features/live/TranscriptStrip.tsx, src/features/live/overlay/TranscriptPanel.tsx
 * Depends on: src/core/transcript/autoScroll.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0041
 */
'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { atBottom } from '@/core/transcript/autoScroll';

/** What useStickToBottom() returns. */
export interface StickToBottom {
  /** Attach to the scroll area. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Attach to the scroll area's scroll event. */
  onScroll: () => void;
  /** True while the reader has scrolled up: the "Jump to latest" chip shows. */
  paused: boolean;
  /** Goes to the newest line and follows it again. */
  jump: () => void;
}

/**
 * Follows the newest line of a scroll area.
 *
 * @param signature Anything that changes when the content changes (the newest bubble's words).
 * @returns The ref, the scroll handler, whether it is paused, and how to go back.
 * Called from: TranscriptStrip.tsx, TranscriptPanel.tsx
 */
export function useStickToBottom(signature: string): StickToBottom {
  const ref = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  const onScroll = useCallback(() => {
    const area = ref.current;
    if (!area) return;
    const next = !atBottom(area.scrollTop, area.clientHeight, area.scrollHeight);
    pausedRef.current = next;
    setPaused(next);
  }, []);

  // Before paint, so a new line never shows for a frame above where the view settles.
  useLayoutEffect(() => {
    const area = ref.current;
    if (area && !pausedRef.current) area.scrollTop = area.scrollHeight;
  }, [signature]);

  const jump = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    const area = ref.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, []);

  return { ref, onScroll, paused, jump };
}

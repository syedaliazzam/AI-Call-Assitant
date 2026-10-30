/**
 * File: apps/web/src/features/live/CompactLive.tsx
 * Purpose: Connects the compact view to the call: listens to the live page over the session's
 *          channel (core/live/liveChannel.ts), asks for the current state when it opens, sends
 *          the user's commands back, and reads and changes this window's screen-share
 *          protection through the platform. Closes the window when the call ends.
 * Used by: app/compact/[id]/page.tsx (the desktop compact window); LiveAnswers.tsx (rendered
 *          into the browser's picture-in-picture window, Day 5 Stage 4)
 * Depends on: src/core/live/liveChannel.ts, src/platform, src/features/live/CompactView.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view); day-05-overlay-
 *               screenshots-notes.md Stage 3
 */
'use client';

import type { ShareProtectionState } from '@kite/shared';
import { useEffect, useRef, useState } from 'react';
import { openLiveChannel, type CompactState, type LiveChannel } from '@/core/live/liveChannel';
import { getPlatform } from '@/platform';
import { CompactView } from './CompactView';

/** Props for CompactLive. */
export interface CompactLiveProps {
  /** The live session's id (from the URL). */
  sessionId: string;
  /**
   * Close the window when the call ends (default true: the desktop compact window). Inside a
   * browser picture-in-picture window, 'window' is the main page, so the platform closes it.
   */
  closeOnEnd?: boolean;
}

/**
 * The compact view, connected to the live page of the same session.
 *
 * @param props See CompactLiveProps.
 * @returns The view.
 * Rendered by: app/compact/[id]/page.tsx
 */
export function CompactLive({ sessionId, closeOnEnd = true }: CompactLiveProps) {
  const [state, setState] = useState<CompactState | null>(null);
  const [protection, setProtection] = useState<ShareProtectionState | null>(null);
  const channel = useRef<LiveChannel | null>(null);

  useEffect(() => {
    const link = openLiveChannel(sessionId);
    channel.current = link;
    link.onState(setState);
    // Ask the live page for what it shows now (it answers with a state update).
    link.send({ type: 'hello' });
    getPlatform()
      .getShareProtection()
      .then(setProtection)
      .catch(() => undefined);
    return () => {
      link.close();
      channel.current = null;
    };
  }, [sessionId]);

  // The call ended: close this window shortly (the live page also asks the shell to close it).
  useEffect(() => {
    if (!state?.ended || !closeOnEnd) return;
    const timer = setTimeout(() => window.close(), 1_500);
    return () => clearTimeout(timer);
  }, [state?.ended, closeOnEnd]);

  return (
    <CompactView
      state={state}
      protection={protection}
      onCommand={(command) => channel.current?.send(command)}
      onProtection={(on) => {
        getPlatform()
          .setShareProtection(on)
          .then(setProtection)
          .catch(() => undefined);
      }}
    />
  );
}

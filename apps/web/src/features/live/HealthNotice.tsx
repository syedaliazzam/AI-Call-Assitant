/**
 * File: apps/web/src/features/live/HealthNotice.tsx
 * Purpose: Shows the speech-to-text health message: the 'slow' hint in grey with a dismiss
 *          button ("Plug in your laptop for best results"), and the 'falling-behind' / 'stalled'
 *          warnings in red (not dismissible: they mean the transcript is at risk).
 * Used by: src/features/live/ConnectPanel.tsx, src/features/live/TranscriptStrip.tsx
 * Depends on: src/core/stt/health.ts (message and tone)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2, §13 (battery risk); ADR-0020
 */
'use client';

import { useState } from 'react';
import { healthMessage, healthTone, type SttHealthStatus } from '@/core/stt/health';

/** Props for HealthNotice. */
export interface HealthNoticeProps {
  /** The current health status. */
  status: SttHealthStatus;
}

/**
 * The health message, if any.
 * A dismissed hint stays hidden until the status changes and later becomes 'slow' again.
 *
 * @param props See HealthNoticeProps.
 * @returns The notice, or nothing when everything is fine (or the hint was dismissed).
 * Rendered by: ConnectPanel.tsx, TranscriptStrip.tsx
 */
export function HealthNotice({ status }: HealthNoticeProps) {
  const [dismissedFor, setDismissedFor] = useState<SttHealthStatus | null>(null);
  // Forget a dismissal once the status moves on, so a later slowdown shows the hint again.
  if (dismissedFor !== null && dismissedFor !== status) setDismissedFor(null);

  const message = healthMessage(status);
  const tone = healthTone(status);
  if (!message || !tone || dismissedFor === status) return null;

  if (tone === 'hint') {
    return (
      <p
        role="status"
        className="flex items-center justify-between gap-3 bg-ui-band px-3 py-2 text-sm text-ui-muted"
      >
        {message}
        <button
          type="button"
          onClick={() => setDismissedFor(status)}
          className="text-xs font-semibold text-ui-muted hover:text-ui-heading"
          aria-label="Dismiss this hint"
        >
          Dismiss
        </button>
      </p>
    );
  }
  return (
    <p role="alert" className="bg-ui-danger-bg px-3 py-2 text-sm text-ui-danger">
      {message}
    </p>
  );
}

/**
 * File: apps/web/src/features/live/BackgroundCallStatus.tsx
 * Purpose: What the main window shows before and after a desktop call started from the Connect card
 *          (ADR-0055). The card is in the small window; this window runs the call, minimised, so this
 *          is only seen if someone opens it (or on an older desktop app, which shows it in front): the
 *          call's state in a sentence, never a second Connect card.
 * Used by: src/features/live/LivePage.tsx
 * Depends on: src/ui/BrandLockup.tsx, src/ui/ProgressBar.tsx, src/core/stt/download.ts (types)
 * Architecture: ADR-0055
 */
'use client';

import type { DownloadProgress } from '@/core/stt/download';
import { BrandLockup } from '@/ui/BrandLockup';
import { ProgressBar } from '@/ui/ProgressBar';

/** Where the call is, for this window. */
export type BackgroundCallState = 'waiting' | 'connecting' | 'failed' | 'ended';

/** Props for BackgroundCallStatus. */
export interface BackgroundCallStatusProps {
  /** The state. */
  state: BackgroundCallState;
  /** Why it failed ('failed' only): a fixed sentence from the app. */
  problem: string | null;
  /** The speech model's download, while it loads. */
  progress: DownloadProgress | null;
  /** The notes after the call. */
  notes: 'idle' | 'writing' | 'saved' | 'failed';
}

/**
 * The status.
 *
 * @param props See BackgroundCallStatusProps.
 * @returns A centred note.
 * Rendered by: LivePage.tsx (desktop app with account sync, before and after the call)
 */
export function BackgroundCallStatus({
  state,
  problem,
  progress,
  notes,
}: BackgroundCallStatusProps) {
  const downloading = state !== 'ended' && progress !== null && progress.fraction < 1;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ui-bg p-6 text-center text-ui-text">
      <BrandLockup tone="auto" size="md" />
      <p role="status" className="max-w-md text-[15px] text-ui-heading">
        {state === 'failed'
          ? (problem ?? 'The call could not start.')
          : state === 'connecting'
            ? 'Connecting your call…'
            : state === 'ended'
              ? notes === 'writing'
                ? 'Call ended. Writing the notes…'
                : 'Call ended. This window closes by itself.'
              : 'Getting your call ready…'}
      </p>
      {state === 'failed' && (
        <p className="max-w-md text-[14px] text-ui-muted">
          Press Connect in the Paramount AI window to try again.
        </p>
      )}
      {downloading && (
        <div className="w-full max-w-xs">
          <ProgressBar value={progress.fraction} label="Speech model download" />
        </div>
      )}
    </div>
  );
}

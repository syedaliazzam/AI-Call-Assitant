/**
 * File: apps/web/src/features/home/AccurateDownload.tsx
 * Purpose: The accurate-transcription model's background download (v1.4, ADR-0066), on the home panel
 *          and the launcher: a few seconds after the desktop app opens, the 661 MB Parakeet model starts
 *          downloading by itself (or resumes where it stopped) unless Settings → Transcription is Off,
 *          and a small card shows its progress until it is ready. Calls work meanwhile with the
 *          standard transcription. Replaces v1.1.0's one-click offer (ADR-0044).
 * Used by: src/features/home/HomePanel.tsx, src/features/home/Launcher.tsx
 * Depends on: src/core/storage/transcriptionPrefs.ts, src/platform (accurate), src/ui
 * Architecture: docs/decisions/ADR-0066-accurate-on-them-by-default.md
 */
'use client';

import type { AccurateStatus } from '@kite/shared';
import { useEffect, useState } from 'react';
import { downloadWanted, getTranscriptionMode } from '@/core/storage/transcriptionPrefs';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';

/** How long after the page opens the download starts, ms: the app's own start comes first. */
export const DOWNLOAD_START_DELAY_MS = 5_000;

/** How often the card reads the progress while downloading, ms. */
const PROGRESS_EVERY_MS = 1_000;

/**
 * True once this page asked for the download: a failure is retried at the next start of the app, not
 * every time the home panel is shown again.
 */
let askedThisRun = false;

/**
 * Formats bytes as megabytes.
 *
 * @param bytes A byte count.
 * @returns For example "214 MB".
 */
function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/**
 * Starts the download when it is wanted and shows its progress.
 *
 * @returns The progress card while downloading, or nothing.
 * Rendered by: HomePanel.tsx, Launcher.tsx
 */
export function AccurateDownload() {
  const [status, setStatus] = useState<AccurateStatus | null>(null);
  const [hidden, setHidden] = useState(false);

  // Start (or resume) it a few seconds after the page opens.
  useEffect(() => {
    const engine = getPlatform().accurate;
    if (!engine || getTranscriptionMode() === 'off') return;
    let active = true;
    const timer = setTimeout(() => {
      engine
        .status()
        .then((current) => {
          if (!active) return;
          if (askedThisRun || !downloadWanted(getTranscriptionMode(), current.state)) {
            setStatus(current);
            return;
          }
          askedThisRun = true;
          return engine.download().then((next) => {
            if (active) setStatus(next);
          });
        })
        .catch(() => undefined);
    }, DOWNLOAD_START_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  // While it downloads, read the progress once a second.
  const downloading = status?.state === 'downloading';
  useEffect(() => {
    const engine = getPlatform().accurate;
    if (!engine || !downloading) return;
    let active = true;
    const timer = setInterval(() => {
      engine
        .status()
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch(() => undefined);
    }, PROGRESS_EVERY_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [downloading]);

  if (!status || !downloading || hidden) return null;

  return (
    <div
      role="status"
      className="mx-3 mb-2 flex shrink-0 flex-col gap-2 rounded-control border border-ui-border bg-ui-surface p-3 text-[13px] text-ui-text"
    >
      <p>
        Downloading accurate transcription: {megabytes(status.receivedBytes)} of{' '}
        {megabytes(status.totalBytes)}. Calls work meanwhile; it is used from the next call once it
        is ready.
      </p>
      <div className="flex items-center justify-between gap-3">
        <progress
          aria-label="Accurate transcription download"
          max={status.totalBytes}
          value={status.receivedBytes}
          className="h-2 min-w-0 flex-1"
        />
        <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>
          Hide
        </Button>
      </div>
    </div>
  );
}

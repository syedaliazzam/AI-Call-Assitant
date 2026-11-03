/**
 * File: apps/web/src/features/settings/TranscriptionSetting.tsx
 * Purpose: Settings → Transcription (v1.0.1, ADR-0034): the "Accurate transcription (beta)" switch,
 *          off by default. Turning it on downloads the Parakeet model once (about 661 MB, resumable,
 *          each file checked); during a call each finished line is then transcribed again by it,
 *          and the live engine's text stays wherever the accurate engine is not ready or fails. Shows
 *          the download's progress, a retry after a failure, and a way to delete the download. In
 *          the browser (or an older desktop app) it explains that this needs the desktop app.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/platform (accurate engine), src/core/storage/transcriptionPrefs.ts,
 *             src/ui/Toggle.tsx, src/ui/Button.tsx
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md
 */
'use client';

import type { AccurateStatus } from '@kite/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getAccurateTranscription,
  setAccurateTranscription,
} from '@/core/storage/transcriptionPrefs';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { Toggle } from '@/ui/Toggle';

/**
 * The switch is changed only on this page, so nothing needs to be subscribed to.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/**
 * Formats bytes as megabytes for the progress line.
 *
 * @param bytes A byte count.
 * @returns For example "214 MB".
 */
function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/**
 * The accurate-transcription switch and its download status.
 *
 * @returns The setting.
 * Rendered by: Settings.tsx (Transcription section)
 */
export function TranscriptionSetting() {
  const engine = getPlatform().accurate;
  const saved = useSyncExternalStore(subscribeNever, getAccurateTranscription, () => false);
  const [choice, setChoice] = useState<boolean | null>(null);
  const on = choice ?? saved;
  const [status, setStatus] = useState<AccurateStatus | null>(null);

  // The status on opening, then once a second while the model downloads.
  const downloading = status?.state === 'downloading';
  useEffect(() => {
    if (!engine) return;
    let active = true;
    const refresh = () =>
      engine
        .status()
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch(() => undefined);
    void refresh();
    const timer = downloading ? setInterval(refresh, 1_000) : null;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [engine, downloading]);

  if (!engine) {
    return (
      <p className="text-[13px] text-ui-muted">
        Accurate transcription (beta) needs the Kite desktop app, version 1.0.1 or later. The
        browser keeps the standard transcription.
      </p>
    );
  }
  if (status?.state === 'unavailable') {
    return (
      <p className="text-[13px] text-ui-muted">
        Accurate transcription (beta) is not available on this computer (it needs Windows on a
        64-bit Intel or AMD processor, or a Mac with Apple silicon).
      </p>
    );
  }

  const start = () => {
    engine
      .download()
      .then(setStatus)
      .catch(() => undefined);
  };
  const hasFiles = status !== null && status.receivedBytes > 0;

  return (
    <div className="flex flex-col gap-3">
      <Toggle
        label="Accurate transcription (beta)"
        hint={`On: after each line appears, a second, more accurate engine transcribes it again and replaces it about a second later, with better names and fewer mistakes. Turning it on downloads a ${megabytes(status?.totalBytes ?? 661_000_000)} model once. It uses more processor time, so on battery the improved line can take longer to arrive. Off (default): the standard transcription only.`}
        checked={on}
        onChange={(next) => {
          setAccurateTranscription(next);
          setChoice(next);
          if (next && status?.state !== 'ready') start();
        }}
      />
      {status && (
        <div role="status" className="flex flex-wrap items-center gap-3 text-[13px] text-ui-muted">
          {status.state === 'ready' && <span>The accurate engine is downloaded and ready.</span>}
          {status.state === 'downloading' && (
            <>
              <span>
                Downloading: {megabytes(status.receivedBytes)} of {megabytes(status.totalBytes)}
              </span>
              <progress
                aria-label="Accurate transcription download"
                max={status.totalBytes}
                value={status.receivedBytes}
                className="h-2 w-40"
              />
            </>
          )}
          {status.state === 'not-downloaded' && on && (
            <>
              <span>
                Not downloaded yet
                {hasFiles
                  ? ` (${megabytes(status.receivedBytes)} done, it continues from there)`
                  : ''}
                .
              </span>
              <Button size="sm" variant="secondary" onClick={start}>
                Download
              </Button>
            </>
          )}
          {status.state === 'error' && (
            <>
              <span className="text-ui-danger">{status.error}</span>
              <Button size="sm" variant="secondary" onClick={start}>
                Download again
              </Button>
            </>
          )}
          {hasFiles && status.state !== 'downloading' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                engine
                  .remove()
                  .then(setStatus)
                  .catch(() => undefined);
              }}
            >
              Delete the download
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

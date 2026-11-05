/**
 * File: apps/web/src/features/settings/TranscriptionSetting.tsx
 * Purpose: Settings → Transcription (v1.0.1, ADR-0034; v1.1.0, ADR-0044): "Accurate transcription":
 *          Auto (the default: when plugged in), On or Off. The Parakeet model (about 661 MB, resumable,
 *          each file checked) downloads only when the user asks: Auto never starts it. During a call
 *          each finished line is then transcribed again by it, and the live engine's text stays
 *          wherever the accurate engine is not ready or fails. Shows the download's progress, a retry
 *          after a failure, and a way to delete the download. In the browser (or an older desktop app)
 *          it explains that this needs the desktop app.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/platform (accurate engine), src/core/storage/transcriptionPrefs.ts,
 *             src/ui/Select.tsx, src/ui/Button.tsx
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md
 */
'use client';

import type { AccurateStatus } from '@kite/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getTranscriptionMode,
  setTranscriptionMode,
  type TranscriptionMode,
} from '@/core/storage/transcriptionPrefs';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';

/** The setting's choices, in the order shown. */
const MODE_OPTIONS: readonly { value: TranscriptionMode; label: string }[] = [
  { value: 'auto', label: 'Auto: when plugged in (default)' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

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
  const saved = useSyncExternalStore<TranscriptionMode>(
    subscribeNever,
    getTranscriptionMode,
    () => 'auto',
  );
  const [choice, setChoice] = useState<TranscriptionMode | null>(null);
  const mode = choice ?? saved;
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
        Accurate transcription needs the Paramount AI desktop app, version 1.0.1 or later. The
        browser keeps the standard transcription.
      </p>
    );
  }
  if (status?.state === 'unavailable') {
    return (
      <p className="text-[13px] text-ui-muted">
        Accurate transcription is not available on this computer (it needs Windows on a 64-bit Intel
        or AMD processor, or a Mac with Apple silicon).
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
      <Select
        label="Accurate transcription"
        hint={`After each line appears, a second, more accurate engine transcribes it again and replaces it about a second later, with better names and fewer mistakes. It uses more processor time, so Auto runs it only when this computer is plugged in. It needs a one-time ${megabytes(status?.totalBytes ?? 661_000_000)} download, which only starts when you press Download.`}
        options={MODE_OPTIONS}
        value={mode}
        onChange={(next) => {
          setTranscriptionMode(next);
          setChoice(next);
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
          {status.state === 'not-downloaded' && mode !== 'off' && (
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

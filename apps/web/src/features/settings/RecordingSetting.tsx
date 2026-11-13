/**
 * File: apps/web/src/features/settings/RecordingSetting.tsx
 * Purpose: Settings → Recording (desktop 1.5.0, ADR-0068): the video quality (Standard 720p by default;
 *          High 1080p only where this computer has a hardware H.264 encoder), where the files go
 *          (Documents › Paramount AI › Recordings, on this computer only), the advice to turn on
 *          BitLocker (the files are not encrypted by Paramount AI), and the consent rule. In a browser
 *          (or a desktop app before 1.5.0) it says recording needs the desktop app.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/platform (recording host), src/core/storage/recordingPrefs.ts,
 *             src/core/recording/format.ts (hasHardwareH264), src/ui/Select.tsx
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md
 */
'use client';

import type { RecordingQuality } from '@kite/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { hasHardwareH264 } from '@/core/recording/format';
import { getRecordingQuality, setRecordingQuality } from '@/core/storage/recordingPrefs';
import { getPlatform } from '@/platform';
import { Select } from '@/ui/Select';

/** The quality choices, in the order shown. */
const QUALITY_OPTIONS: readonly { value: RecordingQuality; label: string }[] = [
  { value: 'standard', label: 'Standard (720p, about 0.3 GB an hour)' },
  { value: 'high', label: 'High (1080p, about 0.9 GB an hour)' },
];

/**
 * No-op subscription: the platform never changes while the page is open.
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * The section.
 * @returns The controls and the words.
 * Rendered by: Settings.tsx
 */
export function RecordingSetting() {
  const available = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().recording !== null,
    () => false,
  );
  // The saved choice (localStorage is not there during the server render), until changed here.
  const stored = useSyncExternalStore(
    subscribeNever,
    getRecordingQuality,
    () => 'standard' as const,
  );
  const [chosen, setChosen] = useState<RecordingQuality | null>(null);
  const quality = chosen ?? stored;
  const [hardware, setHardware] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void hasHardwareH264().then((found) => {
      if (live) setHardware(found);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!available) {
    return (
      <p className="text-[13px] text-ui-muted">
        Recording meetings needs the Paramount AI desktop app (1.5.0 or later). Recordings are saved
        on the computer that makes them; your recorded meetings are listed under Meetings.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[14px] font-medium text-ui-heading">Video quality</span>
        <div className="w-80 max-w-full">
          <Select
            label="Video quality"
            hideLabel
            align="end"
            options={
              hardware === false
                ? QUALITY_OPTIONS.filter((option) => option.value === 'standard')
                : QUALITY_OPTIONS
            }
            value={hardware === false ? 'standard' : quality}
            onChange={(value) => {
              const next = value as RecordingQuality;
              setChosen(next);
              setRecordingQuality(next);
            }}
          />
        </div>
      </div>
      {hardware === false && (
        <p className="text-[13px] text-ui-muted">
          This computer has no hardware video encoder, so recordings are sound only (screen video
          would slow the call down).
        </p>
      )}
      <p className="text-[13px] text-ui-muted">
        Recordings are saved on this computer only, in Documents › Paramount AI › Recordings. They
        are not encrypted by Paramount AI: turn on BitLocker (Windows) or FileVault (macOS) so a
        lost laptop does not expose them. Always tell everyone on the call, and record only when
        they agree.
      </p>
    </div>
  );
}

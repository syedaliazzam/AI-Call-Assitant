/**
 * File: apps/web/src/features/home/AccurateOffer.tsx
 * Purpose: The one-time offer of the accurate-transcription model on the home panel (v1.1.0, ADR-0044):
 *          Auto never starts the 661 MB download by itself, so this says what it is and takes one
 *          click. Shown once, only when the setting is on Auto, the model is not on this computer and
 *          the app has the engine. Settings → Transcription offers it too, for good.
 * Used by: src/features/home/HomePanel.tsx
 * Depends on: src/core/storage (hintPrefs.ts, transcriptionPrefs.ts), src/platform (accurate), src/ui
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md; ADR-0044
 */
'use client';

import { useEffect, useState } from 'react';
import { hintSeen, markHintSeen } from '@/core/storage/hintPrefs';
import { getTranscriptionMode } from '@/core/storage/transcriptionPrefs';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';

/**
 * The offer, when it applies.
 *
 * @returns The notice, or nothing.
 * Rendered by: HomePanel.tsx
 */
export function AccurateOffer() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const engine = getPlatform().accurate;
    if (!engine || hintSeen('accurate-offer') || getTranscriptionMode() !== 'auto') return;
    let active = true;
    engine
      .status()
      .then((status) => {
        if (active && status.state === 'not-downloaded') setShow(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!show) return null;

  /** Remembers the answer on this device and closes the offer. */
  const close = () => {
    markHintSeen('accurate-offer');
    setShow(false);
  };

  return (
    <div
      role="status"
      className="mx-3 mb-2 flex shrink-0 flex-col gap-2 rounded-control border border-ui-border bg-ui-surface p-3 text-[13px] text-ui-text"
    >
      <p>
        Accurate transcription gets names and technical terms right more often. It needs a one-time
        661 MB download, and then runs whenever this computer is plugged in.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={close}>
          Not now
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void getPlatform()
              .accurate?.download()
              .catch(() => undefined);
            close();
          }}
        >
          Download
        </Button>
      </div>
    </div>
  );
}

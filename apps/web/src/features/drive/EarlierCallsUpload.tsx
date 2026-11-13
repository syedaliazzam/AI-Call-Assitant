/**
 * File: apps/web/src/features/drive/EarlierCallsUpload.tsx
 * Purpose: Settings → Google Drive → "Upload N earlier calls" (ADR-0077): this device's calls that never
 *          reached Drive (made before Drive was set up, or never queued), found from the calls
 *          (core/drive/earlierCalls.ts), each queued as its own upload with one click. A call already in
 *          one of this device's uploads is never offered, and files already in Drive are found by their
 *          tags, so nothing is uploaded twice. Their emails are sent by hand ("Send email" below).
 * Used by: src/features/drive/GoogleDriveSetting.tsx
 * Depends on: src/core/drive/{earlierCalls,queue}.ts, src/platform
 * Architecture: ADR-0077
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadEarlierCalls, uploadEarlierCalls, type EarlierCall } from '@/core/drive/earlierCalls';
import { onDriveMessage } from '@/core/drive/queue';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';

/**
 * Reads the earlier calls with this computer's recordings (none in a browser).
 *
 * @returns The calls.
 */
function readEarlierCalls(): Promise<EarlierCall[]> {
  const recording = getPlatform().recording;
  return loadEarlierCalls(recording ? { recordings: () => recording.list() } : {});
}

/**
 * The button, shown only when there are earlier calls to upload.
 *
 * @param props.enabled True when the account saves to Drive now (connected, folder chosen, saving on).
 * @returns The button and its line, or nothing.
 * Rendered by: GoogleDriveSetting.tsx
 */
export function EarlierCallsUpload({
  enabled,
}: {
  /** True when the account saves to Drive now. */
  enabled: boolean;
}) {
  const [calls, setCalls] = useState<EarlierCall[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Set only when the answer arrives (never synchronously inside the effect).
  const refresh = useCallback(
    () =>
      readEarlierCalls().then(
        (found) => setCalls(found),
        () => setCalls([]),
      ),
    [],
  );
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    return onDriveMessage(() => void refresh());
  }, [enabled, refresh]);

  if (!enabled || !calls || (calls.length === 0 && !message)) return null;
  return (
    <div className="flex flex-col gap-2">
      {calls.length > 0 && (
        <>
          <p className="text-[13px] text-ui-muted">
            {calls.length === 1 ? '1 earlier call' : `${calls.length} earlier calls`} from this
            computer {calls.length === 1 ? 'is' : 'are'} not in Google Drive (made before Drive was
            set up, or never queued). Their emails are sent by hand, from the list below.
          </p>
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setMessage(null);
                void uploadEarlierCalls(calls)
                  .then((queued) =>
                    setMessage(
                      `${queued === 1 ? '1 call is' : `${queued} calls are`} queued for Google Drive.`,
                    ),
                  )
                  .catch(() => setMessage('The calls could not be queued. Try again.'))
                  .finally(() => {
                    setBusy(false);
                    void refresh();
                  });
              }}
            >
              {calls.length === 1
                ? 'Upload 1 earlier call'
                : `Upload ${calls.length} earlier calls`}
            </Button>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="text-[13px] text-ui-muted">
          {message}
        </p>
      )}
    </div>
  );
}

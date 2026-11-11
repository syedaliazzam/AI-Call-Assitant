/**
 * File: apps/web/src/features/settings/CallTimingLog.tsx
 * Purpose: Settings → Transcription: download the device-side call timing log (1.5.1, ADR-0069; core/live/
 *          callTimings.ts) for the re-test of the call-latency fixes: the last five calls on this device,
 *          ids and times only, with each call's p50 / p95 summary. Nothing is sent anywhere.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: React, src/core/live/callTimings.ts, src/ui/Button
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (testing); ADR-0069
 */
'use client';

import { useSyncExternalStore } from 'react';
import { callTimings, summarizeCall } from '@/core/live/callTimings';
import { Button } from '@/ui/Button';

/**
 * A subscription that never fires (useSyncExternalStore needs one).
 *
 * @returns A function that unsubscribes nothing.
 */
const subscribeNever = () => () => {};

/**
 * How many calls the log holds.
 *
 * @returns The count.
 */
const savedCount = () => callTimings.saved().length;

/**
 * The download button and a short explanation.
 *
 * @returns The setting.
 * Rendered by: Settings.tsx
 */
export function CallTimingLog() {
  // How many calls are saved: 0 on the server, read from this device in the browser. The log changes
  // only when a call ends, never while Settings is open, so nothing needs to subscribe.
  const count = useSyncExternalStore(subscribeNever, savedCount, () => 0);

  /** Hands the saved calls, with their summaries, to the browser as a JSON download. */
  const download = () => {
    const calls = callTimings.saved();
    const file = {
      kind: 'paramount-ai-call-timings',
      version: 1,
      exportedAt: Date.now(),
      calls: calls.map((call) => ({ summary: summarizeCall(call), call })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `paramount-ai-call-timings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    // The download has started; the URL is no longer needed.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-ui-muted">
        Call timing log: how quickly lines and answers arrived in your last{' '}
        {count === 1 ? 'call' : `${Math.min(count, 5)} calls`} on this device. Times and ids only,
        never words. For testing call speed with the Paramount AI team.
      </p>
      <div>
        <Button size="sm" variant="secondary" onClick={download} disabled={count === 0}>
          Download call timing log
        </Button>
      </div>
    </div>
  );
}
